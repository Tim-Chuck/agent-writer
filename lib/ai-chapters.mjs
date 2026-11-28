import { splitArticle } from './articles.mjs';

const numberText = '[0-9０-９零〇一二三四五六七八九十百两兩]+';
const ordinal = `第\\s*(${numberText})\\s*章(?:节)?`;
const verb = /写|创作|撰写|生成|起草|write|draft|compose|generate/i;
const prose = /正文|小说|故事|文章|prose|story|novel/i;
const draftOnly = /(?:只|仅)(?:要|需)?(?:在|发在|显示在)(?:聊天|对话)|(?:别|不(?:要|用|必|需))\s*(?:自动)?(?:保存|写入|存入|新增章节|创建章节|分章)|(?:chat only|do not (?:save|insert|create chapters))/i;
const nonProse = /(?:列|做|写|生成|提供|设计|整理|梳理)[^，。；,.;!！?？\n]{0,13}(?:大纲|提纲|目录|章名|标题列表|摘要|梗概|章纲|情节规划)|\b(?:outline|summarize|review|list chapter titles)\b/i;
const englishNumbers = ['zero','one','two','three','four','five','six','seven','eight','nine','ten'];

function chapterCount(raw) {
  const value = raw.normalize('NFKC').toLowerCase();
  if (/^\d+$/.test(value)) return Number(value);
  if (englishNumbers.includes(value)) return englishNumbers.indexOf(value);
  const digits = '零一二三四五六七八九';
  let sum = 0;
  let current = 0;
  for (const char of value) {
    if (char === '百' || char === '十') {
      sum += (current || 1) * (char === '百' ? 100 : 10);
      current = 0;
    } else if (char === '两' || char === '兩') current = 2;
    else if (char === '〇') current = 0;
    else current = digits.indexOf(char);
  }
  return sum + current;
}

export function chapterGenerationIntent(prompt, mode = 'write') {
  const text = prompt.trim();
  if (draftOnly.test(text)) return { enabled: false, draftOnly: true };
  if (!verb.test(text) || (mode !== 'write' && !prose.test(text)) ||
      (nonProse.test(text) && !/(?:写|创作|生成|开始写)(?:.{0,15})(?:正文|全文)|\b(?:write|draft)\b.{0,25}\bprose\b/i.test(text))) {
    return { enabled: false };
  }
  const range = new RegExp(`第\\s*(${numberText})\\s*章?(?:节)?\\s*(?:到|至|—|–|-|~|～)\\s*第?\\s*(${numberText})\\s*章(?:节)?`, 'u').exec(text) ||
    /\bchapters?\s+(\d+)\s*(?:to|through|[-–—])\s*(?:chapter\s+)?(\d+)\b/i.exec(text);
  if (range) {
    const count = chapterCount(range[2]) - chapterCount(range[1]) + 1;
    return { enabled: count > 1, count };
  }
  const specific = [...text.matchAll(new RegExp(ordinal, 'gu'))].map(match => chapterCount(match[1]));
  if (new Set(specific).size >= 2) return { enabled: true, count: new Set(specific).size };
  if (/序章.{0,6}(?:和|与|及|、).{0,6}第一章|第一章.{0,6}(?:和|与|及|、).{0,6}序章/u.test(text)) return { enabled: true, count: 2 };
  const amounts = [...text.matchAll(new RegExp(`(?<!第)\\s*(${numberText})\\s*(?:个)?章(?:节)?`, 'gu'))];
  for (const match of amounts) {
    const prefix = text.slice(0, match.index).split(/[，。；,.;!！?？\n]/).at(-1);
    const clause = text.slice(match.index + match[0].length).split(/[，。；,.;!！?？\n]/)[0];
    if (new RegExp(`第\\s*${numberText}?\\s*$`, 'u').test(prefix) || /第\s*$/u.test(prefix) ||
        /计划|总共|全书共有|预计|已经|已有|读过|基于|不要|别|不必|先别|只需列出/u.test(prefix) ||
        /^(?:的(?:大纲|标题|目录|内容简介)|摘要)/u.test(clause)) continue;
    const count = chapterCount(match[1]);
    if (count > 1 && (verb.test(prefix) || /分(?:为|成|作)?\s*$/.test(prefix))) return { enabled: true, count };
  }
  const english = /\b(?:write|draft|compose|generate)\b.{0,40}?\b(\d+|two|three|four|five|six|seven|eight|nine|ten)\s+(?:full\s+)?chapters\b/i.exec(text);
  if (english && chapterCount(english[1]) > 1) return { enabled: true, count: chapterCount(english[1]) };
  return { enabled: /多章(?:节)?|多个章(?:节)?|若干章(?:节)?|好几章|连写几章|分章节|分章(?:写|生成|的)|\b(?:several|multiple)\s+chapters\b/i.test(text) };
}

export function splitGeneratedChapters(text) {
  const content = text.trim().replace(/^```(?:markdown|md|txt|text)?[ \t]*\r?\n([\s\S]+)\r?\n```$/i, '$1')
    .replace(/^(\s*#{1,6}[ \t]+)?[ \t]*\*\*([^*\r\n]+)\*\*[ \t]*$/gm, (line, prefix, title) =>
      prefix || /^(?:第.+[章节節回话話]|序章|尾声|终章|chapter\b)/iu.test(title) ? (prefix ?? '') + title : line);
  const result = splitArticle(content, '生成文章', 'md');
  return result.recognized > 1 ? result.chapters.slice(-result.recognized) : [];
}
