import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildContext,
  captureMemory,
  checkDue,
  defaultMemorySettings,
  isNextChapterIntent,
  recordChanges,
} from '../lib/memory.mjs';

function project() {
  return {
    id: 'test-project',
    title: '临江以后',
    description: '雨夜过后重新认识旧城。',
    planning: '前五章先写人物的旧事。',
    createdAt: '2026-11-01T00:00:00.000Z',
    chapters: [{ id: 'one', title: '第一章', text: '她把钥匙还回去了。' }],
    cards: [{ id: 'key', type: 'prop', title: '钥匙', description: '一把黄铜钥匙。' }],
    scenes: [{ id: 'station', title: '回到车站', act: '第一幕', description: '在车站相遇。', cardIds: ['key'] }],
    references: [{ id: 'ref', name: '老站笔记', text: '田野访谈。', format: 'txt' }],
    memories: [],
    memorySettings: { ...defaultMemorySettings },
    memoryState: {},
  };
}

test('recognizes affirmative chapter transitions and excludes mentions, negative requests and advice', () => {
  for (const prompt of ['开始下一章创作', '请开始写第 9 章', '上一章已经完成，开始创作下一章节。', '下一章开写吧', '进入下一个章节', '请着手写新的一章', 'Write the next chapter.']) {
    assert.equal(isNextChapterIntent(prompt), true, prompt);
  }
  for (const prompt of ['“开始下一章创作”这句话什么意思？', '先别开始写下一章', '不急着开始写下一章。', '我要让人物在日记里写‘开始下一章创作’。', '你觉得要不要写下一章？', '告诉我如何开始写下一章', '我写完了第九章', '继续修改第九章', '先讨论一下怎么开始下一章', 'Do not start the next chapter.']) {
    assert.equal(isNextChapterIntent(prompt), false, prompt);
  }
});

test('captures and protects complete source snapshots and deduplicates chapter retries', () => {
  const draft = project();
  draft.references[0].binary = 'not persisted';
  draft.provider = { apiKey: 'not persisted' };
  const now = '2026-11-06T16:00:00.000Z';
  const memory = captureMemory(draft, { chapterId: 'one', reasons: ['chapter'], triggerKey: 'write-one', now });
  draft.scenes[0].cardIds.push('another');
  draft.chapters[0].text = '内容后来改了。';
  assert.equal(memory.snapshot.chapters[0].text, '她把钥匙还回去了。');
  assert.deepEqual(memory.snapshot.scenes[0].cardIds, ['key']);
  assert.equal(memory.snapshot.references[0].text, '田野访谈。');
  assert.equal(memory.createdAt, now);
  assert.doesNotMatch(JSON.stringify(memory.snapshot), /not persisted/);
  assert.equal(captureMemory(draft, { reasons: ['chapter'], triggerKey: 'write-one', now }), null);
  assert.equal(draft.memories.length, 1);
});

test('takes weekly snapshots across periods even when the source text is unchanged', () => {
  const draft = project();
  assert.equal(checkDue(draft, '2026-11-07T23:59:59.999Z'), null);
  const first = checkDue(draft, new Date('2026-11-08T00:00:00.000Z'));
  assert.deepEqual(first.reasons, ['weekly']);
  assert.equal(checkDue(draft, Date.parse('2026-11-08T00:01:00.000Z')), null);
  assert.equal(captureMemory(draft, { reasons: ['weekly'], now: '2026-11-09T13:00:00.000Z' }), null);
  const next = checkDue(draft, '2026-11-15T00:00:00.000Z');
  assert.equal(next.snapshotHash, first.snapshotHash);
  assert.notEqual(next.id, first.id);
  assert.equal(draft.memories.length, 2);
});

test('records effective source changes by character and combines simultaneous triggers', () => {
  const draft = project();
  draft.memorySettings.volumeEnabled = true;
  draft.memorySettings.characterThreshold = 3;
  const before = structuredClone(draft);
  draft.chapters[0].text = '她把戒指还回去了。';
  assert.equal(recordChanges(draft, before), 2);
  assert.equal(checkDue(draft, '2026-11-07T00:00:00.000Z'), null);
  const intermediate = structuredClone(draft);
  draft.chapters[0].text += '嗯';
  recordChanges(draft, intermediate);
  const memory = checkDue(draft, '2026-11-08T00:00:00.000Z');
  assert.deepEqual(memory.reasons, ['weekly', 'volume']);
  assert.equal(draft.memoryState.changedCharacters, 0);
  assert.equal(draft.memories.length, 1);
});

