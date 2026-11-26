import assert from 'node:assert/strict';
import test from 'node:test';
import { crc32 } from 'node:zlib';
import { extractReference, MAX_REFERENCE_BYTES } from '../lib/imports.mjs';
import { extractArticle } from '../lib/articles.mjs';

function zipFixture(files) {
  const chunks = [];
  const directory = [];
  let offset = 0;

  for (const [name, text] of Object.entries(files)) {
    const filename = Buffer.from(name);
    const contents = Buffer.from(text);
    const local = Buffer.alloc(30);
    const central = Buffer.alloc(46);
    const checksum = crc32(contents);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(contents.length, 18);
    local.writeUInt32LE(contents.length, 22);
    local.writeUInt16LE(filename.length, 26);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(contents.length, 20);
    central.writeUInt32LE(contents.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    chunks.push(local, filename, contents);
    directory.push(central, filename);
    offset += local.length + filename.length + contents.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(directory.length / 2, 8);
  end.writeUInt16LE(directory.length / 2, 10);
  end.writeUInt32LE(directory.reduce((length, chunk) => length + chunk.length, 0), 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...directory, end]);
}

function pdfFixture(showText = true) {
  const contents = showText ? 'BT /F1 12 Tf 50 300 Td (North entrance) Tj ET' : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${contents.length} >>\nstream\n${contents}\nendstream`,
  ];

  let result = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(result.length);
    result += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = result.length;
  result += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) result += `${String(offset).padStart(10, '0')} 00000 n \n`;
  result += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(result);
}

test('extracts UTF-8, GB18030 and UTF-16 reference text', async () => {
  const sample = '你好，旅人';
  assert.deepEqual(await extractReference('场景.md', Buffer.from(sample)), {
    name: '场景.md', format: 'md', text: sample,
  });
  assert.equal((await extractReference('片段.txt', Buffer.from('c4e3bac3', 'hex'))).text, '你好');
  const utf16 = Buffer.concat([Buffer.from('fffe', 'hex'), Buffer.from(sample, 'utf16le')]);
  assert.equal((await extractReference('资料.txt', utf16)).text, sample);
});

test('preserves visible HTML structure and ignores scripted text', async () => {
  const html = '<title>网页标题</title><div>第一段<script>脚本</script><br><span>第二行</span></div><p>尾声</p>';
  const { text } = await extractReference('场景.html', Buffer.from(html));
  assert.match(text, /^第一段\n第二行/);
  assert.match(text, /尾声$/);
  assert.doesNotMatch(text, /脚本|网页标题/);
});

test('keeps inline XML text in its original order', async () => {
  const markup = '<root><p>车<em>站</em>。</p><p>候车厅</p></root>';
  assert.equal((await extractReference('前情.xml', Buffer.from(markup))).text, '车站。\n候车厅');
});

test('extracts Word and LibreOffice body text from their package members', async () => {
  const docx = zipFixture({
    'word/document.xml': '<w:document xmlns:w="urn:word"><w:p><w:r><w:t>街道</w:t><w:br/><w:t>车站</w:t></w:r></w:p><w:p><w:r><w:t>下篇</w:t></w:r></w:p></w:document>',
  });
  const odt = zipFixture({
    'content.xml': '<office:body xmlns:office="urn:office" xmlns:text="urn:text"><text:h>街道</text:h><text:p>车<text:span>站</text:span></text:p></office:body>',
  });
  assert.equal((await extractReference('草稿.docx', docx)).text, '街道\n车站\n下篇');
  assert.equal((await extractReference('草稿.odt', odt)).text, '街道\n车站');
});

test('uses Word outline styles and HTML headings for article imports, without adding markers to reference text', async () => {
  const docx = zipFixture({
    'word/styles.xml': '<w:styles xmlns:w="urn:word"><w:style w:styleId="custom"><w:name w:val="heading 2"/></w:style></w:styles>',
    'word/document.xml': '<w:document xmlns:w="urn:word"><w:p><w:pPr><w:pStyle w:val="custom"/></w:pPr><w:r><w:t>相遇</w:t></w:r></w:p><w:p><w:r><w:t>她在桥头等他。</w:t></w:r></w:p><w:p><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:r><w:t>分别</w:t></w:r></w:p><w:p><w:r><w:t>这一回他先走。</w:t></w:r></w:p></w:document>',
  });
  const expected = [{ title: '相遇', text: '她在桥头等他。' }, { title: '分别', text: '这一回他先走。' }];
  const word = await extractArticle('桥.docx', docx);
  const html = await extractArticle('桥.html', Buffer.from('<h2>相遇</h2><p>她在桥头等他。</p><h2>分别</h2><p>这一回他先走。</p>'));
  assert.deepEqual(word.chapters, expected);
  assert.deepEqual(html.chapters, expected);
  assert.equal(word.text, '相遇\n她在桥头等他。\n分别\n这一回他先走。');
  assert.equal((await extractReference('桥.docx', docx)).text, word.text);
});

test('extracts EPUB in reading order with relative and encoded paths', async () => {
  const files = zipFixture({
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
    'OPS/book.opf': '<package><manifest><item id="a" href="%E5%B0%BE%E5%A3%B0.xhtml"/><item id="b" href="part/open.xhtml"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>',
    'OPS/尾声.xhtml': '<html><body><p>尾声</p></body></html>',
    'OPS/part/open.xhtml': '<html><body><p>开场</p></body></html>',
  });
  assert.equal((await extractReference('小说.epub', files)).text, '开场\n\n尾声');
});

test('reads PDF text layers and explains when none is present', async () => {
  assert.equal((await extractReference('街道.pdf', pdfFixture())).text, 'North entrance');
  await assert.rejects(extractReference('扫描件.pdf', pdfFixture(false)), /没有可提取的文字层/);
});

test('reports unsupported, oversized and corrupt inputs', async () => {
  await assert.rejects(extractReference('照片.png', Buffer.from('photo')), /此格式暂时无法读取/);
  await assert.rejects(extractReference('词典.txt', Buffer.alloc(MAX_REFERENCE_BYTES + 1)), /25 MB/);
  await assert.rejects(extractReference('草稿.docx', Buffer.from('bad archive')), /无法读取 DOCX/);
});
