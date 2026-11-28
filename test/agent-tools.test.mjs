import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { callProvider } from '../lib/providers.mjs';
import { chapterGenerationIntent, splitGeneratedChapters } from '../lib/ai-chapters.mjs';
import { startWriterServer } from '../server.mjs';

function call(name, args, index = 1) {
  return { id: 'call-' + index, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

function chat(content, calls) {
  return { choices: [{ message: { role: 'assistant', content, ...(calls && { tool_calls: calls }) } }] };
}

async function modelServer(t, reply) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks));
    requests.push(payload);
    const response = reply(payload, requests.length);
    res.writeHead(response.status || 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response.value ?? response));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return { requests, endpoint: `http://127.0.0.1:${server.address().port}/v1` };
}

async function application(t, endpoint) {
  const directory = await mkdtemp(join(tmpdir(), 'agent-writer-tool-test-'));
  const launch = () => startWriterServer({ port: 0, directory });
  let server = await launch();
  t.after(async () => {
    await server.close();
    for (const file of ['workspace.json', 'workspace.tmp', 'vault.key']) await rm(join(directory, file), { force: true });
    await rmdir(directory);
  });
  const api = async (path, data, method = 'POST', status = 200) => {
    const response = await fetch(server.origin + path, data === undefined ? undefined : {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    const output = await response.json();
    assert.equal(response.status, status, JSON.stringify(output));
    return output;
  };
  api.restart = async () => {
    await server.close();
    server = await launch();
  };
  await api('/api/providers/save', { id: 'custom', endpoint, protocol: 'chat', model: 'fiction-tools' });
  return api;
}

function results(payload) {
  return payload.messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content));
}

test('the workbench agent chains workspace tools and requires one-time confirmation for deletion', async t => {
  const mock = await modelServer(t, (body, round) => {
    if (round === 1) return chat(null, [call('projects', { action: 'create', title: '白湾故事' })]);
    if (round === 2) return chat(null, [
      call('chapters', { action: 'create', title: '雨夜', text: '港口的船鸣了一声。' }, 2),
      call('setting_cards', { action: 'create', type: 'character', title: '船员', description: '正在等人。' }, 3),
      call('references', { action: 'add_text', title: '港口资料', text: '潮位记录。' }, 4),
    ]);
    if (round === 3) {
      const [, chapter, card] = results(body);
      return chat(null, [
        call('outline', { action: 'create', title: '候船', chapter_id: chapter.data.id, card_ids: [card.data.id] }, 5),
        call('memories', { action: 'save', chapter_id: chapter.data.id }, 6),
        call('workspace', { action: 'reading', source: 'cards', all: true }, 7),
      ]);
    }
    if (round === 4) return chat('项目、章节和记忆已保存。');
    if (round === 5 || round === 7) return chat(null, [call('chapters', { action: 'delete' })]);
    return chat(results(body).at(-1).ok ? '已删除。' : '操作未执行。');
  });
  const api = await application(t, mock.endpoint);
  const made = await api('/api/agent/generate', { prompt: '新建项目、章节和设定，并保存记忆。' });
  assert.equal(made.trace.length, 7);
  assert.ok(made.trace.every(item => item.ok));
  assert.deepEqual(made.ui.reading, { cards: true });
  assert.equal(mock.requests[0].tools.length, 9);
  const [book] = (await api('/api/state')).projects;
  const [first, second] = book.chapters;
  assert.equal(second.text, '港口的船鸣了一声。');
  const transferred = await api('/api/projects/' + book.id + '/conversation/' + second.id);
  assert.equal(transferred.entries[1].text, made.text);
  assert.equal(book.scenes[0].chapterId, second.id);
  assert.deepEqual(book.scenes[0].cardIds, [book.cards[0].id]);
  assert.equal(book.references.length, 1);
  assert.ok(book.memories.some(memory => memory.reasons.includes('manual')));

  const path = '/api/projects/' + book.id;
  const generate = () => api(path + '/generate', { prompt: '删除雨夜章节', chapterId: second.id });
  const approved = (pending, choice) => api(path + '/agent/continue', { id: pending.id, approved: choice });
  const firstRequest = await generate();
  assert.match(firstRequest.pending.summary, /白湾故事.*雨夜/);
  assert.equal(firstRequest.pending.kind, 'confirm');
  assert.equal((await api('/api/state')).projects[0].chapters.length, 2);
  const cancelled = await approved(firstRequest.pending, false);
  assert.equal(cancelled.trace[0].ok, false);
  const secondRequest = await generate();
  assert.equal((await approved(secondRequest.pending, true)).text, '已删除。');
  await api(path + '/agent/continue', { id: secondRequest.pending.id, approved: true }, 'POST', 409);
  const after = (await api('/api/state')).projects[0];
  assert.deepEqual(after.chapters.map(item => item.id), [first.id]);
  assert.equal(after.scenes[0].chapterId, '');
});

