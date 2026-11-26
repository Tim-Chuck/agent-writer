import { posix as path } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { load } from 'cheerio';
import yauzl from 'yauzl';

export const MAX_REFERENCE_BYTES = 25 * 1024 * 1024;
export const MAX_REFERENCE_CHARACTERS = 2_000_000;
export const DOCUMENT_HEADING = '\uFDD0';
export const REFERENCE_EXTENSIONS = Object.freeze([
  'txt', 'text', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'html',
  'htm', 'xhtml', 'xml', 'docx', 'pdf', 'epub', 'odt',
]);

const MAX_ARCHIVE_TEXT_BYTES = 48 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 12_000;
const openZip = promisify(yauzl.fromBuffer);
const pdfPackage = new URL('../../', import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
const HTML_BLOCKS = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt', 'figcaption',
  'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
  'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tr', 'ul',
]);

class ReferenceImportError extends Error {}

function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('gb18030', { fatal: true }).decode(bytes);
    } catch {
      throw new ReferenceImportError('无法识别文件编码。请另存为 UTF-8 后重新导入。');
    }
  }
}

function normalizeText(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\0/g, '').trim();
}

function normalizeMarkupText(text) {
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n');
}

function appendHtmlText(nodes, result, preformatted = false, keepHeadings = false) {
  for (const node of nodes) {
    if (node.type === 'text') {
      result.push(preformatted ? node.data : node.data.replace(/[\t\n\f\r ]+/g, ' '));
      continue;
    }
    if (!node.name) continue;
    if (node.name === 'br' || node.name === 'hr') {
      result.push('\n');
      continue;
    }
    const isBlock = HTML_BLOCKS.has(node.name);
    if (isBlock) result.push('\n');
    if (keepHeadings && /^h[1-6]$/.test(node.name)) result.push(DOCUMENT_HEADING + node.name[1]);
    appendHtmlText(node.children ?? [], result, preformatted || node.name === 'pre', keepHeadings);
    if (isBlock) result.push('\n');
    if (node.name === 'td' || node.name === 'th') result.push('\t');
  }
}

function htmlText(source, keepHeadings = false) {
  const $ = load(source);
  $('script, style, template, noscript, svg, [hidden], [aria-hidden="true"]').remove();
  const result = [];
  appendHtmlText($('body').contents().toArray(), result, false, keepHeadings);
  return normalizeMarkupText(result.join(''));
}

function localName(node) {
  return node.name?.split(':').at(-1);
}

function xmlElements($, name) {
  return $('*').toArray().filter(node => localName(node) === name);
}

function appendXmlText(nodes, result, format) {
  for (const node of nodes) {
    if (node.type === 'text') {
      if (format === 'odt') result.push(node.data);
      continue;
    }
    const name = localName(node);
    if (name === 'p' || name === 'h' || name === 'del') continue;
    if (format === 'docx' && name === 't') {
      result.push(...(node.children ?? []).filter(child => child.type === 'text').map(child => child.data));
    } else if (name === 'tab') {
      result.push('\t');
    } else if (name === 'br' || name === 'cr' || name === 'line-break') {
      result.push('\n');
    } else if (format === 'odt' && name === 's') {
      const count = Number(node.attribs['text:c']) || 1;
      result.push(' '.repeat(Math.max(1, Math.min(1000, count))));
    } else {
      appendXmlText(node.children ?? [], result, format);
    }
  }
}

function localAttribute(node, name) {
  return Object.entries(node?.attribs ?? {}).find(([key]) => key.split(':').at(-1) === name)?.[1];
}

function child(node, name) {
  return node?.children?.find(item => localName(item) === name);
}

function wordHeadingLevel(style, properties) {
  const outline = localAttribute(child(properties, 'outlineLvl'), 'val');
  if (/^[0-5]$/.test(outline)) return Number(outline) + 1;
  return Number(/^(?:heading|标题)\s*([1-6])$/i.exec(style ?? '')?.[1]) || 0;
}