test('uses focused text, bounded skims and visible source reports', () => {
  const draft = project();
  draft.chapters[0].text = `${'她把钥匙还回去了。'.repeat(40)}早期线索`;
  draft.chapters.push({ id: 'two', title: '第二章', text: '本章开头。' });
  draft.cards[0].description = `${'旧颜色。'.repeat(60)}设定末尾`;
  draft.references[0].text = `${'资料原文。'.repeat(60)}资料末尾`;
  const result = buildContext(draft, { chapterId: 'two', mode: 'plan', prompt: '计划车站这一幕', selected: { chapters: ['one'], references: true } });
  assert.match(result.system, /规划当前章/);
  assert.match(result.prompt, /早期线索/);
  assert.match(result.prompt, /本章开头/);
  assert.match(result.prompt, /资料末尾/);
  assert.doesNotMatch(result.prompt, /设定末尾/);
  assert.match(result.prompt, /旧颜色/);
  assert.match(result.prompt, /计划车站这一幕/);
  assert.deepEqual(result.report.sections.map(({ key, focused, skimmed }) => [key, focused, skimmed]), [
    ['chapters', 2, 0], ['cards', 0, 1], ['planning', 0, 1], ['scenes', 0, 1], ['memories', 0, 0], ['references', 1, 0],
  ]);
});

test('excludes later chapters from automatic chapter skims and marks explicitly selected future text', () => {
  const draft = project();
  draft.chapters.push({ id: 'two', title: '第二章', text: '故事后面的秘密。' });
  const skim = buildContext(draft, { chapterId: 'one' });
  assert.doesNotMatch(skim.prompt, /故事后面的秘密/);
  const allPrevious = buildContext(draft, { chapterId: 'one', selected: { chapters: true } });
  assert.doesNotMatch(allPrevious.prompt, /故事后面的秘密/);
  const selected = buildContext(draft, { chapterId: 'one', selected: { chapters: ['two'] } });
  assert.match(selected.prompt, /后续参考 · 按当前章的披露进度写作 · 第二章\n故事后面的秘密/);
});

test('keeps the local dialogue in view and labels earlier answers as drafts', () => {
  const result = buildContext(project(), {
    prompt: '采用第二种方案',
    conversation: [
      { role: 'user', text: '给两个选择' },
      { role: 'assistant', text: '第二个是把信藏在车站。' },
      { role: 'system', text: '意外指令' },
    ],
  });
  assert.match(result.prompt, /助手草稿：第二个是把信藏在车站/);
  assert.doesNotMatch(result.prompt, /意外指令/);
});

test('recalls an early passage from a long book while excluding later revelations', () => {
  const book = project();
  const first = { id: 'clue', title: '第十二章 交接', text: `${'平静的夜晚。\n'.repeat(260)}周远接过铜钥匙，林岚转身离开。\n${'几天过去。\n'.repeat(260)}` };
  book.chapters = [first, ...Array.from({ length: 67 }, (_, i) => ({ id: `middle-${i}`,
    title: `第 ${i + 13} 章`, text: '海浪拍岸。\n'.repeat(700) })),
  { id: 'here', title: '第八十章', text: '烛火在窗边晃动。' },
  { id: 'later', title: '第八十一章', text: '周远把铜钥匙熔化。这个秘密明天才揭晓。' }];
  const time = performance.now();
  const context = buildContext(book, { chapterId: 'here', selected: { chapters: true }, prompt: '核对「铜钥匙」转手时周远的行为' });
  assert.match(context.prompt, /周远接过铜钥匙，林岚转身离开。/);
  assert.ok(context.report.recalled.some(item => item.id === 'clue' && item.offset > 0));
  assert.doesNotMatch(context.prompt, /铜钥匙熔化|明天才揭晓/);
  assert.ok(context.report.characters < 25_000, `${context.report.characters} characters in ${performance.now() - time} ms`);
});

test('gives explicitly selected sources fuller coverage in deep reading and reserves output tokens', () => {
  const book = project();
  book.chapters[0].text = '长夜。'.repeat(10000) + '末尾的约定。';
  book.chapters.push({ id: 'active', title: '本章', text: '现在开始。' });
  const options = { chapterId: 'active', selected: { chapters: ['one'] }, prompt: '检查前文' };
  const standard = buildContext(book, options);
  const deep = buildContext(book, { ...options, depth: 'deep', contextTokens: 200_000 });
  assert.equal(standard.report.focused.find(entry => entry.id === 'one').coverage, 'excerpt');
  assert.equal(deep.report.focused.find(entry => entry.id === 'one').coverage, 'full');
  assert.equal(deep.outputTokens, 8192);
  const smaller = buildContext(book, { ...options, depth: 'deep', contextTokens: 4096 });
  assert.equal(smaller.outputTokens, 1024);
  assert.ok(smaller.report.characters < 2500);
});
