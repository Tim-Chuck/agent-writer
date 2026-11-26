import { esc, icon } from './icons.js';

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
        <summary class="project-selector" aria-label="切换项目，当前项目：${esc(project.title)}" title="切换项目">
          ${icon('book')}<span>${esc(project.title)}</span>${icon('chevron',15)}
        </summary>
        <div class="project-options" role="group" aria-label="项目列表">
          ${state.projects.map(item => `<button type="button" class="project-option" data-act="project-switch" data-id="${esc(item.id)}" title="${esc(item.title)}"${item.id === project.id ? ' aria-current="true"' : ''}><span>${esc(item.title)}</span>${item.id === project.id ? icon('check', 16) : ''}</button>`).join('')}
        </div>
      </details>
      <button type="button" class="icon-btn project-delete" data-act="project-delete" data-id="${esc(project.id)}" aria-label="删除项目" title="删除当前项目">${icon('trash',17)}</button>
    </div>
    <nav class="navigation">${nav.map(([key, pict, title]) => `<button type="button" class="nav-item ${view === key ? 'is-active' : ''}" data-act="navigate" data-id="${key}" ${view === key ? 'aria-current="page"' : ''}>${icon(pict,18)}<span>${title}</span></button>`).join('')}</nav>
    <section class="chapter-nav" aria-label="章节">
      <div class="chapter-label"><span>章节</span><div class="chapter-actions"><button type="button" class="btn chapter-import" data-act="article-import">${icon('upload',14)}导入文章</button><button type="button" class="icon-btn" data-act="chapter-add" aria-label="新建章节" title="新建章节">${icon('plus',17)}</button></div></div>
      <div class="chapter-list">${project.chapters.map((item, i) => `<button type="button" class="chapter-link ${view === 'write' && chapter.id === item.id ? 'is-active' : ''}" data-act="chapter" data-id="${esc(item.id)}" title="${esc(item.title)}"><span class="chapter-number">${chapterNumber(i)}</span><span>${trimmedName(item.title)}</span></button>`).join('')}</div>
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

export function emptyWorkspace() {
  return `<section class="empty-workspace" aria-labelledby="empty-workspace-title">
    <span class="empty-workspace-icon">${icon('book', 27)}</span>
    <h1 id="empty-workspace-title">还没有项目</h1>
    <div class="empty-workspace-actions">
      <button type="button" class="btn primary" data-act="project-add">${icon('plus', 17)}新建项目</button>
      <button type="button" class="btn secondary" data-act="article-import">${icon('upload', 17)}导入文章</button>
    </div>
  </section>`;
}

function sourcePanel({ project, chapter, selection, expanded, busy, sourcesInfo }) {
  const items = contextItems(project, chapter.id);
  return `<div class="source-heading"><h3>重点读取</h3><button class="icon-btn" type="button" data-act="sources-info" aria-expanded="${sourcesInfo}" aria-label="说明">${icon('info',15)}</button></div>
      ${sourcesInfo ? '<p class="source-note">助手始终读取当前章节。勾选的内容会带上正文或关键摘录，其余内容只读概要。</p>' : ''}
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
      <p class="source-foot">${icon('info',14)}<span>当前章节自动读取，其余未勾选内容略读。</span></p>`;
}

function conversation(entries, busy, hasModel) {
  if (!entries.length && !busy) {
    return `<div class="assistant-empty"><span>${icon('sparkles',22)}</span><h3>从这章开始</h3>
      <p>${hasModel ? '可以续写、整理下一场戏，或检查前后逻辑。' : '连接一个模型，就可以开始写作。'}</p>
      ${hasModel ? '<button type="button" class="btn secondary" data-act="sample-prompt">检查本章逻辑</button>' : '<button type="button" class="btn secondary" data-act="navigate" data-id="providers">连接模型</button>'}</div>`;
  }
  return `<div class="conversation">${entries.map(entry => {
    if (entry.role === 'user') return `<article class="message user-message"><p>${esc(entry.text)}</p></article>`;
    if (entry.role === 'error') return `<article class="message error-message"><p>${esc(entry.text)}</p></article>`;
    const report = entry.report;
    return `<article class="message assistant-message"><header>${icon('sparkles',15)}<span>创作助手</span></header>
       <p>${esc(entry.text)}</p>
       ${report?.sections ? `<details class="read-report"><summary>${icon('chevron', 14)}本次阅读范围</summary><ul>${report.sections.map(section => `<li>${esc(section.label)} · 重点 ${esc(section.focused)} / 略读 ${esc(section.skimmed)}</li>`).join('')}</ul></details>` : ''}
       <div class="message-actions"><button type="button" class="btn secondary" data-act="response-apply" data-id="${esc(entry.id)}">${icon('plus',15)}加入章节</button><button type="button" class="icon-btn" data-act="response-copy" data-id="${esc(entry.id)}" aria-label="复制" title="复制">${icon('clipboard',16)}</button></div>
    </article>`;
  }).join('')}${busy ? '<div class="assistant-working" role="status"><i></i>正在准备上下文并生成…</div>' : ''}</div>`;
}

