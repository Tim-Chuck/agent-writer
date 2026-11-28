import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { checkDue } from '../lib/memory.mjs';
import { startWriterServer } from '../server.mjs';

async function setup(t, handleModel) {
  const directory = await mkdtemp(join(tmpdir(), 'agent-writer-memory-card-test-'));
  const model = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const messages = JSON.parse(Buffer.concat(chunks)).messages;
    const reply = await handleModel(messages.at(-1).content, req, res);
    if (reply === undefined || res.destroyed) return;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
  });
  model.listen(0, '127.0.0.1');
  await once(model, 'listening');
  const start = () => startWriterServer({ directory, port: 0 });
  let server = await start();
  t.after(async () => {
    await server.close();
    model.closeAllConnections();
    await new Promise(resolve => model.close(resolve));
    for (const file of ['workspace.json', 'workspace.tmp', 'vault.key']) {
      await rm(join(directory, file), { force: true });
    }
    await rmdir(directory);
  });
  const api = async (path, payload, method = 'POST') => {
    const response = await fetch(server.origin + path, payload === undefined ? undefined : {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const result = await response.json();
    assert.ok(response.ok, JSON.stringify(result));
    return result;
  };
  const connect = () => api('/api/providers/save', {
    id: 'custom', endpoint: `http://127.0.0.1:${model.address().port}/v1`, protocol: 'chat', name: '本机测试模型', model: 'fiction-model',
  });
  return { api, connect, async restart() { await server.close(); server = await start(); } };
}

async function waitFor(read, ready) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await read();
    if (ready(result)) return result;
    await delay(20);
  }
  assert.fail('Memory card extraction did not reach its expected state');
}

const evidence = '林岚带着铜钥匙走进白湾港，准备拜访夜航商会。';
const entities = [
  ['character', '林岚'], ['prop', '铜钥匙'], ['location', '白湾港'], ['organization', '夜航商会'],
];
const card = (chapter, type, title, quote = evidence) => ({
  type, title, description: `${title}出现于港口。`, chapterId: chapter.chapterId, evidence: quote,
});

test('extracts sourced plot facts, reuses completed chapters, and excludes stale and future points', async t => {
  const extracted = [];
  let writingPrompt;
  const phrase = '林岚答应保守铜钥匙的秘密。';
  const changed = '林岚把铜钥匙的秘密告诉了周远。';
  const later = '周远日后把铜钥匙熔化。';
  const { api, connect } = await setup(t, message => {
    if (!message.startsWith('[')) { writingPrompt = message; return '已核对。'; }
    const parts = JSON.parse(message);
    extracted.push(...parts.map(part => part.chapterId));
    return JSON.stringify({ points: parts.map(part => ({ type: 'knowledge', chapterId: part.chapterId,
      text: part.text.trim(), evidence: part.text.trim() })).concat({ type: 'state', chapterId: parts[0].chapterId,
      text: '不应入库的要点', evidence: '这段话从未出现在原稿。' }) });
  });
  await connect();
  const book = await api('/api/projects', { title: '长篇试验' });
  const root = '/api/projects/' + book.id;
  const chapters = [{ id: 'early', title: '第十二章', text: '  ' + phrase },
    { id: 'active', title: '第八十章', text: '她站在门口。' }, { id: 'future', title: '第八十一章', text: later }];
  await api(root, { chapters, activeChapterId: 'active', memorySettings: { extractPlot: true } }, 'PATCH');
  const read = () => api(root + '/memories');
  const initial = await waitFor(read, value => value.memories[0].plotExtraction?.status === 'complete');
  assert.deepEqual(initial.points.map(point => point.evidence), [phrase, '她站在门口。', later]);
  assert.equal(initial.points[0].offset, 2);
  await api(root + '/generate', { chapterId: 'active', depth: 'deep', prompt: '核对「铜钥匙」的秘密' });
  assert.match(writingPrompt, /相关前文证据[\s\S]*林岚答应保守铜钥匙的秘密/);
  assert.doesNotMatch(writingPrompt, /熔化|不应入库/);

  await api(root, { chapter: { ...chapters[0], text: changed } }, 'PATCH');
  assert.ok(!(await read()).points.some(point => point.chapterId === 'early'));
  await api(root + '/memories', { chapterId: 'active' });
  const updated = await waitFor(read, value => value.memories[0].plotExtraction?.status === 'complete');
  assert.equal(updated.points.find(point => point.chapterId === 'early').evidence, changed);
  assert.deepEqual(extracted, ['early', 'active', 'future', 'early']);
});

