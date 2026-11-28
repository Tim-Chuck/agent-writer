import { esc, icon } from './icons.js';

export const maxChatAttachments = 5;

const nav = [
  ['write','pencil','写作台'], ['outline','outline','故事大纲'], ['cards','layers','设定卡片'],
  ['references','book','参考资料'], ['memories','brain','记忆'],
];

const sources = [
  ['chapters','file','前文'], ['cards','layers','设定'], ['planning','pencil','规划'],
  ['scenes','outline','大纲'], ['memories','brain','记忆'], ['references','book','参考资料'],
];

export const chapterNumber = n => String(n + 1).padStart(2, '0');
export const countWords = text => (text || '').replace(/\s/g, '').length;
const trimmedName = value => esc(value?.trim() || '未命名章节');

export function contextItems(project, chapterId) {
  const chapterIndex = project.chapters.findIndex(item => item.id === chapterId);
  return {
    chapters: project.chapters.slice(0, Math.max(0, chapterIndex)).map(item => ({ id: item.id, title: item.title })),
    cards: project.cards,
    planning: project.planning.trim() ? [{ id: 'planning', title: '作品规划' }] : [],
    scenes: project.scenes,
    memories: project.memories,
    references: project.references.map(item => ({ id: item.id, title: item.name })),
  };
}

export function sidebar({ state, project, chapter, view, mobileNav }) {
  const projectMenu = project ? `
    <button type="button" class="btn primary new-project" data-act="project-add">${icon('plus',17)}新建项目</button>
    <div class="project-row">
      <details class="project-picker">
        <summary class="project-selector" aria-label="切换项目，当前项目：${esc(project.title)}" title="${esc(project.title)}">
          ${icon('book')}<span>${esc(project.title)}</span>${icon('chevron',15)}
        </summary>
        <div class="project-options" role="group" aria-label="项目列表">
          ${state.projects.map(item => `<button type="button" class="project-option" data-act="project-switch" data-id="${esc(item.id)}" title="${esc(item.title)}"${item.id === project.id ? ' aria-current="true"' : ''}><span>${esc(item.title)}</span>${item.id === project.id ? icon('check', 16) : ''}</button>`).join('')}
        </div>
      </details>
      <button type="button" class="icon-btn project-rename" data-act="project-rename" data-id="${esc(project.id)}" aria-label="重命名项目" title="重命名当前项目">${icon('pencil',17)}</button>
      <button type="button" class="icon-btn project-delete" data-act="project-delete" data-id="${esc(project.id)}" aria-label="删除项目" title="删除当前项目">${icon('trash',17)}</button>
    </div>
    <nav class="navigation">${nav.map(([key, pict, title]) => `<button type="button" class="nav-item ${view === key ? 'is-active' : ''}" data-act="navigate" data-id="${key}" ${view === key ? 'aria-current="page"' : ''}>${icon(pict,18)}<span>${title}</span></button>`).join('')}</nav>
    <section class="chapter-nav" aria-label="章节">
      <div class="chapter-label"><span>章节</span><div class="chapter-actions"><button type="button" class="btn chapter-import" data-act="article-import">${icon('upload',14)}导入文章</button><button type="button" class="icon-btn chapter-export" data-act="chapter-export" aria-label="导出 TXT" title="导出 TXT">${icon('download',16)}</button><button type="button" class="icon-btn" data-act="chapter-add" aria-label="新建章节" title="新建章节">${icon('plus',17)}</button></div></div>
      <div class="chapter-list">${project.chapters.map((item, i) => {
        const active = view === 'write' && chapter.id === item.id;
        const label = trimmedName(item.title);
        return `<div class="chapter-row${active ? ' is-active' : ''}">
          <button type="button" class="chapter-link${active ? ' is-active' : ''}" data-act="chapter" data-id="${esc(item.id)}" title="${label}"${active ? ' aria-current="true"' : ''}><span class="chapter-number">${chapterNumber(i)}</span><span>${label}</span></button>
          <button type="button" class="icon-btn chapter-delete" data-act="chapter-delete" data-id="${esc(item.id)}" aria-label="删除章节「${label}」" title="删除章节">${icon('trash',15)}</button>
        </div>`;
      }).join('')}</div>
    </section>` : `
    <nav class="navigation" aria-label="工作区">
      <button type="button" class="nav-item ${view === 'write' ? 'is-active' : ''}" data-act="navigate" data-id="write" ${view === 'write' ? 'aria-current="page"' : ''}>${icon('book',18)}<span>工作区</span></button>
    </nav>`;
  return `<aside class="sidebar ${mobileNav ? 'is-open' : ''}" aria-label="项目侧边栏">
    <header class="brand"><span class="brand-mark">${icon('nib', 23)}</span><strong>Agent Writer</strong>
      <button class="icon-btn sidebar-close" type="button" data-act="mobile-nav" aria-label="关闭导航">${icon('x')}</button>
    </header>
    ${projectMenu}
    <footer class="sidebar-footer">
      <button type="button" class="nav-item ${view === 'providers' ? 'is-active' : ''}" data-act="navigate" data-id="providers" ${view === 'providers' ? 'aria-current="page"' : ''}>${icon('gear') }<span>API 设置</span>${state.activeProviderId ? '<i class="connected-dot" title="已配置模型"></i>' : ''}</button>
    </footer>
  </aside>`;
}