export function writer(settings) {
  const { project, chapter, state, tab, entries, prompt, mode, busy, saved, mobileAssistant } = settings;
  const index = project.chapters.findIndex(item => item.id === chapter.id);
  const count = countWords(chapter.text);
  const models = Object.values(state.providers);
  return `<div class="write-layout">
    <section class="manuscript" aria-label="章节编辑器">
      <header class="desk-toolbar">
        <div class="breadcrumb"><button type="button" class="icon-btn mobile-menu" data-act="mobile-nav" aria-label="打开导航">${icon('menu')}</button><span class="desk-label">写作台</span><span class="crumb-slash">/</span><span>第 ${chapterNumber(index)} 章</span></div>
        <div class="toolbar-actions"><span id="save-state" class="save-state">${esc(saved)}</span><button type="button" class="btn secondary assistant-toggle" data-act="mobile-assistant">${icon('sparkles',16)}<span>助手</span></button><button type="button" class="btn primary save-button" data-act="save">${icon('save',16)}保存</button></div>
      </header>
      <div class="manuscript-scroll">
        <div class="paper">
          <div class="paper-caption"><i></i><span>第 ${chapterNumber(index)} 章</span><i></i></div>
          <input id="chapter-title" class="manuscript-title" value="${esc(chapter.title)}" aria-label="章节标题" maxlength="140" placeholder="未命名章节" autocomplete="off">
          <textarea id="chapter-text" class="manuscript-body" rows="14" spellcheck="false" placeholder="从第一段开始…" aria-label="章节正文">${esc(chapter.text)}</textarea>
        </div>
      </div>
      <footer class="desk-footer"><span>${icon('file',14)}正文</span><span><b id="chapter-count">${count.toLocaleString('zh-CN')}</b> 字</span></footer>
    </section>
    <aside class="assistant-panel ${mobileAssistant ? 'is-open' : ''}" aria-label="创作助手">
      <header class="assistant-title"><span>${icon('sparkles',21)}</span><h2>创作助手</h2><button type="button" class="icon-btn assistant-toggle" data-act="mobile-assistant" aria-label="关闭助手">${icon('x')}</button></header>
      <div class="model-pick"><span>使用模型</span>${models.length ? `<select id="model-select" aria-label="使用模型">${models.map(model => `<option value="${esc(model.id)}" ${model.id === state.activeProviderId ? 'selected' : ''}>${esc(model.model)}</option>`).join('')}</select>` : '<button type="button" class="btn secondary" data-act="navigate" data-id="providers">连接模型</button>'}</div>
      <div class="segments desk-tabs" aria-label="助手面板">
        <button type="button" data-act="assistant-tab" data-id="sources" class="${tab === 'sources' ? 'is-active' : ''}" aria-pressed="${tab === 'sources'}">阅读范围</button>
        <button type="button" data-act="assistant-tab" data-id="conversation" class="${tab === 'conversation' ? 'is-active' : ''}" aria-pressed="${tab === 'conversation'}">对话</button>
      </div>
      <div class="assistant-scroll" id="assistant-scroll">${tab === 'sources' ? sourcePanel(settings) : conversation(entries, busy, Boolean(models.length))}</div>
      <form id="assistant-form" class="assistant-form">
        <label class="sr-only" for="assistant-prompt">写作要求</label>
        <textarea id="assistant-prompt" name="prompt" placeholder="你想怎么写？" maxlength="16000" rows="3" ${busy ? 'disabled' : ''}>${esc(prompt)}</textarea>
        <div class="composer-toolbar">
          <select name="mode" id="assistant-mode" aria-label="助手模式" ${busy ? 'disabled' : ''}>${[['write','写正文'],['plan','理情节'],['review','查逻辑']].map(([key, name]) => `<option value="${key}" ${mode === key ? 'selected' : ''}>${name}</option>`).join('')}</select>
          <button type="submit" class="icon-btn send-button" aria-label="发送给创作助手" title="发送" ${busy ? 'disabled' : ''}>${icon('send',18)}</button>
        </div>
      </form>
    </aside>
  </div>`;
}