test('extracts cards through the active model, keeps author cards separate, and retries failed snapshots', async t => {
  let calls = 0;
  let badEvidence = false;
  let writingPrompt;
  const { api, connect } = await setup(t, message => {
    if (!message.startsWith('[')) {
      writingPrompt = message;
      return '模型已完成创作请求。';
    }
    calls++;
    const [chapter] = JSON.parse(message);
    return JSON.stringify({ cards: entities.map(([type, name]) => card(chapter, type, name,
      badEvidence ? '这是一段模型捏造的原文。' : evidence)) });
  });
  const created = await api('/api/projects', { title: '档案测试作品' });
  const projectPath = `/api/projects/${created.id}`;
  const memoryPath = projectPath + '/memories';
  const chapter = { ...created.chapters[0], title: '港口', text: evidence };
  const authored = { id: 'author-card', type: 'character', title: '林岚', description: '作者设定：她熟悉潮汐。' };
  await api(projectPath, { chapter, cards: [authored] }, 'PATCH');
  const off = await api(memoryPath, { chapterId: chapter.id });
  assert.equal(off.memories[0].cardExtraction, undefined);

  await api(projectPath, { memorySettings: { extractCards: true } }, 'PATCH');
  const queued = await api(memoryPath, { chapterId: chapter.id });
  const first = queued.memories[0].id;
  assert.equal(queued.memories[0].cardExtraction.status, 'pending');
  assert.equal(calls, 0);
  await connect();
  const complete = await waitFor(() => api(memoryPath), result => result.memories[0].cardExtraction?.status === 'complete');
  assert.equal(calls, 1);
  assert.deepEqual(complete.cards.map(item => [item.type, item.title]), entities);
  assert.equal(complete.cards.find(item => item.type === 'character').authored, true);
  assert.equal(complete.cards[0].notes[0].memoryId, first);
  assert.equal(complete.cards[0].notes[0].evidence, evidence);
  assert.deepEqual((await api('/api/state')).projects[0].cards, [authored]);
  assert.deepEqual((await api(memoryPath + '/' + first)).snapshot.cards, [authored]);

  await api(projectPath + '/generate', { chapterId: chapter.id, selected: { memories: [first] }, prompt: '续写这一场' });
  assert.match(writingPrompt, /AI 设定卡（从正文提取，仅供参考）/);

  const duplicate = await api(memoryPath, { chapterId: chapter.id });
  const duplicateId = duplicate.memories[0].id;
  const unchanged = await waitFor(() => api(memoryPath), result =>
    result.memories.find(memory => memory.id === duplicateId).cardExtraction.status === 'complete');
  assert.equal(calls, 1);
  assert.equal(unchanged.cards.length, 4);

  badEvidence = true;
  await api(projectPath, {
    chapter: { ...chapter, text: evidence + '\n她在码头停下脚步。' },
    appendChapter: { id: 'next-chapter', title: '下章', text: '' }, finishChapterId: chapter.id, activeChapterId: 'next-chapter',
  }, 'PATCH');
  const failed = await waitFor(() => api(memoryPath), result => result.memories[0].cardExtraction?.status === 'failed');
  const failedId = failed.memories[0].id;
  assert.deepEqual(failed.memories[0].reasons, ['chapter']);
  assert.match(failed.memories[0].cardExtraction.error, /未返回可核对/);
  assert.equal(failed.cards.length, 4);
  badEvidence = false;
  await api(memoryPath + '/' + failedId + '/retry-cards', {});
  const retried = await waitFor(() => api(memoryPath), result => result.memories[0].cardExtraction?.status === 'complete');
  assert.equal(retried.cards.length, 4);
  assert.equal(retried.cards[0].notes[0].memoryId, failedId);
  assert.deepEqual((await api('/api/state')).projects[0].cards, [authored]);

  await api(projectPath, { chapter: { ...chapter, text: '' }, memorySettings: { volumeEnabled: true, characterThreshold: 1 } }, 'PATCH');
  const cleared = await waitFor(() => api(memoryPath), result => result.memories[0].reasons.includes('volume') &&
    result.memories[0].cardExtraction?.status === 'complete');
  assert.deepEqual(cleared.cards, []);
  assert.deepEqual(checkDue({ createdAt: '2026-01-01', memorySettings: { extractCards: true }, chapters: [chapter] }, '2026-01-09').cardExtraction, { status: 'pending' });
});

test('resumes long memories after restarting without reprocessing saved batches', async t => {
  let calls = 0;
  let hold = true;
  let markBlocked;
  const reachedBlockedBatch = new Promise(resolve => { markBlocked = resolve; });
  const { api, connect, restart } = await setup(t, message => {
    calls++;
    const [chapter] = JSON.parse(message);
    if (calls === 2 && hold) {
      markBlocked();
      return undefined;
    }
    const quote = chapter.text.includes(evidence) ? evidence : '纸灯照亮了站台。';
    const title = quote === evidence ? '铜钥匙' : '纸灯';
    return JSON.stringify({ cards: [card(chapter, 'prop', title, quote)] });
  });
  await connect();
  const created = await api('/api/projects', { title: '长章测试作品' });
  const path = `/api/projects/${created.id}`;
  const chapter = { ...created.chapters[0], text: evidence + '段'.repeat(9_000) + '纸灯照亮了站台。' };
  await api(path, { chapter, memorySettings: { extractCards: true } }, 'PATCH');
  await api(path + '/memories', { chapterId: chapter.id });
  await reachedBlockedBatch;
  const inProgress = await api(path + '/memories');
  assert.equal(inProgress.memories[0].cardExtraction.completed, 1);
  hold = false;
  await restart();
  const finished = await waitFor(() => api(path + '/memories'), result => result.memories[0].cardExtraction?.status === 'complete');
  assert.equal(calls, 3);
  assert.deepEqual(finished.cards.map(item => item.title), ['铜钥匙', '纸灯']);
});