export function emptyWorkspace(settings) {
  const canOpenAssistant = Boolean(settings.state.activeProviderId || settings.entries.length || settings.historyError);
  return `<div class="${settings.mobileAssistant ? 'write-layout' : 'empty-workspace-layout'}">
    <section class="empty-workspace" aria-labelledby="empty-workspace-title">
    <span class="empty-workspace-icon">${icon('book', 27)}</span>
    <h1 id="empty-workspace-title">还没有项目</h1>
    <div class="empty-workspace-actions">
      <button type="button" class="btn primary" data-act="project-add">${icon('plus', 17)}新建项目</button>
      <button type="button" class="btn secondary" data-act="article-import">${icon('upload', 17)}导入文章</button>
      ${canOpenAssistant && !settings.mobileAssistant ? `<button type="button" class="btn secondary" data-act="mobile-assistant">${icon('sparkles', 17)}创作助手</button>` : ''}
    </div>
  </section>${settings.mobileAssistant ? assistantPanel({ ...settings, tab: 'conversation' }) : ''}</div>`;
}

function sourcePanel({ project, chapter, selection, expanded, busy, sourcesInfo, depth }) {
  const items = contextItems(project, chapter.id);
  return `<div class="source-heading"><h3>重点读取</h3><button class="icon-btn" type="button" data-act="sources-info" aria-expanded="${sourcesInfo}" aria-label="说明">${icon('info',15)}</button></div>
      ${sourcesInfo ? '<p class="source-note">逐项选中的资料优先读全文。整类前文太长时，先读近几章，再按本轮要求查找旧要点和原文。</p>' : ''}
      <label class="source-depth"><input type="checkbox" id="reading-deep"${depth === 'deep' ? ' checked' : ''}${busy ? ' disabled' : ''}><span>深读写作<small>允许读入更多原文，单次请求最多等待 8 分钟。</small></span></label>
      <div class="source-list">${sources.map(([key, pict, title]) => {
        const options = items[key];
        const current = selection[key];
        const selected = options.filter(item => current === true || current?.includes?.(item.id));
        const isExpanded = expanded.has(key);
        return `<section class="source-row">
          <div class="source-overview">
            <label class="source-check" title="重点读取全部${title}"><input type="checkbox" data-source="${key}" data-mixed="${Boolean(selected.length && selected.length < options.length)}" ${selected.length && selected.length === options.length ? 'checked' : ''} ${busy || !options.length ? 'disabled' : ''} aria-label="重点读取全部${title}"></label>
            <button class="source-expand" type="button" data-act="source-expand" data-id="${key}" aria-expanded="${isExpanded}">${icon(pict,16)}<span>${title}</span><small>${options.length ? `${selected.length}/${options.length}` : '0'}</small>${icon('chevron',14)}</button>
          </div>
          ${isExpanded ? `<div class="source-children">${options.length ? options.map(item => `<label><input type="checkbox" data-source="${key}" data-source-id="${esc(item.id)}" ${selected.some(it => it.id === item.id) ? 'checked' : ''} ${busy ? 'disabled' : ''}><span>${esc(item.title || '未命名')}</span></label>`).join('') : '<span class="muted">还没有可选内容</span>'}</div>` : ''}
        </section>`;
      }).join('')}</div>
      <p class="source-foot">${icon('info',14)}<span>助手会按本轮要求查找相关前文和参考资料。</span></p>`;
}