test('the compatibility transport executes tools and imports a user-selected file', async t => {
  const mock = await modelServer(t, (payload, round) => {
    if (payload.tools) return { status: 400, value: { error: { message: 'tools field unsupported' } } };
    if (round === 2) return chat(JSON.stringify({ agent_writer_tool_calls: [{ name: 'articles',
      arguments: { action: 'preview_file' } }] }));
    if (round === 3) return chat(JSON.stringify({ agent_writer_tool_calls: [{ name: 'articles',
      arguments: { action: 'import_preview', destination: 'new' } }] }));
    return chat('文章已自动分章导入。');
  });
  const api = await application(t, mock.endpoint);
  const open = await api('/api/agent/generate', { prompt: '请选择文章，预览后导入到新项目。' });
  assert.equal(open.pending.kind, 'file');
  assert.equal((await api('/api/state')).projects.length, 0);
  const completed = await api('/api/projects/workspace/agent/continue', {
    id: open.pending.id, approved: true,
    file: { name: '夜航.txt', data: Buffer.from('第一章 港口\n夜色渐深。\n\n第二章 海面\n船出港了。').toString('base64') },
  });
  assert.deepEqual(completed.trace.map(item => item.ok), [true, true]);
  const [book] = (await api('/api/state')).projects;
  assert.equal(book.title, '夜航');
  assert.equal(book.chapters.length, 2);
  assert.match(book.chapters[1].text, /船出港了/);
});

test('chat files use excerpts and a scoped read tool without changing the project', async t => {
  const mock = await modelServer(t, (_payload, round) => round === 1
    ? chat(null, [call('attachments', { action: 'read', offset: 12_000 })])
    : chat('已阅读资料。'));
  const api = await application(t, mock.endpoint);
  const project = await api('/api/projects', { title: '海上笔记' }, 'POST', 201);
  const text = '远岸笔记。' + '潮'.repeat(12_500) + '页末的灯塔。';
  const file = await api('/api/agent/attachments', {
    name: '远岸.md', data: Buffer.from(text).toString('base64'),
  }, 'POST', 201);
  assert.equal(file.characters, text.length);
  assert.ok(!('text' in file));
  assert.equal(mock.requests.length, 0);

  const response = await api('/api/agent/generate', { attachmentIds: [file.id] });
  assert.match(mock.requests[0].messages[1].content, /请阅读这条消息附带的文件/);
  assert.doesNotMatch(mock.requests[0].messages[1].content, /页末的灯塔/);
  assert.match(results(mock.requests[1])[0].data.text, /页末的灯塔/);
  assert.equal(results(mock.requests[1])[0].data.next_offset, null);
  assert.deepEqual(response.report.attachments, [{ name: '远岸.md', characters: text.length, included: 12_000 }]);

  const path = '/api/projects/' + project.id + '/generate';
  await api(path, { prompt: '接着看刚才的文件。', recentAttachmentIds: [file.id] });
  assert.match(mock.requests[2].messages[1].content, /之前的消息/);
  await api(path, { prompt: '只看当前正文。' });
  assert.ok(!mock.requests[3].tools.some(tool => tool.function.name === 'attachments'));
  assert.doesNotMatch(mock.requests[3].messages[1].content, /远岸笔记/);
  await api(path, { attachmentIds: ['not-present'] }, 'POST', 400);
  await api('/api/agent/attachments', { name: '不支持.png', data: 'aaa=' }, 'POST', 400);
  assert.equal(mock.requests.length, 4);
  const [stored] = (await api('/api/state')).projects;
  assert.equal(stored.references.length, 0);
  assert.deepEqual(stored.chapters, project.chapters);
});