function officeText(source, format, keepHeadings = false, stylesSource = '') {
  const $ = load(source, { xml: true });
  const styles = new Map();
  if (keepHeadings && stylesSource) {
    for (const style of xmlElements(load(stylesSource, { xml: true }), 'style')) {
      const id = localAttribute(style, 'styleId');
      styles.set(id, wordHeadingLevel(localAttribute(child(style, 'name'), 'val'), child(style, 'pPr')));
    }
  }
  const paragraphs = $('*').toArray().filter(node => {
    const name = localName(node);
    return name === 'p' || (format === 'odt' && name === 'h');
  });
  return paragraphs.map(paragraph => {
    const result = [];
    appendXmlText(paragraph.children ?? [], result, format);
    const text = result.join('');
    if (!keepHeadings || !text.trim()) return text;
    let level = 0;
    if (format === 'docx') {
      const properties = child(paragraph, 'pPr');
      const style = localAttribute(child(properties, 'pStyle'), 'val');
      level = wordHeadingLevel(style, properties) || styles.get(style) || 0;
    } else if (localName(paragraph) === 'h') {
      level = Number(localAttribute(paragraph, 'outline-level')) || 1;
    }
    return level >= 1 && level <= 6 ? DOCUMENT_HEADING + level + text : text;
  }).join('\n');
}

function appendGenericXmlText(nodes, result) {
  for (const node of nodes) {
    if (node.type === 'text') {
      result.push(node.data);
      continue;
    }
    if (!node.name) continue;
    const children = node.children ?? [];
    const block = !children.some(child => child.type === 'text' && child.data.trim());
    if (block) result.push('\n');
    appendGenericXmlText(children, result);
    if (block || !node.parent?.children?.some(child => child.type === 'text' && child.data.trim())) {
      result.push('\n');
    }
  }
}

async function openArchive(bytes) {
  const archive = await openZip(bytes, { lazyEntries: true, autoClose: false });
  if (archive.entryCount > MAX_ARCHIVE_ENTRIES) {
    throw new ReferenceImportError('文件中包含的条目太多。请导出为更小的资料文件。');
  }

  const entries = new Map();
  await new Promise((resolve, reject) => {
    archive.on('error', reject);
    archive.once('end', resolve);
    archive.on('entry', entry => {
      entries.set(entry.fileName, entry);
      archive.readEntry();
    });
    archive.readEntry();
  });

  const openEntry = promisify(archive.openReadStream.bind(archive));
  let remaining = MAX_ARCHIVE_TEXT_BYTES;
  return {
    paths: () => [...entries.keys()],
    async read(name) {
      const entry = entries.get(name);
      if (!entry) return '';
      if (entry.uncompressedSize > remaining) {
        throw new ReferenceImportError('文件展开后的文字内容太大。请分成多份导入。');
      }
      remaining -= entry.uncompressedSize;
      const stream = await openEntry(entry);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      return decodeText(Buffer.concat(chunks));
    },
  };
}

