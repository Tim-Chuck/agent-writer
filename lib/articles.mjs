import { posix as path } from 'node:path';
import { DOCUMENT_HEADING, extractReference } from './imports.mjs';

export const ARTICLE_EXTENSIONS = Object.freeze(['txt', 'text', 'md', 'markdown', 'docx', 'odt', 'pdf', 'epub', 'html', 'htm', 'xhtml']);
export const MAX_ARTICLE_CHAPTERS = 2_000;
export const MAX_CHAPTER_CHARACTERS = 1_500_000;

const chapterPattern = /^(第\s*[0-9０-９〇零一二三四五六七八九十百千万兩两壹贰貳叁參肆伍陆陸柒捌玖拾佰仟]+\s*([章节節回话話卷篇部]))(.*)$/u;
const englishPattern = /^(chapter|chap\.?|ch\.|volume|vol\.)\s+([0-9]+|[ivxlcdm]+)(?=$|[\s:：.．–—-])/i;
const specialPattern = /^(序章|序言|前言|楔子|引子|引言|序幕|终章|終章|终曲|尾声|尾聲|后记|後記|跋|番外(?:\s*[一二三四五六七八九十0-9]+)?)(?=$|[\s:：·.．、–—-])/u;
const contentsPattern = /^(?:目\s*[录錄次]|(?:table of )?contents)[:：]?$/i;
const contentsPage = /[.．·…]{2,}\s*\d+\s*$/u;
const attachedSentence = /^(?:的|里|中(?:的|，)|讲述|介绍|提到|写到)|[。！？!?；;]/u;

function identifyHeading(title) {
  const cn = chapterPattern.exec(title);
  if (cn && (!cn[3] || /^[\s:：·.．、–—-]/u.test(cn[3]) || !attachedSentence.test(cn[3]))) {
    const kind = '卷篇部'.includes(cn[2]) ? 'part' : '节節'.includes(cn[2]) ? 'section' : 'chapter';
    return { kind, key: cn[1].normalize('NFKC').replace(/\s/g, '') };
  }
  const en = englishPattern.exec(title);
  if (en && !/^\s+(?:is|was|includes?|introduces?|describes?|discusses?|tells?)\b/i.test(title.slice(en[0].length))) {
    return { kind: /^vol/i.test(en[1]) ? 'part' : 'chapter', key: en[0].toLowerCase() };
  }
  if (specialPattern.test(title)) return { kind: 'special', key: title };
  return null;
}

function bodyText(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start++;
  while (end > start && !lines[end - 1].trim()) end--;
  return lines.slice(start, end).join('\n');
}