test('conversation history survives restart, stays scoped, and restores model context', async t => {
  const mock = await modelServer(t, (_payload, round) => {
    if (round === 1) return chat('工作区回复。');
    if (round === 2) return chat(null, [call('workspace', { action: 'save' })]);
    if (round === 3) return chat('蓝伞是这一章的线索。');
    if (round === 4) return chat(null, [call('chapters', { action: 'delete' })]);
    return chat('我记得蓝伞。');
  });
  const api = await application(t, mock.endpoint);
  await api('/api/agent/generate', { prompt: '记住这里是工作区。' });
  const book = await api('/api/projects', { title: '旧城' }, 'POST', 201);
  const first = book.activeChapterId;
  const second = 'another-chapter';
  const path = '/api/projects/' + book.id;
  await api(path, { appendChapter: { id: second, title: '第二章' } }, 'PATCH');
  const attached = await api('/api/agent/attachments', { name: '线索.txt',
    data: Buffer.from('仅本次附件缓存中的原文。').toString('base64') }, 'POST', 201);
  const saved = await api(path + '/generate', { chapterId: first, prompt: '请记住蓝伞的线索。', attachmentIds: [attached.id] });
  const pending = await api(path + '/generate', { chapterId: second, prompt: '删除第二章。' });
  assert.equal(pending.pending.kind, 'confirm');
  await api.restart();

  const history = chapterId => api(path + '/conversation/' + chapterId);
  const [user, reply] = (await history(first)).entries;
  assert.equal(user.text, '请记住蓝伞的线索。');
  assert.deepEqual(user.attachments, [attached]);
  assert.equal(reply.text, saved.text);
  assert.equal(reply.id, saved.entryId);
  assert.equal(reply.trace[0].ok, true);
  assert.equal(reply.report.attachments[0].name, attached.name);
  const secondEntries = (await history(second)).entries;
  assert.equal(secondEntries.length, 2);
  assert.equal(secondEntries[0].text, '删除第二章。');
  assert.match(secondEntries[1].text, /重新发起/);
  assert.ok(!('pending' in secondEntries[1]));
  await api(path + '/agent/continue', { id: pending.pending.id, approved: true }, 'POST', 409);
  const workspace = await api('/api/agent/conversation');
  assert.deepEqual(workspace.entries.map(entry => entry.text), ['记住这里是工作区。', '工作区回复。']);
  const state = await api('/api/state');
  assert.ok(!('workspaceConversation' in state));
  assert.ok(!('conversations' in state.projects[0]));
  assert.equal(state.projects[0].chapters.length, 2);

  await api(path + '/generate', { chapterId: first, prompt: '刚才说的是哪条线索？' });
  const context = mock.requests.at(-1).messages[1].content;
  assert.match(context, /本场对话[\s\S]*蓝伞是这一章的线索/);
  assert.doesNotMatch(context, /工作区回复|删除第二章|仅本次附件缓存/);
  await api(path, { removeChapterId: second }, 'PATCH');
  await api(path + '/conversation/' + second, undefined, 'GET', 404);
  assert.equal((await history(first)).entries.length, 4);
});

test('lets the model search exact manuscript passages and skips duplicate tool text in one run', async t => {
  const mock = await modelServer(t, (_payload, round) => round <= 2
    ? chat(null, [call('chapters', { action: 'search', query: '「铜钥匙」' }, round)]) : chat('已经查明。'));
  const api = await application(t, mock.endpoint);
  const book = await api('/api/projects', { title: '旧城' }, 'POST', 201);
  const path = '/api/projects/' + book.id;
  await api(path, { chapters: [{ id: 'prior', title: '往事', text: '入夜后刮起了风。'.repeat(35) + '铜钥匙交给了周远。' + '远处有灯。'.repeat(120) },
    { id: 'now', title: '现在', text: '' }, { id: 'future', title: '未来', text: '铜钥匙在结尾熔化。' }] }, 'PATCH');
  const response = await api(path + '/generate', { chapterId: 'now', prompt: '请用工具核对铜钥匙的来历。' });
  const [first, second] = results(mock.requests[2]);
  assert.equal(first.data.items[0].id, 'prior');
  assert.match(first.data.items[0].text, /铜钥匙交给了周远/);
  assert.equal(first.data.items.some(item => item.id === 'future'), false);
  assert.equal(second.same_as, 'call-1');
  assert.equal(response.trace.length, 2);
});

test('detects requests for multiple prose chapters without treating a chapter number or outline as a count', () => {
  assert.deepEqual(chapterGenerationIntent('请生成前两章正文'), { enabled: true, count: 2 });
  assert.deepEqual(chapterGenerationIntent('从第 4 章到第 6 章写正文'), { enabled: true, count: 3 });
  assert.deepEqual(chapterGenerationIntent('Write three chapters'), { enabled: true, count: 3 });
  assert.equal(chapterGenerationIntent('写第三章').enabled, false);
  assert.equal(chapterGenerationIntent('写第 12 章').enabled, false);
  assert.equal(chapterGenerationIntent('给我写一个三章大纲').enabled, false);
  assert.equal(chapterGenerationIntent('写两章正文，只在对话里输出').draftOnly, true);
  assert.deepEqual(splitGeneratedChapters('好的。\n\n**第一章 港口**\n远处一声汽笛。\n\n## 第二章 码头\n他在雨里等待。'), [
    { title: '第一章 港口', text: '远处一声汽笛。' }, { title: '第二章 码头', text: '他在雨里等待。' },
  ]);
});