function resolveArchivePath(base, href) {
  const ref = href?.split(/[?#]/, 1)[0];
  if (!ref || /^(?:[a-z][a-z\d+.-]*:|\/)/i.test(ref)) return '';
  try {
    const candidate = path.join(base, decodeURIComponent(ref));
    return candidate === '..' || candidate.startsWith('../') ? '' : candidate;
  } catch {
    return '';
  }
}

async function epubText(archive, keepHeadings = false) {
  const container = load(await archive.read('META-INF/container.xml'), { xml: true });
  const containerRoot = xmlElements(container, 'rootfile')[0]?.attribs['full-path'];
  const opf = resolveArchivePath('.', containerRoot) || archive.paths().find(part => /\.opf$/i.test(part));
  let sections = [];

  if (opf) {
    const book = load(await archive.read(opf), { xml: true });
    const base = path.dirname(opf);
    const manifest = new Map(xmlElements(book, 'item').map(node => [node.attribs.id, node.attribs.href]));
    sections = xmlElements(book, 'itemref')
      .map(node => resolveArchivePath(base, manifest.get(node.attribs.idref)))
      .filter(Boolean);
  }

  if (sections.length === 0) {
    sections = archive.paths().filter(part => /\.x?html?$/i.test(part));
  }

  const chapters = [];
  let length = 0;
  for (const section of new Set(sections)) {
    const content = htmlText(await archive.read(section), keepHeadings).trim();
    if (!content) continue;
    length += content.length + 2;
    if (length > MAX_REFERENCE_CHARACTERS) throw textLimitError();
    chapters.push(content);
  }
  return chapters.join('\n\n');
}

function textLimitError() {
  return new ReferenceImportError('提取后的文字超过 200 万字符。请分成多份导入。');
}

async function pdfText(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = getDocument({
    data: new Uint8Array(bytes),
    cMapUrl: fileURLToPath(new URL('cmaps/', pdfPackage)).replaceAll('\\', '/'),
    cMapPacked: true,
    standardFontDataUrl: fileURLToPath(new URL('standard_fonts/', pdfPackage)).replaceAll('\\', '/'),
    useWasm: false,
  });
  try {
    const document = await pdf.promise;
    const pages = [];
    let length = 0;
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const text = content.items.map(item => (item.str ?? '') + (item.hasEOL ? '\n' : '')).join('').trim();
      if (text) {
        length += text.length + 2;
        if (length > MAX_REFERENCE_CHARACTERS) throw textLimitError();
        pages.push(text);
      }
      page.cleanup();
    }
    return pages.join('\n\n');
  } catch (error) {
    if (error.name === 'PasswordException') {
      throw new ReferenceImportError('PDF 需要密码。请解锁后重新导入。');
    }
    throw error;
  } finally {
    await pdf.destroy();
  }
}

async function getReferenceText(format, bytes, keepHeadings) {
  switch (format) {
    case 'html':
    case 'htm':
    case 'xhtml':
      return htmlText(decodeText(bytes), keepHeadings);
    case 'xml': {
      const $ = load(decodeText(bytes), { xml: true });
      const result = [];
      appendGenericXmlText($.root().contents().toArray(), result);
      return normalizeMarkupText(result.join(''));
    }
    case 'docx': {
      const archive = await openArchive(bytes);
      return officeText(await archive.read('word/document.xml'), format, keepHeadings,
        keepHeadings ? await archive.read('word/styles.xml') : '');
    }
    case 'odt': {
      const archive = await openArchive(bytes);
      return officeText(await archive.read('content.xml'), format, keepHeadings);
    }
    case 'epub':
      return epubText(await openArchive(bytes), keepHeadings);
    case 'pdf':
      return pdfText(bytes);
    default:
      return decodeText(bytes);
  }
}

export async function extractReference(name, bytes, { keepHeadings = false } = {}) {
  const fileName = typeof name === 'string' ? path.basename(name.replaceAll('\\', '/')).trim() : '';
  const format = path.extname(fileName).slice(1).toLowerCase();
  if (!REFERENCE_EXTENSIONS.includes(format)) {
    throw new ReferenceImportError('此格式暂时无法读取。可以另存为 TXT、Markdown、DOCX 或文字版 PDF。');
  }
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    throw new ReferenceImportError('文件为空。');
  }
  if (bytes.length > MAX_REFERENCE_BYTES) {
    throw new ReferenceImportError('单个资料文件不能超过 25 MB。');
  }

  let text;
  try {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    text = normalizeText(await getReferenceText(format, buffer, keepHeadings));
  } catch (error) {
    if (error instanceof ReferenceImportError) throw error;
    throw new ReferenceImportError(`无法读取 ${format.toUpperCase()} 文件。请检查文件后重试。`, { cause: error });
  }

  if (text.length > MAX_REFERENCE_CHARACTERS) throw textLimitError();
  if (!text) {
    const message = format === 'pdf'
      ? 'PDF 没有可提取的文字层。请先识别扫描件中的文字，再导入文字版。'
      : '未找到可导入的文字内容。';
    throw new ReferenceImportError(message);
  }
  return { name: fileName, format, text };
}