function readingReport(report) {
  if (!report?.sections) return '';
  const coverage = { full: '全文', excerpt: '节选', duplicate: '同文复用' };
  const details = report.sections.map(section => `<li>${esc(section.label)} · ${section.full === undefined ? `重点 ${esc(section.focused)}` : `全文 ${esc(section.full)} / 节选 ${esc(section.excerpts)}`} / 略读 ${esc(section.skimmed)}</li>`).join('');
  const sources = (report.focused || []).filter(entry => entry.kind === 'chapters').map(entry =>
    `<li>${esc(entry.title)} · ${esc(coverage[entry.coverage])}</li>`).join('');
  const recalled = (report.recalled || []).map(item => `<li>${esc(item.title)} · ${item.kind === 'point' ? '剧情要点' : '原文片段'}</li>`).join('');
  const attachments = (report.attachments || []).map(file => `<li>附件 ${esc(file.name)} · ${file.included === file.characters ? '已载入全文' : '已载入开头，可分页读取原文'}</li>`).join('');
  return `<details class="read-report"><summary>${icon('chevron', 14)}本次阅读范围</summary>
    ${report.depth ? `<p>${report.depth === 'deep' ? '深读写作' : '标准阅读'} · 初始上下文约 ${esc(report.characters)} 字符</p>` : ''}
    <ul>${details}${sources}${recalled}${attachments}</ul></details>`;
}

function attachmentList(files, removable = false, locked = false) {
  if (!files?.length) return '';
  return `<ul class="chat-files" aria-label="对话附件">${files.map(file => `<li title="${esc(file.name)}">${icon('file', 14)}<span>${esc(file.name)}</span>${removable ? `<button type="button" class="icon-btn" data-act="attachment-remove" data-id="${esc(file.id)}" aria-label="移除附件 ${esc(file.name)}"${locked ? ' disabled' : ''}>${icon('x', 13)}</button>` : ''}</li>`).join('')}</ul>`;
}

export function composerAttachments(files, loading, locked) {
  return attachmentList(files, true, locked) + (loading ? '<p class="composer-status" role="status">正在读取附件…</p>' : '');
}