test('writes structured or titled multi-chapter prose to the manuscript and exports selected chapters in book order', async t => {
  const mock = await modelServer(t, (body, round) => {
    if (round === 1) return chat(null, [call('articles', { action: 'write_chapters', chapters: [
      { title: '第一章 雨港', text: '雨打在窗上。' }, { title: '第二章 海灯', text: '灯亮了。' },
    ] })]);
    if (round === 2) return chat('已写入两章。');
    if (round === 3) return chat('### 第三章 渡船\n薄雾升起。');
    if (round === 4) return chat('## 第三章 渡船\n薄雾升起。\n\n## 第四章 远岸\n船靠了岸。');
    if (round === 5) return chat('## 第一章\n梗概一。\n## 第二章\n梗概二。');
    if (round === 6) return chat(null, [call('chapters', { action: 'export_txt' })]);
    return chat('TXT 已保存。');
  });
  const api = await application(t, mock.endpoint);
  const created = await api('/api/projects', { title: '港口来信' }, 'POST', 201);
  const path = '/api/projects/' + created.id;
  const first = await api(path + '/generate', { prompt: '请生成前两章正文' });
  assert.equal(first.ui.chapterId, created.chapters[0].id);
  let project = (await api('/api/state')).projects[0];
  assert.deepEqual(project.chapters.map(item => item.text), ['雨打在窗上。','灯亮了。']);
  const second = await api(path + '/generate', { prompt: '继续写第3章和第4章' });
  assert.match(second.text, /自动分章写入/);
  assert.match(mock.requests[3].messages[0].content, /重新生成/);
  project = (await api('/api/state')).projects[0];
  const ids = project.chapters.map(item => item.id);
  assert.equal(second.ui.chapterId, ids[2]);
  assert.deepEqual(project.chapters.map(item => item.text), ['雨打在窗上。','灯亮了。','薄雾升起。','船靠了岸。']);

  await api(path + '/generate', { prompt: '写一个两章大纲', mode: 'plan' });
  assert.equal((await api('/api/state')).projects[0].chapters.length, 4);
  const all = await api(path + '/export-txt', {});
  assert.equal(all.filename, '港口来信.txt');
  assert.equal(all.chapterCount, 4);
  const selected = await api(path + '/export-txt', { chapterIds: [ids[3], ids[0]] });
  assert.equal(selected.chapterCount, 2);
  assert.equal(selected.text, '\uFEFF第一章 雨港\r\n\r\n雨打在窗上。\r\n\r\n第四章 远岸\r\n\r\n船靠了岸。\r\n');
  await api(path + '/export-txt', { chapterIds: [] }, 'POST', 400);
  await api(path + '/export-txt', { chapterIds: ['deleted'] }, 'POST', 400);
  const request = await api(path + '/generate', { prompt: '导出全书为 TXT' });
  assert.equal(request.pending.kind, 'export');
  const complete = await api(path + '/agent/continue', { id: request.pending.id, approved: true });
  assert.equal(complete.trace[0].ok, true);
});

for (const protocol of ['responses', 'messages']) {
  test(`${protocol} replays native tool calls and tool results in the provider's format`, async t => {
    const mock = await modelServer(t, (_body, round) => {
      if (protocol === 'responses') return round === 1 ? { output: [{ type: 'function_call', id: 'fc', call_id: 'tool-id',
        name: 'chapters', arguments: '{"action":"list"}' }] } : { output_text: '已完成' };
      return round === 1 ? { content: [{ type: 'tool_use', id: 'tool-id', name: 'chapters', input: { action: 'list' } }] } :
        { content: [{ type: 'text', text: '已完成' }] };
    });
    const provider = { endpoint: mock.endpoint, protocol, model: 'fiction-tools' };
    const options = { system: '写作助手', prompt: '列出章节', tools: [{
      name: 'chapters', description: '查看章节', parameters: { type: 'object', properties: {} },
    }] };
    const turn = await callProvider(provider, options);
    assert.equal(turn.calls[0].id, 'tool-id');
    const next = await callProvider(provider, { ...options, steps: [{ output: turn.output, results: [{ id: 'tool-id', content: '{}' }] }] });
    assert.equal(next.text, '已完成');
    const body = mock.requests[1];
    if (protocol === 'responses') {
      assert.deepEqual(body.input.at(-1), { type: 'function_call_output', call_id: 'tool-id', output: '{}' });
      assert.equal(body.input.at(-2).type, 'function_call');
    } else {
      assert.deepEqual(body.messages.at(-1).content[0], { type: 'tool_result', tool_use_id: 'tool-id', content: '{}' });
      assert.equal(body.messages.at(-2).content[0].type, 'tool_use');
    }
  });
}
