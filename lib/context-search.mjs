const common = new Set('如果 还有 这个 那个 这些 一个 需要 请问 什么 怎么 可以 继续 续写 写作 内容 资料 前文 本章 章节 小说 故事 的了 之前 然后 他们 她们 我们 他说 她说 当时 给我 帮我 查询 一下 the and what how this was with that'.split(' '));
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
const normalize = value => value.normalize('NFKC').toLowerCase();

function queryWeights(query) {
  const weights = new Map();
  for (const [index, source] of (Array.isArray(query) ? query : [query]).entries()) {
    for (const { segment, isWordLike } of segmenter.segment(normalize(String(source ?? '').slice(0, 2600)))) {
      if (!isWordLike || segment.length < 2 || common.has(segment)) continue;
      const weight = index === 0 ? 3 : 1;
      weights.set(segment, Math.max(weights.get(segment) || 0, weight));
    }
    const quoted = String(source ?? '').matchAll(/[「“『"]([^」”』"\n]{2,36})[」”』"]/gu);
    for (const phrase of quoted) weights.set(normalize(phrase[1]), 8);
  }
  return [...weights].sort((left, right) => right[1] - left[1]).slice(0, 64);
}

function scoring(weights) {
  return text => {
    const input = normalize(text);
    let score = 0;
    for (const [word, weight] of weights) if (input.includes(word)) score += weight;
    return score;
  };
}

export const relevance = query => scoring(queryWeights(query));

function* passages(text) {
  for (let offset = 0; offset < text.length;) {
    const stop = Math.min(offset + 720, text.length);
    const paragraph = stop < text.length ? text.lastIndexOf('\n', stop - 1) : -1;
    const end = paragraph >= offset + 440 ? paragraph + 1 : stop;
    yield { offset, end, text: text.slice(offset, end) };
    if (end === text.length) break;
    offset = paragraph >= offset + 440 ? end : Math.max(offset + 1, end - 80);
  }
}

export function searchPassages(entries, query, limit = 6) {
  const terms = queryWeights(query);
  if (!terms.length) return [];
  const score = scoring(terms);
  const best = [];
  for (const { id, title, text = '', kind } of entries) {
    const chapterMatches = score(title || '');
    for (const passage of passages(text)) {
      const matches = score(passage.text);
      if (!matches && !(chapterMatches && passage.offset === 0)) continue;
      const rank = matches + Math.min(chapterMatches, 6);
      if (best.length >= limit && rank <= best.at(-1).score) continue;
      if (best.some(other => other.id === id && Math.abs(other.offset - passage.offset) < 240)) continue;
      best.push({ id, title, kind, ...passage, score: rank });
      best.sort((left, right) => right.score - left.score);
      if (best.length > limit) best.pop();
    }
  }
  return best;
}