function conversation(entries, busy, hasModel, hasProject = true) {
  if (!entries.length && !busy) {
    return `<div class="assistant-empty"><span>${icon('sparkles',22)}</span><h3>从这章开始</h3>
      <p>${hasModel ? (hasProject ? '可以续写、检查逻辑，也可以让助手操作项目。' : '可以让助手新建项目或导入文章。') : '连接一个模型，就可以开始写作。'}</p>
      ${hasModel && hasProject ? '<button type="button" class="btn secondary" data-act="sample-prompt">检查本章逻辑</button>' : !hasModel ? '<button type="button" class="btn secondary" data-act="navigate" data-id="providers">连接模型</button>' : ''}</div>`;
  }
  return `<div class="conversation">${entries.map(entry => {
    if (entry.role === 'user') return `<article class="message user-message">${attachmentList(entry.attachments)}${entry.text ? `<p>${esc(entry.text)}</p>` : ''}</article>`;
    if (entry.role === 'tool_request') {
      const request = entry.pending;
      const action = { file: '选择文件', key: '提交密钥', copy: '复制文字', link: '打开网页', export: '保存 TXT' }[request.kind] || '确认执行';
      return `<article class="message assistant-message tool-request" aria-label="工具请求"${request.kind === 'file' ? ' data-drop="agent-file"' : ''}><header>${icon('warning',15)}<span>工具请求</span></header>
        <p>${esc(request.summary)}</p>
        ${request.kind === 'file' ? '<small class="tool-drop-hint">也可将文件拖入这里</small>' : ''}
        ${request.kind === 'key' ? '<label class="field"><span>API Key</span><input type="password" maxlength="4096" class="tool-key" autocomplete="off"></label>' : ''}
        ${request.kind === 'copy' ? `<pre>${esc(request.text)}</pre>` : ''}
        <div class="message-actions"><button type="button" class="btn primary${request.danger ? ' danger' : ''}" data-act="agent-decision" data-id="${esc(request.id)}">${action}</button>
          <button type="button" class="btn secondary" data-act="agent-decision" data-id="${esc(request.id)}" data-decline>取消</button></div>
      </article>`;
    }
    const trace = entry.trace?.length ? `<details class="read-report tool-report"><summary>${icon('chevron', 14)}工具记录 · ${entry.trace.length}</summary>
      <ul>${entry.trace.map(item => `<li${item.ok ? '' : ' class="is-error"'}>${esc(item.message)}</li>`).join('')}</ul></details>` : '';
    if (entry.role === 'error') return `<article class="message error-message"><p>${esc(entry.text)}</p>${trace}</article>`;
    const report = entry.report;
    return `<article class="message assistant-message"><header>${icon('sparkles',15)}<span>创作助手</span></header>
       <p>${esc(entry.text)}</p>
       ${trace}
       ${readingReport(report)}
       <div class="message-actions">${entry.allowApply !== false ? `<button type="button" class="btn secondary" data-act="response-apply" data-id="${esc(entry.id)}">${icon('plus',15)}加入章节</button>` : ''}<button type="button" class="icon-btn" data-act="response-copy" data-id="${esc(entry.id)}" aria-label="复制" title="复制">${icon('clipboard',16)}</button></div>
    </article>`;
  }).join('')}${busy ? '<div class="assistant-working" role="status"><i></i>正在准备上下文并生成…</div>' : ''}</div>`;
}

export function writer(settings) {
  const { project, chapter, locked, saved } = settings;
  const index = project.chapters.findIndex(item => item.id === chapter.id);
  const count = countWords(chapter.text);
  return `<div class="write-layout">
    <section class="manuscript" aria-label="章节编辑器">
      <header class="desk-toolbar">
        <div class="breadcrumb"><button type="button" class="icon-btn mobile-menu" data-act="mobile-nav" aria-label="打开导航">${icon('menu')}</button><span class="desk-label">写作台</span><span class="crumb-slash">/</span><span>第 ${chapterNumber(index)} 章</span></div>
        <div class="toolbar-actions"><span id="save-state" class="save-state">${esc(saved)}</span><button type="button" class="btn secondary assistant-toggle" data-act="mobile-assistant">${icon('sparkles',16)}<span>助手</span></button><button type="button" class="btn primary save-button" data-act="save">${icon('save',16)}保存</button></div>
      </header>
      <div class="manuscript-scroll">
        <div class="paper">
          <div class="paper-caption"><i></i><span>第 ${chapterNumber(index)} 章</span><i></i></div>
          <input id="chapter-title" class="manuscript-title" value="${esc(chapter.title)}" aria-label="章节标题" maxlength="140" placeholder="未命名章节" autocomplete="off"${locked ? ' readonly' : ''}>
          <textarea id="chapter-text" class="manuscript-body" rows="14" spellcheck="false" placeholder="从第一段开始…" aria-label="章节正文"${locked ? ' readonly' : ''}>${esc(chapter.text)}</textarea>
        </div>
      </div>
      <footer class="desk-footer"><span>${icon('file',14)}正文</span><span><b id="chapter-count">${count.toLocaleString('zh-CN')}</b> 字</span></footer>
    </section>
    ${assistantPanel(settings)}
  </div>`;
}

