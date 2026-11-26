import assert from 'node:assert/strict';
import test from 'node:test';
import { extractArticle, splitArticle } from '../lib/articles.mjs';

test('splits Chinese and English chapter headings, preserving internal sections and paragraph breaks', () => {
  const input = '楔子\r\n开端。\r\n\r\n第一章 雨里\r\n　　第一次见面。\r\n\r\n第一节 问答\r\n他没有说话。\r\n\r\n第２章：车站\r\n汽笛响了。\r\n\r\nChapter III — The Letter\r\n最后一封信。\r\n\r\n尾声\r\n天亮了。';
  const { chapters, recognized } = splitArticle(input, '旧车票');
  assert.equal(recognized, 5);
  assert.deepEqual(chapters.map(chapter => chapter.title), ['楔子', '第一章 雨里', '第２章：车站', 'Chapter III — The Letter', '尾声']);
  assert.equal(chapters[1].text, '　　第一次见面。\n\n第一节 问答\n他没有说话。');
});

test('reads Markdown chapter levels without splitting smaller headings or fenced examples', async () => {
  const input = '# 旧城\n\n## 晨雾\n第一段。\n\n### 小巷\n第二段。\n\n~~~text\n第一百章 不拆分\n~~~\n\n夜色\n----\n收尾。';
  const parsed = await extractArticle('旧城.md', Buffer.from(input));
  assert.deepEqual(parsed.chapters.map(chapter => chapter.title), ['晨雾', '夜色']);
  assert.match(parsed.chapters[0].text, /### 小巷[\s\S]*第一百章 不拆分/);
  assert.equal(parsed.chapters[1].text, '收尾。');
  assert.equal(parsed.text, input);
});

test('ignores a repeated plain-text table of contents when finding chapter boundaries', () => {
  const input = '目录\n\n第一章 回来\n第二章 留下\n\n第一章：回来\n她回来了。\n\n第二章 留下\n他选择留下。';
  const parsed = splitArticle(input, '故事');
  assert.deepEqual(parsed.chapters, [
    { title: '第一章：回来', text: '她回来了。' },
    { title: '第二章 留下', text: '他选择留下。' },
  ]);
  assert.equal(parsed.text, input);
});

test('keeps prose before a heading and uses one chapter when nothing is recognized', () => {
  const noHeading = '第一章的故事已经结束。\nChapter 1 describes the station.\n这里是正文字句。';
  const plain = splitArticle(noHeading, '随笔');
  assert.equal(plain.recognized, 0);
  assert.deepEqual(plain.chapters, [{ title: '随笔', text: noHeading }]);
  const withOpening = splitArticle('这一页讲她的来历。\n\n第一章\n这一页写列车。', '连载');
  assert.deepEqual(withOpening.chapters, [
    { title: '前置内容', text: '这一页讲她的来历。' },
    { title: '第一章', text: '这一页写列车。' },
  ]);
});
