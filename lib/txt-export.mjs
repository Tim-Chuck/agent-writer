const numbered = /^(?:第\s*[0-9０-９〇零一二三四五六七八九十百千万两兩]+\s*[章节節回话話卷篇部]|(?:chapter|chap\.?|ch\.)\s+(?:[0-9]+|[ivxlcdm]+)\b)/i;

export function txtFilename(value) {
  let stem = String(value ?? '').replace(/\.txt$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
    .trim().slice(0, 140).replace(/[. ]+$/, '');
  if (!stem) stem = '稿件';
  if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(stem)) stem = '_' + stem;
  return stem + '.txt';
}

export function txtExport(project, chapterIds) {
  if (chapterIds !== undefined && (!Array.isArray(chapterIds) || !chapterIds.length ||
      chapterIds.some(id => typeof id !== 'string'))) {
    throw new Error('请至少选择一个章节。');
  }
  const selected = chapterIds === undefined ? null : new Set(chapterIds);
  const chapters = project.chapters.map((chapter, index) => ({ chapter, number: index + 1 }))
    .filter(({ chapter }) => !selected || selected.has(chapter.id));
  if (selected && chapters.length !== selected.size) throw new Error('有章节已被移除，请重新选择导出范围。');
  if (!chapters.length) throw new Error('当前项目没有可导出的章节。');
  const text = chapters.map(({ chapter, number }) => {
    const title = (chapter.title || '').replace(/\s+/g, ' ').trim();
    const heading = numbered.test(title) ? title : `第 ${number} 章${title ? ' ' + title : ''}`;
    const body = (chapter.text ?? '').replace(/\r\n?/g, '\n');
    return body ? heading + '\n\n' + body : heading;
  }).join('\n\n') + '\n';
  const suffix = !selected ? '' : chapters.length === 1 ? ' - ' + chapters[0].chapter.title : ' - 选定章节';
  return { filename: txtFilename(project.title + suffix), text: '\uFEFF' + text.replace(/\n/g, '\r\n'), chapterCount: chapters.length };
}