function assistantPanel(settings) {
  const { project, state, tab, entries, prompt, mode, busy, locked, mobileAssistant, attachments, attachmentLoading,
    historyLoading, historyError } = settings;
  const full = attachments.length >= maxChatAttachments;
  const models = Object.values(state.providers);
  let panel;
  if (tab === 'sources') panel = sourcePanel(settings);
  else if (historyLoading) panel = '<div class="assistant-working" role="status"><i></i>正在读取对话记录…</div>';
  else if (historyError && !entries.length) panel = `<div class="message error-message"><p>无法读取对话记录。${esc(historyError)}</p><div class="message-actions"><button type="button" class="btn secondary" data-act="history-retry">重试</button></div></div>`;
  else panel = conversation(entries, busy, Boolean(models.length), Boolean(project));
  return `<aside class="assistant-panel ${mobileAssistant ? 'is-open' : ''}" aria-label="创作助手">
      <header class="assistant-title"><span>${icon('sparkles',21)}</span><h2>创作助手</h2><button type="button" class="icon-btn assistant-toggle" data-act="mobile-assistant" aria-label="关闭助手">${icon('x')}</button></header>
      <div class="model-pick"><span>使用模型</span>${models.length ? `<select id="model-select" aria-label="使用模型">${models.map(model => `<option value="${esc(model.id)}" ${model.id === state.activeProviderId ? 'selected' : ''}>${esc(model.model)}</option>`).join('')}</select>` : '<button type="button" class="btn secondary" data-act="navigate" data-id="providers">连接模型</button>'}</div>
      ${project ? `<div class="segments desk-tabs" aria-label="助手面板">
        <button type="button" data-act="assistant-tab" data-id="sources" class="${tab === 'sources' ? 'is-active' : ''}" aria-pressed="${tab === 'sources'}">阅读范围</button>
        <button type="button" data-act="assistant-tab" data-id="conversation" class="${tab === 'conversation' ? 'is-active' : ''}" aria-pressed="${tab === 'conversation'}">对话</button>
      </div>` : '<div></div>'}
      <div class="assistant-scroll" id="assistant-scroll">${panel}</div>
      <form id="assistant-form" class="assistant-form" data-drop="chat"${locked || attachmentLoading || full ? ' data-drop-disabled' : ''}>
        <div id="composer-attachments" aria-live="polite">${composerAttachments(attachments, attachmentLoading, locked)}</div>
        <label class="sr-only" for="assistant-prompt">写作要求</label>
        <textarea id="assistant-prompt" name="prompt" placeholder="${project ? '你想怎么写？' : '例如，新建一个小说项目'}" maxlength="16000" rows="3" ${locked ? 'disabled' : ''}>${esc(prompt)}</textarea>
        <div class="composer-toolbar">
          <select name="mode" id="assistant-mode" aria-label="助手模式" ${locked ? 'disabled' : ''}>${[['write','写正文'],['plan','理情节'],['review','查逻辑']].map(([key, name]) => `<option value="${key}" ${mode === key ? 'selected' : ''}>${name}</option>`).join('')}</select>
          <div class="composer-actions">
            <button type="button" class="btn attachment-button" data-act="attachment-add" title="${full ? '每条消息最多 5 个附件' : '添加附件，也可拖入文本文件（单个最多 25 MB）'}" aria-label="添加附件"${locked || attachmentLoading || full ? ' disabled' : ''}>${icon('paperclip', 16)}附件</button>
            <button type="submit" class="icon-btn send-button" aria-label="发送给创作助手" title="发送" ${locked || attachmentLoading ? 'disabled' : ''}>${icon('send',18)}</button>
          </div>
        </div>
      </form>
    </aside>`;
}