function titleLine(line, markdown) {
  const value = line.trim();
  if (!markdown) return { title: value, level: 0 };
  const heading = /^(#{1,6})[ \t]+(.+)$/u.exec(value);
  return heading ? { title: heading[2].replace(/[ \t]+#+$/u, '').trimEnd(), level: heading[1].length } : { title: value, level: 0 };
}

function readHeadings(text, markdown) {
  const original = text.replace(/\r\n?/g, '\n').split('\n');
  const lines = [];
  const headings = [];
  let fence = '';
  for (const [index, raw] of original.entries()) {
    const structured = raw.startsWith(DOCUMENT_HEADING) && /^[1-6]$/.test(raw[1]);
    const line = structured ? raw.slice(2) : raw;
    lines.push(line);
    const marker = markdown ? /^[ \t]*(`{3,}|~{3,})/u.exec(line)?.[1] : null;
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = '';
      continue;
    }
    if (fence) continue;
    const parsed = titleLine(line, markdown);
    const nextLine = original[index + 1] ?? '';
    const setext = markdown && !structured && !parsed.level && parsed.title &&
      !/^[-#>*]/u.test(parsed.title) && /^\s*(?:={2,}|-{2,})\s*$/u.test(nextLine);
    const level = structured ? Number(raw[1]) : parsed.level || (setext ? nextLine.trimStart()[0] === '=' ? 1 : 2 : 0);
    const title = parsed.title;
    if (!title || title.length > 140 || contentsPage.test(title)) continue;
    const type = contentsPattern.test(title) ? { kind: 'contents', key: title } : identifyHeading(title);
    if (type || level) headings.push({ title, level, line: index, end: index + (setext ? 2 : 1), ...type });
  }
  return { lines, headings };
}

function separateContents(lines, headings) {
  const start = headings.findIndex(heading => heading.kind === 'contents' && heading.line < 150);
  if (start < 0) return { headings };
  const known = new Set();
  let previous = headings[start];
  for (let index = start + 1; index < headings.length; index++) {
    const next = headings[index];
    if (!next.key || lines.slice(previous.end, next.line).some(line => line.trim())) break;
    if (known.has(next.key)) {
      return { headings: [...headings.slice(0, start), ...headings.slice(index)], ignored: [headings[start].line, next.line] };
    }
    known.add(next.key);
    previous = next;
  }
  return { headings };
}

function chooseHeadings(headings, lines) {
  const numbered = ['chapter', 'section'].find(kind => headings.some(heading => heading.kind === kind));
  if (numbered) return headings.filter(heading => heading.kind === numbered || heading.kind === 'special');
  const marked = headings.filter(heading => !heading.kind && heading.level);
  if (!marked.length) return headings.filter(heading => heading.kind === 'part' || heading.kind === 'special');
  const levels = [...new Set(marked.map(heading => heading.level))].sort((a, b) => a - b);
  const top = marked.filter(heading => heading.level === levels[0]);
  const loneTitle = levels.length > 1 && top.length === 1 && top[0] === marked[0] &&
    !bodyText(lines.slice(0, top[0].line));
  if (loneTitle) top[0].documentTitle = true;
  const level = loneTitle ? levels[1] : levels[0];
  return headings.filter(heading => heading.kind === 'special' || (!heading.kind && heading.level === level));
}

export function splitArticle(text, title, format = 'txt') {
  const markdown = ['txt', 'text', 'md', 'markdown'].includes(format);
  const { lines, headings } = readHeadings(text, markdown);
  const contents = separateContents(lines, headings);
  const selected = chooseHeadings(contents.headings, lines);
  const original = bodyText(lines);
  if (!selected.length) return { text: original, chapters: [{ title, text: original }], recognized: 0 };

  const section = (start, end) => bodyText(lines.slice(start, end).filter((_, index) =>
    !contents.ignored || start + index < contents.ignored[0] || start + index >= contents.ignored[1]));
  const chapters = selected.map((heading, index) => ({
    title: heading.title,
    text: section(heading.end, selected[index + 1]?.line ?? lines.length),
  }));
  const preamble = section(0, selected[0].line);
  if (preamble) {
    const topTitle = contents.headings.find(heading => heading.line < selected[0].line &&
      (heading.documentTitle || heading.kind === 'part' || (!heading.kind && heading.level)) &&
      preamble === section(heading.line, heading.end));
    if (topTitle) {
      chapters[0].text = [topTitle.title, chapters[0].text].filter(Boolean).join('\n\n');
    } else {
      chapters.unshift({ title: '前置内容', text: preamble });
    }
  }
  return { text: original, chapters, recognized: selected.length };
}

export async function extractArticle(name, bytes) {
  const file = path.basename(String(name ?? '').replaceAll('\\', '/')).trim();
  const format = path.extname(file).slice(1).toLowerCase();
  if (!ARTICLE_EXTENSIONS.includes(format)) {
    throw new Error('此格式暂时无法导入正文。可以使用 TXT、Markdown、Word、ODT、EPUB、HTML 或文字版 PDF。');
  }
  const { text } = await extractReference(file, bytes, { keepHeadings: true });
  const title = path.basename(file, path.extname(file)).trim().slice(0, 120) || '导入文章';
  const result = splitArticle(text, title, format);
  if (result.chapters.length > MAX_ARTICLE_CHAPTERS) throw new Error('识别出的章节超过 2000 章。请将文件分成多份再导入。');
  return { title, format, ...result };
}
