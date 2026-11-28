import { esc, icon } from './icons.js';
import { chapterNumber, composerAttachments, contextItems, countWords, emptyWorkspace, maxChatAttachments, sidebar, writer } from './workspace.js';
import { renderCards, renderOutline } from './outline.js';
import { renderMemories, renderMemoryContent, renderProviders, renderReferences } from './views.js';

const app = document.getElementById('app');
const dialog = document.getElementById('dialog');
dialog.setAttribute('aria-labelledby', 'modal-title');
const toast = document.getElementById('toast');
const pages = { write: '写作台', outline: '故事大纲', cards: '设定卡片', references: '参考资料', memories: '记忆', providers: 'API 设置' };
const defaultSelection = { chapters: true, cards: true, scenes: true, planning: true };
const maxFileBytes = 25 * 1024 * 1024;
const articleDrops = new WeakMap();
const ui = {
  view: Object.hasOwn(pages, location.hash.slice(1)) ? location.hash.slice(1) : 'write',
  chapterId: '', referenceId: '', memoryId: '', memoryDetail: null,
  memoryTab: 'history', memoryFilter: 'all', memoryCards: [], memoryPoints: [],
  cardType: 'all', outlineFilter: '', providerTab: '', assistantTab: '',
  expanded: new Set(), sourcesInfo: false, mobileNav: false, mobileAssistant: false,
  drafts: new Map(), entries: new Map(), agentRuns: new Map(), mode: 'write', saved: '已保存',
  draftAttachments: new Map(), readingAttachments: new Set(),
  historyErrors: new Map(),
};
let state;
let toastTimer;
let saveTimer;
let saveQueue = Promise.resolve();
let saving = 0;
let dialogAction;
let drag;
let memoryRequest = 0;
let memoryRefreshedAt = 0;
const pending = new Map();
const historyRequests = new Map();

async function api(path, method = 'GET', payload) {
  const response = await fetch(path, {
    method,
    ...(payload === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '操作没有完成。');
  return data;
}

const project = () => state.projects.find(item => item.id === state.activeProjectId) || state.projects[0];
const chapter = (book = project()) => book?.chapters.find(item => item.id === ui.chapterId) ||
  book?.chapters.find(item => item.id === book.activeChapterId) || book?.chapters[0];
const projectKey = () => project()?.id || 'workspace';
const threadKey = () => `${projectKey()}/${chapter()?.id || ''}`;
const urlFor = (id, path = '') => `/api/projects/${id}${path}`;
const storageKey = suffix => `agent-writer/${project().id}/${suffix}`;
const readingDepth = () => project() ? localRead(storageKey('reading-depth'), 'standard') : 'standard';
const memoryModel = () => state.providers[state.activeProviderId]?.model || '';
const memoryView = () => ({
  project: project(), model: memoryModel(), memoryId: ui.memoryId, memoryDetail: ui.memoryDetail,
  memoryTab: ui.memoryTab, memoryFilter: ui.memoryFilter, memoryCards: ui.memoryCards, memoryPoints: ui.memoryPoints,
});

function localRead(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function localWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { /* Local UI preferences can be skipped when storage is unavailable. */ }
}

function selection() {
  return localRead(storageKey('reading'), defaultSelection);
}

function notify(message, error = false) {
  toast.textContent = message;
  toast.className = error ? 'shown is-error' : 'shown';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = ''; }, error ? 6500 : 2900);
}

function describeSave(status) {
  ui.saved = status;
  const target = document.getElementById('save-state');
  if (target) target.textContent = status;
}

function loadConversation(key, refresh = false) {
  if (!refresh && ui.entries.has(key)) return Promise.resolve(ui.entries.get(key));
  if (historyRequests.has(key)) return historyRequests.get(key);
  const split = key.indexOf('/');
  const origin = key.slice(0, split);
  const path = origin === 'workspace' ? '/api/agent/conversation'
    : urlFor(origin, '/conversation/' + encodeURIComponent(key.slice(split + 1)));
  ui.historyErrors.delete(key);
  const request = api(path).then(({ entries }) => {
    ui.entries.set(key, entries);
    return entries;
  }).catch(error => {
    ui.historyErrors.set(key, error.message);
    throw error;
  }).finally(() => historyRequests.delete(key));
  historyRequests.set(key, request);
  return request;
}

function render({ keepScroll = true } = {}) {
  const previous = keepScroll ? app.querySelector('.manuscript-scroll')?.scrollTop || 0 : 0;
  const chapterScroll = keepScroll ? app.querySelector('.chapter-list')?.scrollTop || 0 : 0;
  const p = project();
  const c = chapter(p);
  const shell = sidebar({ state, project: p, chapter: c, view: ui.view, mobileNav: ui.mobileNav });
  let content;
  let assistantTab;
  switch (ui.view) {
    case 'outline':
      content = renderOutline({ project: p, cardType: ui.cardType, outlineFilter: ui.outlineFilter });
      break;
    case 'cards':
      content = renderCards({ project: p, cardType: ui.cardType });
      break;
    case 'references':
      content = renderReferences({ project: p, referenceId: ui.referenceId });
      break;
    case 'memories':
      content = renderMemories(memoryView());
      break;
    case 'providers':
      content = renderProviders({ ...state, providerTab: ui.providerTab || state.activeProviderId || 'openai' });
      break;
    default:
      const job = ui.agentRuns.get(projectKey());
      const key = job?.key || threadKey();
      if (!ui.entries.has(key) && !historyRequests.has(key) && !ui.historyErrors.has(key)) {
        loadConversation(key).catch(() => {}).finally(() => {
          if (ui.view === 'write' && threadKey() === key) render();
        });
      }
      const entries = ui.entries.get(key) || [];
      assistantTab = ui.assistantTab || (entries.length || ui.historyErrors.has(key) ? 'conversation' : 'sources');
      const assistant = {
        ...ui, state, entries, prompt: ui.drafts.get(key) || '', tab: assistantTab,
        attachments: ui.draftAttachments.get(key) || [], attachmentLoading: ui.readingAttachments.has(key),
        busy: Boolean(job?.busy), locked: Boolean(job),
        historyLoading: !ui.entries.has(key) && historyRequests.has(key), historyError: ui.historyErrors.get(key),
      };
      if (p) {
        content = writer({
          ...assistant, project: p, chapter: c, selection: selection(), depth: readingDepth(),
        });
      } else {
        content = emptyWorkspace(assistant);
      }
  }
  const mobileTitle = !p && ui.view === 'write' ? '工作区' : pages[ui.view];
  app.innerHTML = `<div class="shell">${shell}${ui.mobileNav ? '<button type="button" class="mobile-scrim" data-act="mobile-nav" aria-label="关闭导航"></button>' : ''}<main class="main-view" id="main-view">${p && ui.view === 'write' ? '' : `<header class="mobile-top"><button class="icon-btn" type="button" data-act="mobile-nav" aria-label="打开导航">${icon('menu')}</button><span>${mobileTitle}</span></header>`}${content}</main></div>`;
  app.querySelectorAll('input[data-mixed="true"]').forEach(el => { el.indeterminate = true; });
  const scroll = app.querySelector('.manuscript-scroll');
  if (scroll) scroll.scrollTop = previous;
  const chapters = app.querySelector('.chapter-list');
  if (chapters) chapters.scrollTop = chapterScroll;
  fitManuscript();
  const conversation = document.getElementById('assistant-scroll');
  if ((assistantTab === 'conversation' || !p) && conversation) conversation.scrollTop = conversation.scrollHeight;
}

function fitManuscript() {
  const area = document.getElementById('chapter-text');
  if (!area) return;
  area.style.height = 'auto';
  area.style.height = `${area.scrollHeight + 2}px`;
}

function navigate(view, keepScroll = false) {
  if (!Object.hasOwn(pages, view)) return;
  if (!project() && view !== 'providers') view = 'write';
  ui.view = view;
  ui.mobileNav = false;
  ui.mobileAssistant = false;
  if (view === 'cards' && !ui.cardType) ui.cardType = 'all';
  history.replaceState(null, '', '#' + view);
  render({ keepScroll });
  if (view === 'memories') refreshMemories().catch(error => notify(error.message, true));
}

async function refreshMemories() {
  const current = project();
  if (!current) return;
  const request = ++memoryRequest;
  memoryRefreshedAt = Date.now();
  const result = await api(urlFor(current.id, '/memories'));
  if (request !== memoryRequest || project()?.id !== current.id || ui.view !== 'memories') return;
  const changed = JSON.stringify([current.memories, ui.memoryCards, ui.memoryPoints]) !== JSON.stringify([result.memories, result.cards, result.points]);
  mergeBook(current, result);
  ui.memoryCards = result.cards;
  ui.memoryPoints = result.points;
  if (changed) updateMemoryContent();
}

function updateMemoryContent() {
  const pane = document.getElementById('memory-content');
  if (!pane) return;
  const active = document.activeElement;
  const focus = pane.contains(active) && active.dataset?.act ? active.dataset : null;
  const expanded = [...pane.querySelectorAll('.aux-snapshot-group')].map(group => group.open);
  pane.innerHTML = renderMemoryContent(memoryView());
  pane.querySelectorAll('.aux-snapshot-group').forEach((group, i) => { if (expanded[i]) group.open = true; });
  if (focus) {
    const action = CSS.escape(focus.act);
    const id = CSS.escape(focus.id || '');
    pane.querySelector(`[data-act="${action}"][data-id="${id}"]`)?.focus({ preventScroll: true });
  }
  const changeCount = document.getElementById('memory-change-count');
  if (changeCount) changeCount.textContent = (Number(project().memoryState?.changedCharacters) || 0).toLocaleString('zh-CN');
}

function setMemoryTab(tab) {
  ui.memoryTab = tab;
  app.querySelectorAll('[data-act="memory-tab"]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.id === tab));
  });
  updateMemoryContent();
}

function stage(part, id = project().id) {
  pending.set(id, { ...pending.get(id), ...structuredClone(part) });
  describeSave('正在编辑');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => flush().catch(error => notify(error.message, true)), 650);
}

function mergeBook(target, incoming) {
  target.memories = incoming.memories;
  target.memoryState = incoming.memoryState;
  if (incoming.updatedAt) target.updatedAt = incoming.updatedAt;
}

function flush() {
  clearTimeout(saveTimer);
  const jobs = [...pending.entries()];
  pending.clear();
  if (!jobs.length) return saveQueue;
  describeSave('正在保存…');
  saving++;
  const operation = saveQueue.catch(() => {}).then(async () => {
    let failure;
    for (const [id, patch] of jobs) {
      try {
        const result = await api(urlFor(id), 'PATCH', patch);
        const target = state.projects.find(item => item.id === id);
        if (target) mergeBook(target, result);
      } catch (error) {
        pending.set(id, { ...patch, ...pending.get(id) });
        failure ||= error;
      }
    }
    describeSave(failure ? '保存失败' : pending.size ? '正在编辑' : '已保存');
    if (failure) throw failure;
  }).finally(() => { saving--; });
  saveQueue = operation;
  return operation;
}

async function patchBook(target, patch) {
  await flush();
  const result = await api(urlFor(target.id), 'PATCH', patch);
  Object.assign(target, result);
  return result;
}

function resetProject() {
  const current = project();
  ui.chapterId = current ? localRead(storageKey('chapter'), current.activeChapterId || current.defaultChapterId || '') : '';
  ui.chapterId = chapter(current)?.id || '';
  if (!current && ui.view !== 'providers') ui.view = 'write';
  ui.referenceId = '';
  ui.memoryId = '';
  ui.memoryDetail = null;
  ui.memoryTab = 'history';
  ui.memoryFilter = 'all';
  ui.memoryCards = [];
  ui.memoryPoints = [];
  ui.outlineFilter = '';
  ui.assistantTab = '';
  ui.expanded.clear();
  describeSave('已保存');
}

function showDialog(title, html, submitLabel, action, options = {}) {
  dialogAction = action;
  dialog.innerHTML = `<form id="modal-form"><header><h2 id="modal-title">${esc(title)}</h2><button class="icon-btn" type="button" data-act="dialog-close" aria-label="关闭">${icon('x')}</button></header><div class="modal-fields">${html}</div><p class="form-feedback" data-form-error role="alert" hidden></p><footer>${options.remove ? '<button type="button" class="btn danger" data-act="dialog-remove">删除</button>' : ''}<span></span><button type="button" class="btn secondary" data-act="dialog-close"${options.danger ? ' autofocus' : ''}>取消</button><button class="btn primary${options.danger ? ' danger' : ''}" type="submit">${esc(submitLabel)}</button></footer></form>`;
  dialog.removeAction = options.remove;
  if (!dialog.open) dialog.showModal();
}

function modalField(name, label, value = '', multiline = false, max = 140, required = false) {
  return `<label class="field"><span>${label}</span>${multiline ? `<textarea name="${name}" rows="5" maxlength="${max}">${esc(value)}</textarea>` : `<input name="${name}" value="${esc(value)}" maxlength="${max}" ${required ? 'required' : ''}>`}</label>`;
}

function projectDialog() {
  showDialog('新建项目', modalField('title', '作品名称', '', false, 120, true) + modalField('description', '作品简介', '', true, 8000), '创建项目', async ({ title, description }) => {
    await flush();
    const result = await api('/api/projects', 'POST', { title, description });
    state.projects.push(result);
    state.activeProjectId = result.id;
    resetProject();
    navigate('write');
    notify('已创建项目');
  });
}

function articleImportDialog() {
  const target = project();
  const destinationField = target ? `<label class="field"><span>导入到</span><select name="articleDestination"><option value="current">追加到「${esc(target.title)}」</option><option value="new">新建项目</option></select></label>` : '';
  const desktopPicker = window.agentWriter?.pickArticle;
  const filePicker = desktopPicker ? `<button class="btn secondary" type="button" aria-describedby="article-file-help">${icon('upload')}选择文件</button>` :
    `<input id="article-file" class="aux-file-input" name="articleFile" type="file" accept=".txt,.text,.md,.markdown,.docx,.odt,.pdf,.epub,.html,.htm,.xhtml" aria-describedby="article-file-help"><label class="btn secondary" for="article-file">${icon('upload')}选择文件</label>`;
  const fileField = `<div class="field article-file"><span>文章文件</span><div class="article-file-control" data-drop="article">${filePicker}<span class="article-filename muted" aria-live="polite">或拖入一篇文章</span></div><small id="article-file-help" class="muted">TXT、Markdown、Word、ODT、EPUB、HTML 或文字版 PDF，最多 25 MB。</small></div>`;
  let preview;
  const selectedChapters = mode => mode === 'single' ? [{ title: preview.title, text: preview.text }] : preview.chapters;
  showDialog('导入文章', fileField + destinationField +
    `<label class="field article-name" ${target ? 'hidden' : ''}><span>作品名称</span><input name="articleTitle" maxlength="120" required ${target ? 'disabled' : ''}></label>
      <p class="modal-note article-status" role="status" hidden></p>
      <section class="article-preview" aria-label="章节预览" hidden>
        <div class="article-preview-header"><strong class="article-summary"></strong><label class="article-mode"><span class="sr-only">分章方式</span><select name="articleSplit"><option value="auto">自动分章</option><option value="single">整篇作为一章</option></select></label></div>
        <ol class="article-chapter-list"></ol>
      </section>`,
    '导入文章', async values => {
      if (!preview) return;
      const chapters = selectedChapters(values.articleSplit);
      await flush();
      const result = await api('/api/articles/import', 'POST', {
        projectId: values.articleDestination === 'current' ? target.id : null,
        title: values.articleTitle || preview.title,
        chapters,
      });
      const existing = state.projects.find(item => item.id === result.id);
      if (existing) Object.assign(existing, result);
      else state.projects.push(result);
      state.activeProjectId = result.id;
      localWrite(storageKey('chapter'), result.activeChapterId);
      resetProject();
      navigate('write');
      notify(`已导入 ${chapters.length} 章`);
    });

  const form = dialog.querySelector('form');
  const submit = form.querySelector('[type="submit"]');
  const fileControl = form.elements.articleFile;
  const pickButton = form.querySelector('.article-file-control button');
  const filename = form.querySelector('.article-filename');
  const destination = form.elements.articleDestination;
  const name = form.elements.articleTitle;
  const split = form.elements.articleSplit;
  const status = form.querySelector('.article-status');
  const section = form.querySelector('.article-preview');
  const summary = form.querySelector('.article-summary');
  const list = form.querySelector('.article-chapter-list');
  let revision = 0;
  let suggestedTitle = '';
  submit.disabled = true;

  destination?.addEventListener('change', () => {
    const newProject = destination.value === 'new';
    name.disabled = !newProject;
    name.closest('label').hidden = !newProject;
  });
  function renderPreview() {
    const chapters = selectedChapters(split.value);
    summary.textContent = split.value === 'single' ? '整篇导入为一章' : preview.recognized ?
      `将导入 ${chapters.length} 章` : '未识别到章节标题，将导入为一章';
    list.innerHTML = chapters.map(chapter => `<li><span title="${esc(chapter.title)}">${esc(chapter.title)}</span><small>${countWords(chapter.text).toLocaleString('zh-CN')} 字</small></li>`).join('');
  }
  split.addEventListener('change', renderPreview);
  async function loadPreview(readPreview, message) {
    const request = ++revision;
    const isCurrent = () => form.isConnected && dialog.open && request === revision;
    submit.disabled = true;
    status.hidden = false;
    status.classList.remove('is-error');
    status.textContent = message;
    try {
      const result = await readPreview();
      if (!isCurrent()) return;
      status.hidden = true;
      if (!result) return;
      if (filename && result.name) {
        filename.textContent = result.name;
        filename.title = result.name;
      }
      if (result.error) throw new Error(result.error);
      const data = result.preview;
      preview = data;
      if (!name.value || name.value === suggestedTitle) name.value = data.title;
      suggestedTitle = data.title;
      split.value = 'auto';
      split.closest('label').hidden = !data.recognized;
      section.hidden = false;
      renderPreview();
    } catch (error) {
      if (!isCurrent()) return;
      preview = null;
      section.hidden = true;
      status.hidden = false;
      status.classList.add('is-error');
      status.textContent = error.message;
    } finally {
      if (isCurrent()) submit.disabled = !preview;
    }
  }
  const loadArticle = file => loadPreview(async () => ({ name: file.name,
    preview: await api('/api/articles/preview', 'POST', await packLocalFile(file)),
  }), '正在读取并识别章节…');
  articleDrops.set(form.querySelector('[data-drop="article"]'), loadArticle);
  fileControl?.addEventListener('change', () => {
    const file = fileControl.files[0];
    fileControl.value = '';
    if (file) void loadArticle(file);
  });
  pickButton?.addEventListener('click', async () => {
    if (preview && submit.disabled) return;
    pickButton.disabled = true;
    await loadPreview(desktopPicker, '正在选择并读取文章…');
    pickButton.disabled = false;
    if (form.isConnected && dialog.open) pickButton.focus();
  });
}

function renameProjectDialog(id) {
  const book = state.projects.find(item => item.id === id);
  if (!book) return;
  showDialog('重命名项目', modalField('title', '作品名称', book.title, false, 120, true), '保存名称', async ({ title }) => {
    const nextTitle = title.trim();
    if (!nextTitle) throw new Error('请填写作品名称。');
    if (nextTitle !== book.title) {
      await patchBook(book, { title: nextTitle });
      render();
      notify('已重命名项目');
    }
    return app.querySelector('.project-rename');
  });
  const input = dialog.querySelector('input[name="title"]');
  input.focus();
  input.select();
}

function deleteProjectDialog(id) {
  const book = state.projects.find(item => item.id === id);
  if (!book) return;
  showDialog('删除项目',
    `<p class="modal-note">确定删除「${esc(book.title)}」吗？正文、设定、参考资料、记忆和对话记录会一起删除。此操作无法撤销。</p>`,
    '确认删除', async () => {
      await flush();
      const result = await api(urlFor(book.id), 'DELETE');
      state.projects = state.projects.filter(item => item.id !== book.id);
      state.activeProjectId = result.activeProjectId;
      for (const threads of [ui.drafts, ui.entries, ui.draftAttachments, ui.historyErrors]) {
        for (const key of threads.keys()) {
          if (key.startsWith(book.id + '/')) threads.delete(key);
        }
      }
      try {
        localStorage.removeItem(`agent-writer/${book.id}/chapter`);
        localStorage.removeItem(`agent-writer/${book.id}/reading`);
        localStorage.removeItem(`agent-writer/${book.id}/reading-depth`);
      } catch { /* Local UI preferences may be unavailable. */ }
      resetProject();
      navigate('write');
      notify('已删除项目');
    }, { danger: true });
}

function chapterDialog() {
  const p = project();
  const previous = chapter();
  showDialog('新建章节', modalField('title', '章节标题', `第 ${chapterNumber(p.chapters.length)} 章`, false, 140, true), '创建章节', async ({ title }) => {
    const next = { id: crypto.randomUUID(), title: title.trim() || '未命名章节', text: '' };
    await patchBook(p, { appendChapter: next, finishChapterId: previous.id, activeChapterId: next.id });
    ui.chapterId = next.id;
    localWrite(storageKey('chapter'), next.id);
    navigate('write');
    document.getElementById('chapter-text')?.focus();
    notify(p.memorySettings.chapterEnabled ? '已创建章节并检查章节记忆' : '已创建章节');
  });
}

async function exportTxt(projectId, chapterIds) {
  await flush();
  const { filename, text, chapterCount } = await api(urlFor(projectId, '/export-txt'), 'POST', { chapterIds });
  if (window.agentWriter?.saveTxt) {
    const outcome = await window.agentWriter.saveTxt(filename, text);
    if (outcome.error) throw new Error(outcome.error);
    if (!outcome.saved) return false;
  } else {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
  notify(`已导出 ${chapterCount} 章 TXT`);
  return true;
}

function exportChapterDialog() {
  const book = project();
  const activeChapter = chapter(book).id;
  showDialog('导出 TXT', `<fieldset class="export-range"><legend>导出范围</legend>
    <label><input type="radio" name="exportScope" value="selected" checked>选定章节</label>
    <label><input type="radio" name="exportScope" value="book">全书</label></fieldset>
    <div class="export-choices">
      <div class="export-choices-head"><label><input type="checkbox" data-export-all>全选章节</label><small class="muted" data-export-count role="status"></small></div>
      <div class="export-choices-list" role="group" aria-label="选择要导出的章节">
        ${book.chapters.map((item, index) => `<label><input type="checkbox" name="chapterId" value="${esc(item.id)}"${item.id === activeChapter ? ' checked' : ''}><span class="chapter-number">${chapterNumber(index)}</span><span>${esc(item.title.trim() || '未命名章节')}</span></label>`).join('')}
      </div>
    </div>`, '导出 TXT', async (_values, data) => {
      const chapterIds = data.get('exportScope') === 'book' ? undefined : data.getAll('chapterId');
      return await exportTxt(book.id, chapterIds) ? undefined : false;
    });
  const form = dialog.querySelector('form');
  const panel = form.querySelector('.export-choices');
  const all = form.querySelector('[data-export-all]');
  const count = form.querySelector('[data-export-count]');
  const chapters = [...form.querySelectorAll('[name="chapterId"]')];
  const submit = form.querySelector('[type="submit"]');
  function updateSelection() {
    const bookScope = form.elements.exportScope.value === 'book';
    const selected = chapters.filter(field => field.checked).length;
    panel.hidden = bookScope;
    all.checked = selected === chapters.length;
    all.indeterminate = selected > 0 && selected < chapters.length;
    count.textContent = `已选 ${selected} / ${chapters.length} 章`;
    submit.disabled = !bookScope && !selected;
  }
  form.addEventListener('change', event => {
    if (event.target === all) chapters.forEach(field => { field.checked = all.checked; });
    updateSelection();
  });
  updateSelection();
}

function deleteChapterDialog(id) {
  const book = project();
  const target = book?.chapters.find(item => item.id === id);
  if (!target) return;
  const title = target.title.trim() || '未命名章节';
  const replacement = book.chapters.length === 1 ? '<p class="modal-note">删除后会新建一章空白正文。</p>' : '';
  const linked = book.scenes.some(scene => scene.chapterId === id) ?
    '<p class="modal-note">已关联的大纲场景会保留，章节链接会解除。</p>' : '';
  const snapshots = book.memories.length ? '<p class="modal-note">已保存的记忆会保留。</p>' : '';
  showDialog('删除章节', `<p class="modal-note">确定删除「${esc(title)}」及其正文和对话记录吗？此操作无法撤销。</p>${linked}${replacement}${snapshots}`,
    '确认删除', async () => {
      await patchBook(book, { removeChapterId: id });
      const key = `${book.id}/${id}`;
      ui.drafts.delete(key);
      ui.entries.delete(key);
      ui.draftAttachments.delete(key);
      ui.historyErrors.delete(key);
      if (project()?.id !== book.id) return;
      ui.chapterId = chapter(book).id;
      localWrite(storageKey('chapter'), ui.chapterId);
      const reading = selection();
      if (Array.isArray(reading.chapters) && reading.chapters.includes(id)) {
        localWrite(storageKey('reading'), { ...reading, chapters: reading.chapters.filter(item => item !== id) });
      }
      render();
      notify('已删除章节');
      return app.querySelector(`.chapter-link[data-id="${CSS.escape(ui.chapterId)}"]`);
    }, { danger: true });
}

const typeNames = { character: '角色', prop: '道具', location: '地点', organization: '组织' };
const actNames = { 1: '第一幕 · 开端', 2: '第二幕 · 发展', 3: '第三幕 · 收束' };

function confirmRemoval(label, action) {
  showDialog('删除' + label, `<p class="modal-note">删除后，这项内容将从当前项目移除。</p>`, '确认删除', action);
}

function cardDialog(cardId) {
  const p = project();
  const original = p.cards.find(it => it.id === cardId);
  const activeType = original?.type || (Object.hasOwn(typeNames, ui.cardType) ? ui.cardType : 'character');
  const typeField = `<label class="field"><span>类型</span><select name="type">${Object.entries(typeNames).map(([key, label]) => `<option value="${key}" ${activeType === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`;
  showDialog(original ? '编辑设定卡片' : '新建设定卡片',
    modalField('title', '名称', original?.title, false, 140, true) + typeField + modalField('description', '设定内容', original?.description, true, 80000),
    '保存卡片', async ({ title, type, description }) => {
      if (!title.trim()) throw new Error('请填写卡片名称。');
      const next = { id: original?.id || crypto.randomUUID(), title: title.trim(), type, description };
      const cards = original ? p.cards.map(it => it.id === original.id ? next : it) : [...p.cards, next];
      await patchBook(p, { cards });
      if (ui.cardType !== 'all') ui.cardType = type;
      render();
      notify('已保存设定卡片');
    }, original ? { remove: () => confirmRemoval('设定卡片', async () => {
      const cards = p.cards.filter(it => it.id !== original.id);
      const scenes = p.scenes.map(it => ({ ...it, cardIds: it.cardIds.filter(id => id !== original.id) }));
      await patchBook(p, { cards, scenes });
      render();
      notify('已删除设定卡片');
    }) } : {});
}

function sceneDialog(sceneId, act = 1) {
  const p = project();
  const original = p.scenes.find(it => it.id === sceneId);
  const activeAct = original?.act || act;
  const selects = `<div class="modal-columns"><label class="field"><span>所在幕</span><select name="act">${Object.entries(actNames).map(([key, label]) => `<option value="${key}" ${activeAct === Number(key) ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label class="field"><span>关联章节</span><select name="chapterId"><option value="">暂未关联</option>${p.chapters.map((it, i) => `<option value="${esc(it.id)}" ${original?.chapterId === it.id ? 'selected' : ''}>${chapterNumber(i)} ${esc(it.title)}</option>`).join('')}</select></label></div>`;
  const cards = p.cards.length ? `<fieldset class="card-selection"><legend>引用设定</legend><div>${p.cards.map(it => `<label><input type="checkbox" name="cardIds" value="${esc(it.id)}" ${original?.cardIds.includes(it.id) ? 'checked' : ''}>${esc(it.title)}<small>${typeNames[it.type]}</small></label>`).join('')}</div></fieldset>` : '';
  showDialog(original ? '编辑场景' : '新建场景',
    modalField('title', '场景名称', original?.title, false, 140, true) + selects + modalField('description', '场景梗概', original?.description, true, 80000) + cards,
    '保存场景', async ({ title, act, chapterId, description }, form) => {
      if (!title.trim()) throw new Error('请填写场景名称。');
      const next = { id: original?.id || crypto.randomUUID(), title: title.trim(), act: Number(act), chapterId, description, cardIds: form.getAll('cardIds') };
      const scenes = original ? p.scenes.map(it => it.id === original.id ? next : it) : [...p.scenes, next];
      await patchBook(p, { scenes });
      render();
      notify('已保存场景');
    }, original ? { remove: () => confirmRemoval('场景', async () => {
      const scenes = p.scenes.filter(it => it.id !== original.id);
      await patchBook(p, { scenes });
      render();
      notify('已删除场景');
    }) } : {});
}

function fileData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('无法读取此文件。'));
    reader.readAsDataURL(file);
  });
}

async function packLocalFile(file) {
  if (file.size > maxFileBytes) throw new Error('单个文件不能超过 25 MB。');
  return { name: file.name, data: await fileData(file) };
}

async function uploadFiles(files) {
  if (!files.length) return;
  const target = project();
  await flush();
  let imported = 0;
  const errors = [];
  for (const [index, file] of Array.from(files).entries()) {
    notify(`正在读取 ${index + 1}/${files.length}：${file.name}`);
    try {
      const incoming = await api(urlFor(target.id, '/references'), 'POST', await packLocalFile(file));
      target.references = incoming.references;
      mergeBook(target, incoming);
      if (project()?.id === target.id) ui.referenceId = incoming.references.at(-1).id;
      imported++;
    } catch (error) {
      errors.push(`${file.name}：${error.message}`);
    }
  }
  if (!state.projects.includes(target)) return;
  if (project()?.id === target.id && ui.view === 'references') render();
  const status = document.getElementById('reference-status');
  if (status && errors.length) {
    status.replaceChildren(...errors.map(message => {
      const line = document.createElement('p');
      line.textContent = message;
      return line;
    }));
  }
  if (imported && !errors.length) notify(`已导入 ${imported} 份资料`);
  if (errors.length) notify(`${imported ? `已导入 ${imported} 份。 ` : ''}${errors[0]}`, true);
}

async function chooseProvider(id) {
  await api('/api/providers/select', 'POST', { id });
  state.activeProviderId = id;
  render();
  notify('已切换模型');
}

async function providerForm(test = false) {
  const form = document.getElementById('provider-form');
  if (!form?.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form));
  values.removeKey = values.removeKey === 'on';
  const status = form.querySelector('#provider-status');
  status.textContent = test ? '正在测试连接…' : '正在保存连接…';
  delete status.dataset.error;
  const buttons = form.querySelectorAll('[data-act="provider-test"], button[type="submit"]');
  buttons.forEach(button => { button.disabled = true; });
  try {
    const response = await api(`/api/providers/${test ? 'test' : 'save'}`, 'POST', values);
    if (test) {
      status.textContent = `连接成功。请求路径 ${new URL(response.endpoint).pathname}`;
      notify('模型连接成功');
    } else {
      state.providers[response.id] = response;
      state.activeProviderId = response.id;
      render();
      notify('已保存并启用模型连接');
    }
  } catch (error) {
    status.dataset.error = 'true';
    status.textContent = error.message;
    throw error;
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
}

async function generate() {
  const key = threadKey();
  const origin = projectKey();
  if (ui.agentRuns.has(origin) || ui.readingAttachments.has(key)) return;
  if (!ui.entries.has(key)) {
    await loadConversation(key);
    if (key !== threadKey() || ui.agentRuns.has(origin) || ui.readingAttachments.has(key)) return;
  }
  const prompt = (ui.drafts.get(key) || '').trim();
  const attachments = ui.draftAttachments.get(key) || [];
  if (!prompt && !attachments.length) {
    document.getElementById('assistant-prompt')?.focus();
    return;
  }
  const p = project();
  const c = chapter();
  const entries = ui.entries.get(key) || [];
  const recentFiles = entries.slice().reverse().filter(item => !item.failed).flatMap(item => item.attachments?.map(file => file.id) || []);
  const request = {
    chapterId: c?.id, selected: p ? selection() : {}, depth: readingDepth(), prompt, mode: ui.mode, providerId: state.activeProviderId,
    attachmentIds: attachments.map(file => file.id),
    recentAttachmentIds: [...new Set(recentFiles)].slice(0, maxChatAttachments),
  };
  const message = { role: 'user', text: prompt, attachments };
  entries.push(message);
  ui.entries.set(key, entries);
  const job = { key, origin, entries, message, busy: true, pending: null };
  ui.agentRuns.set(origin, job);
  ui.drafts.set(key, '');
  ui.draftAttachments.delete(key);
  ui.assistantTab = 'conversation';
  render();
  await agentTurn(job, p ? urlFor(p.id, '/generate') : '/api/agent/generate', request);
}

async function syncAgentResult(job, result) {
  const onOrigin = projectKey() === job.origin;
  if (result.changed) {
    const current = projectKey();
    await flush();
    const next = await api('/api/state');
    const selected = !onOrigin ? current : result.ui?.projectId ?? current;
    if (next.projects.some(book => book.id === selected)) next.activeProjectId = selected;
    state = next;
  } else if (result.memories) {
    const book = state.projects.find(item => item.id === job.origin);
    if (book) book.memories = result.memories;
  }
  if (!onOrigin || !result.ui) return;
  if (projectKey() !== job.origin) resetProject();
  if (result.ui.chapterId && project()?.chapters.some(item => item.id === result.ui.chapterId)) {
    ui.chapterId = result.ui.chapterId;
    localWrite(storageKey('chapter'), ui.chapterId);
  }
  if (project() && result.ui.reading) localWrite(storageKey('reading'), { ...selection(), ...result.ui.reading });
  if (project() && result.ui.depth) localWrite(storageKey('reading-depth'), result.ui.depth);
  if (result.ui.mode) ui.mode = result.ui.mode;
  if (result.ui.view && (project() || ['write', 'providers'].includes(result.ui.view))) {
    if (ui.view !== result.ui.view) navigate(result.ui.view);
  }
  const destination = threadKey();
  if (destination !== job.key && project()) {
    if (!result.historyError) await loadConversation(destination, true);
    else ui.entries.set(destination, [...(ui.entries.get(destination) ?? []), ...job.entries.slice(-2)]);
    ui.assistantTab = 'conversation';
  }
}

async function agentTurn(job, path, request) {
  job.busy = true;
  try {
    await flush();
    const result = await api(path, 'POST', request);
    if (result.historyError) notify(result.historyError, true);
    if (job.pending) job.entries.pop();
    job.pending = result.pending ?? null;
    if (job.pending) {
      job.entries.push({ role: 'tool_request', pending: job.pending });
      return;
    }
    job.entries.push({
      id: result.entryId ?? crypto.randomUUID(), role: result.error ? 'error' : 'assistant',
      text: result.error || result.text, report: result.report, trace: result.trace,
      allowApply: !result.changed && job.origin !== 'workspace',
    });
    try { await syncAgentResult(job, result); }
    catch (error) { notify(error.message, true); }
  } catch (error) {
    if (job.pending) job.entries.pop();
    job.pending = null;
    job.entries.push({ role: 'error', text: error.message });
    if (!request.id) {
      job.message.failed = true;
      if (!ui.drafts.get(job.key)) ui.drafts.set(job.key, job.message.text);
      if (job.message.attachments.length) ui.draftAttachments.set(job.key, job.message.attachments);
    }
  } finally {
    job.busy = false;
    if (!job.pending) ui.agentRuns.delete(job.origin);
    if (ui.view === 'write' || !job.pending) render();
  }
}

function chooseAgentFile(purpose) {
  if (window.agentWriter?.pickToolFile) return window.agentWriter.pickToolFile(purpose);
  return new Promise((resolve, reject) => {
    const field = document.createElement('input');
    field.type = 'file';
    field.hidden = true;
    field.accept = purpose === 'article' ? '.txt,.text,.md,.markdown,.docx,.odt,.pdf,.epub,.html,.htm,.xhtml'
      : '.txt,.text,.md,.markdown,.csv,.tsv,.json,.jsonl,.html,.htm,.xhtml,.xml,.docx,.pdf,.epub,.odt';
    document.body.append(field);
    field.addEventListener('cancel', () => { field.remove(); resolve(null); }, { once: true });
    field.addEventListener('change', async () => {
      const file = field.files[0];
      field.remove();
      if (!file) return resolve(null);
      try { resolve(await packLocalFile(file)); }
      catch (error) { reject(error); }
    }, { once: true });
    field.click();
  });
}

function updateComposerAttachments(key) {
  const form = document.getElementById('assistant-form');
  if (!form || key !== threadKey()) return;
  const files = ui.draftAttachments.get(key) || [];
  const loading = ui.readingAttachments.has(key);
  const locked = ui.agentRuns.has(projectKey());
  const full = files.length >= maxChatAttachments;
  form.querySelector('#composer-attachments').innerHTML = composerAttachments(files, loading, locked);
  const add = form.querySelector('[data-act="attachment-add"]');
  add.disabled = locked || loading || full;
  add.title = full ? '每条消息最多 5 个附件' : '添加附件，也可拖入文本文件（单个最多 25 MB）';
  form.querySelector('.send-button').disabled = locked || loading;
  form.toggleAttribute('data-drop-disabled', add.disabled);
}

async function addChatAttachments(selectFiles) {
  const key = threadKey();
  if (ui.agentRuns.has(projectKey()) || ui.readingAttachments.has(key)) return;
  const available = maxChatAttachments - (ui.draftAttachments.get(key)?.length || 0);
  if (!available) throw new Error('每条消息最多 5 个附件。');
  ui.readingAttachments.add(key);
  try {
    const selection = selectFiles();
    updateComposerAttachments(key);
    const files = await selection;
    const errors = [];
    for (const file of files.slice(0, available)) {
      try {
        if (file.error) throw new Error(file.error);
        const attachment = await api('/api/agent/attachments', 'POST', file instanceof File ? await packLocalFile(file) : file);
        ui.draftAttachments.set(key, [...(ui.draftAttachments.get(key) || []), attachment]);
      } catch (error) {
        errors.push(file.name ? `「${file.name}」${error.message}` : error.message);
      }
    }
    if (files.length > available) errors.push('每条消息最多 5 个附件。');
    if (errors.length) notify(errors.join(' '), true);
  } finally {
    ui.readingAttachments.delete(key);
    updateComposerAttachments(key);
    if (key === threadKey() && document.activeElement === document.body) document.getElementById('assistant-prompt')?.focus();
  }
}

async function answerAgentRequest(button, droppedFile) {
  const job = ui.agentRuns.get(projectKey());
  if (!job?.pending || job.pending.id !== button.dataset.id || job.busy || button.disabled) return;
  const approval = { id: job.pending.id, approved: !button.hasAttribute('data-decline') };
  const prompt = button.closest('.tool-request');
  const controls = [...prompt.querySelectorAll('button')];
  prompt.setAttribute('data-drop-disabled', '');
  controls.forEach(control => { control.disabled = true; });
  try {
    if (approval.approved && job.pending.kind === 'key') {
      const input = prompt.querySelector('input');
      if (!input.value.trim()) { input.focus(); throw new Error('请在本机输入 API Key。'); }
      approval.key = input.value;
      input.value = '';
    }
    if (approval.approved && job.pending.kind === 'file') {
      approval.file = await (droppedFile ? packLocalFile(droppedFile) : chooseAgentFile(job.pending.purpose));
      if (!approval.file) return;
      if (approval.file.error) throw new Error(approval.file.error);
    }
    if (approval.approved && job.pending.kind === 'copy') await navigator.clipboard.writeText(job.pending.text);
    if (approval.approved && job.pending.kind === 'link') window.open(job.pending.url, '_blank', 'noopener,noreferrer');
    if (approval.approved && job.pending.kind === 'export' && !await exportTxt(job.pending.projectId, job.pending.chapterIds)) return;
    await agentTurn(job, urlFor(job.origin, '/agent/continue'), approval);
  } finally {
    controls.forEach(control => { control.disabled = false; });
    prompt.removeAttribute('data-drop-disabled');
  }
}

async function linkCard(card, scene) {
  if (scene.cardIds.includes(card)) return;
  scene.cardIds.push(card);
  stage({ scenes: project().scenes });
  render();
  await flush();
  notify('已引用设定卡片');
}

async function relocateScene(id, targetId, act) {
  const p = project();
  const source = p.scenes.find(item => item.id === id);
  const target = p.scenes.find(item => item.id === targetId);
  if (!source || source === target) return;
  source.act = target?.act || act;
  const scenes = p.scenes.filter(item => item.id !== id);
  scenes.splice(target ? scenes.indexOf(target) : scenes.length, 0, source);
  p.scenes = scenes;
  stage({ scenes });
  render();
  await flush();
}

const actions = {
  navigate: el => navigate(el.dataset.id),
  'mobile-nav': () => { ui.mobileNav = !ui.mobileNav; render(); },
  'mobile-assistant': () => { ui.mobileAssistant = !ui.mobileAssistant; render(); },
  'agent-decision': answerAgentRequest,
  'attachment-add': () => addChatAttachments(async () => {
    const file = await chooseAgentFile('attachment');
    return file ? [file] : [];
  }),
  'attachment-remove': el => {
    const key = threadKey();
    const files = (ui.draftAttachments.get(key) || []).filter(file => file.id !== el.dataset.id);
    if (files.length) ui.draftAttachments.set(key, files);
    else ui.draftAttachments.delete(key);
    updateComposerAttachments(key);
    document.getElementById('assistant-prompt')?.focus();
  },
  'project-add': projectDialog,
  'article-import': articleImportDialog,
  'project-switch': async el => {
    const picker = el.closest('.project-picker');
    picker.open = false;
    picker.querySelector('.project-selector').focus();
    const { id } = el.dataset;
    if (id === project()?.id) return;
    await flush();
    await api(urlFor(id, '/select'), 'POST', {});
    state.activeProjectId = id;
    resetProject();
    navigate('write');
    app.querySelector('.project-selector')?.focus({ preventScroll: true });
  },
  'project-rename': el => renameProjectDialog(el.dataset.id),
  'project-delete': el => deleteProjectDialog(el.dataset.id),
  'chapter-add': chapterDialog,
  'chapter-export': exportChapterDialog,
  'chapter-delete': el => deleteChapterDialog(el.dataset.id),
  chapter: async el => {
    const current = project();
    await flush();
    if (project()?.id !== current.id) return;
    const id = el.dataset.id;
    current.activeChapterId = id;
    stage({ activeChapterId: id }, current.id);
    ui.chapterId = id;
    localWrite(storageKey('chapter'), ui.chapterId);
    navigate('write');
  },
  save: async () => { await flush(); notify('正文已保存'); },
  'dialog-close': () => dialog.close(),
  'dialog-remove': () => dialog.removeAction?.(),
  'assistant-tab': el => { ui.assistantTab = el.dataset.id; render(); },
  'history-retry': async () => {
    try { await loadConversation(threadKey(), true); }
    finally { render(); }
  },
  'sources-info': () => { ui.sourcesInfo = !ui.sourcesInfo; render(); },
  'source-expand': el => {
    const key = el.dataset.id;
    if (ui.expanded.has(key)) ui.expanded.delete(key);
    else ui.expanded.add(key);
    render();
    app.querySelector(`[data-act="source-expand"][data-id="${key}"]`)?.focus();
  },
  'sample-prompt': () => {
    ui.mode = 'review';
    ui.drafts.set(threadKey(), '请检查这一章的因果、人物动机和前文一致性，指出具体段落。');
    render();
    document.getElementById('assistant-prompt')?.focus();
  },
  'response-copy': async el => {
    const result = ui.entries.get(threadKey())?.find(item => item.id === el.dataset.id);
    if (result) await navigator.clipboard.writeText(result.text);
    notify('已复制');
  },
  'response-apply': async el => {
    if (ui.agentRuns.has(projectKey())) throw new Error('请等当前工具操作完成后再写入正文。');
    const result = ui.entries.get(threadKey())?.find(item => item.id === el.dataset.id);
    if (!result) return;
    const c = chapter();
    c.text = c.text.trimEnd() + (c.text.trim() ? '\n\n' : '') + result.text;
    stage({ chapter: c });
    await flush();
    render();
    notify('已加入当前章节');
  },
  'card-type': el => { ui.cardType = el.dataset.id; render(); },
  'card-add': () => cardDialog(),
  'card-edit': el => cardDialog(el.dataset.id),
  'scene-add': el => sceneDialog(null, Number(el.dataset.actnum) || 1),
  'scene-edit': el => sceneDialog(el.dataset.id),
  'scene-unlink': async el => {
    const scene = project().scenes.find(item => item.id === el.dataset.id);
    if (!scene) return;
    scene.cardIds = scene.cardIds.filter(id => id !== el.dataset.card);
    stage({ scenes: project().scenes });
    await flush();
    render();
  },
  'provider-tab': el => { ui.providerTab = el.dataset.id; render(); },
  'provider-select': el => chooseProvider(el.dataset.id),
  'provider-test': () => providerForm(true),
  'toggle-key': el => {
    const key = document.querySelector('#provider-form input[name="key"]');
    if (!key) return;
    key.type = key.type === 'password' ? 'text' : 'password';
    el.setAttribute('aria-pressed', key.type === 'text');
  },
  'reference-select': el => { ui.referenceId = el.dataset.id; render(); },
  'reference-remove': el => {
    const p = project();
    confirmRemoval('参考资料', async () => {
      await flush();
      const result = await api(urlFor(p.id), 'PATCH', { removeReferences: [el.dataset.id] });
      p.references = result.references;
      mergeBook(p, result);
      ui.referenceId = '';
      render();
      notify('已移除参考资料');
    });
  },
  'memory-save': async button => {
    const p = project();
    const chapterId = chapter(p).id;
    button.disabled = true;
    try {
      await flush();
      const result = await api(urlFor(p.id, '/memories'), 'POST', { chapterId });
      mergeBook(p, result);
      if (project()?.id !== p.id || ui.view !== 'memories') return;
      updateMemoryContent();
      notify('已保存当前记忆');
      await refreshMemories();
    } finally {
      button.disabled = false;
    }
  },
  'memory-tab': el => setMemoryTab(el.dataset.id),
  'memory-filter': el => {
    ui.memoryFilter = el.dataset.id;
    updateMemoryContent();
  },
  'memory-retry': async el => {
    const p = project();
    el.disabled = true;
    try {
      const result = await api(urlFor(p.id, `/memories/${el.dataset.id}/retry-${el.dataset.kind}`), 'POST', {});
      mergeBook(p, result);
      if (project()?.id === p.id && ui.view === 'memories') updateMemoryContent();
    } finally {
      el.disabled = false;
    }
  },
  'plot-source': async el => {
    const book = project();
    await loadConversation(`${book.id}/${el.dataset.id}`).catch(() => {});
    if (book.id !== project()?.id) return;
    await actions.chapter(el);
    if (chapter()?.id !== el.dataset.id || ui.view !== 'write') return;
    const area = document.getElementById('chapter-text');
    const offset = Number(el.dataset.offset);
    area?.focus();
    area?.setSelectionRange(offset, offset + Number(el.dataset.length));
  },
  'memory-select': async el => {
    const { id } = el.dataset;
    const p = project();
    ui.memoryId = id;
    ui.memoryDetail = null;
    setMemoryTab('history');
    const detail = await api(urlFor(p.id, '/memories/' + id));
    if (ui.memoryId === id && project()?.id === p.id && ui.view === 'memories') {
      ui.memoryDetail = detail;
      updateMemoryContent();
    }
  },
};

document.addEventListener('click', event => {
  const button = event.target.closest('[data-act]');
  if (!button || !actions[button.dataset.act]) return;
  Promise.resolve().then(() => actions[button.dataset.act](button)).catch(error => notify(error.message, true));
});

document.addEventListener('pointerdown', event => {
  const picker = app.querySelector('.project-picker[open]');
  if (picker && !picker.contains(event.target)) picker.open = false;
});

document.addEventListener('focusout', event => {
  const picker = event.target.closest('.project-picker[open]');
  if (picker && event.relatedTarget && !picker.contains(event.relatedTarget)) picker.open = false;
});

function showFormError(form, message) {
  const feedback = form.querySelector('[data-form-error], #provider-status');
  if (!feedback) {
    notify(message, true);
    return;
  }
  feedback.hidden = false;
  feedback.dataset.error = 'true';
  feedback.textContent = message;
}

document.addEventListener('invalid', event => {
  const field = event.target;
  const form = field.form;
  if (!form) return;
  event.preventDefault();
  if (form.querySelector(':is(input, select, textarea):invalid') !== field) return;
  const issue = field.validity;
  let message = '请检查输入内容。';
  if (issue.valueMissing) message = '请填写必填项。';
  else if (issue.typeMismatch && field.type === 'url') message = '请输入包含 https:// 或 http:// 的完整地址。';
  else if (issue.rangeUnderflow || issue.rangeOverflow) message = `请输入 ${field.min} 到 ${field.max} 之间的数值。`;
  showFormError(form, message);
  field.focus();
}, true);

dialog.addEventListener('cancel', event => {
  if (dialog.querySelector('form[aria-busy="true"]')) event.preventDefault();
});

document.addEventListener('submit', event => {
  const form = event.target;
  const formId = form.getAttribute('id');
  if (!['assistant-form', 'provider-form', 'memory-form', 'modal-form'].includes(formId)) return;
  event.preventDefault();
  const data = new FormData(form);
  const handler = {
    'assistant-form': generate,
    'provider-form': providerForm,
    'memory-form': async () => {
      const memorySettings = {
        chapterEnabled: data.has('chapterEnabled'), weeklyEnabled: data.has('weeklyEnabled'), volumeEnabled: data.has('volumeEnabled'),
        intervalDays: Number(data.get('intervalDays')), characterThreshold: Number(data.get('characterThreshold')),
      };
      await patchBook(project(), { memorySettings });
      render();
      notify('已保存记忆规则');
    },
    'modal-form': async () => {
      if (form.getAttribute('aria-busy') === 'true') return;
      const controls = form.querySelectorAll('button[type="submit"], [data-act^="dialog-"]');
      controls.forEach(button => { button.disabled = true; });
      form.setAttribute('aria-busy', 'true');
      try {
        const focus = await dialogAction(Object.fromEntries(data), data);
        if (focus !== false) dialog.close();
        if (focus instanceof HTMLElement) focus.focus({ preventScroll: true });
      } catch (error) {
        showFormError(form, error.message);
      } finally {
        controls.forEach(button => { button.disabled = false; });
        form.removeAttribute('aria-busy');
      }
    },
  }[formId];
  Promise.resolve().then(() => handler()).catch(error => notify(error.message, true));
});

document.addEventListener('input', event => {
  const el = event.target;
  const feedback = el.form?.querySelector('[data-form-error], #provider-status[data-error="true"]');
  if (feedback) {
    feedback.textContent = '';
    delete feedback.dataset.error;
    if (feedback.hasAttribute('data-form-error')) feedback.hidden = true;
  }
  const c = chapter();
  if (el.id === 'chapter-title' || el.id === 'chapter-text') {
    const key = el.id === 'chapter-title' ? 'title' : 'text';
    c[key] = el.value;
    if (key === 'text') {
      document.getElementById('chapter-count').textContent = countWords(c.text).toLocaleString('zh-CN');
      fitManuscript();
    } else {
      const current = app.querySelector('.chapter-row.is-active');
      const title = c.title.trim() || '未命名章节';
      current.querySelector('.chapter-link span:last-child').textContent = title;
      current.querySelector('.chapter-link').title = title;
      current.querySelector('.chapter-delete').setAttribute('aria-label', `删除章节「${title}」`);
    }
    stage({ chapter: c });
  }
  if (el.id === 'assistant-prompt') ui.drafts.set(threadKey(), el.value);
  if (el.id === 'planning') {
    project().planning = el.value;
    stage({ planning: el.value });
  }
  if (el.id === 'outline-search') {
    const { selectionStart, selectionEnd } = el;
    ui.outlineFilter = el.value;
    render();
    const replacement = document.getElementById('outline-search');
    replacement?.focus();
    replacement?.setSelectionRange(selectionStart, selectionEnd);
  }
});

document.addEventListener('change', event => {
  const el = event.target;
  const run = async () => {
    if (el.id === 'model-select') {
      await chooseProvider(el.value);
    } else if (el.id === 'assistant-mode') {
      ui.mode = el.value;
    } else if (el.id === 'reading-deep') {
      localWrite(storageKey('reading-depth'), el.checked ? 'deep' : 'standard');
    } else if (['memory-extraction-toggle', 'memory-plot-toggle'].includes(el.id)) {
      const p = project();
      const setting = el.id === 'memory-plot-toggle' ? 'extractPlot' : 'extractCards';
      el.disabled = true;
      try {
        await patchBook(p, { memorySettings: { [setting]: el.checked } });
        if (project()?.id === p.id && ui.view === 'memories') updateMemoryContent();
      } finally {
        el.checked = p.memorySettings?.[setting] === true;
        el.disabled = false;
      }
    } else if (el.id === 'reference-files') {
      const files = Array.from(el.files || []);
      el.value = '';
      await uploadFiles(files);
    } else if (el.dataset.source) {
      const { source, sourceId } = el.dataset;
      const settings = { ...selection() };
      if (sourceId) {
        const implicit = contextItems(project(), chapter().id)[source].map(item => item.id);
        const list = new Set(settings[source] === true ? implicit : settings[source] || []);
        if (el.checked) list.add(sourceId);
        else list.delete(sourceId);
        settings[source] = [...list];
      } else settings[source] = el.checked;
      localWrite(storageKey('reading'), settings);
      render();
      app.querySelector(sourceId ? `input[data-source-id="${CSS.escape(sourceId)}"]` : `input[data-source="${source}"]:not([data-source-id])`)?.focus();
    }
  };
  run().catch(error => notify(error.message, true));
});

document.addEventListener('dragstart', event => {
  const card = event.target.closest('[data-drag-card]');
  const scene = event.target.closest('[data-drag-scene]');
  if (!card && !scene) return;
  drag = card ? { card: card.dataset.dragCard } : { scene: scene.dataset.dragScene };
  event.dataTransfer.effectAllowed = card ? 'copy' : 'move';
  event.dataTransfer.setData('text/plain', card?.dataset.dragCard || scene.dataset.dragScene);
});

function dragTarget(event, isFile) {
  if (isFile) {
    const target = event.target.closest?.('[data-drop]');
    return target?.closest('[data-drop-disabled], [aria-busy="true"]') ? null : target;
  }
  if (drag?.card) return event.target.closest?.('[data-drop-scene]');
  if (drag?.scene) return event.target.closest?.('[data-drop-scene], [data-drop-act]');
  return null;
}

function clearDrop() {
  document.querySelectorAll('.drop-over').forEach(el => el.classList.remove('drop-over'));
}

document.addEventListener('dragover', event => {
  const isFile = event.dataTransfer.types.includes('Files');
  const target = dragTarget(event, isFile);
  if (isFile || target) event.preventDefault();
  if (!target) {
    if (isFile) event.dataTransfer.dropEffect = 'none';
    clearDrop();
    return;
  }
  event.dataTransfer.dropEffect = !isFile && drag?.scene ? 'move' : 'copy';
  if (!target.classList.contains('drop-over')) {
    clearDrop();
    target.classList.add('drop-over');
  }
});

document.addEventListener('dragleave', event => {
  const target = event.target.closest?.('.drop-over');
  if (target && !target.contains(event.relatedTarget)) target.classList.remove('drop-over');
});

document.addEventListener('dragend', () => { drag = null; clearDrop(); });

async function importDroppedFiles(target, files) {
  if (!files.length) return;
  if (target.dataset.drop === 'references') return uploadFiles(files);
  if (target.dataset.drop === 'chat') return addChatAttachments(() => files);
  if (files.length !== 1) throw new Error('请一次拖入一个文件。');
  if (target.dataset.drop === 'article') return articleDrops.get(target)?.(files[0]);
  const button = target.querySelector('[data-act="agent-decision"]:not([data-decline])');
  if (button) return answerAgentRequest(button, files[0]);
}

document.addEventListener('drop', event => {
  const isFile = event.dataTransfer.types.includes('Files');
  const target = dragTarget(event, isFile);
  if (isFile || target) event.preventDefault();
  const payload = drag;
  drag = null;
  clearDrop();
  if (!target) return;
  let operation;
  if (isFile) operation = importDroppedFiles(target, Array.from(event.dataTransfer.files));
  else if (payload?.card) {
    const scene = project().scenes.find(item => item.id === target.dataset.dropScene);
    if (scene) operation = linkCard(payload.card, scene);
  } else if (payload?.scene) {
    operation = relocateScene(payload.scene, target.dataset.dropScene, Number(target.dataset.dropAct));
  }
  operation?.catch(error => notify(error.message, true));
});

window.addEventListener('resize', fitManuscript);
window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));
document.addEventListener('keydown', event => {
  const picker = event.target.closest('.project-picker');
  if (picker && event.key === 'Escape' && picker.open) {
    event.preventDefault();
    picker.open = false;
    picker.querySelector('.project-selector').focus();
    return;
  }
  if (picker && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    picker.open = true;
    const options = [...picker.querySelectorAll('.project-option')];
    const current = options.indexOf(document.activeElement);
    const last = options.length - 1;
    const next = {
      ArrowDown: current >= last ? 0 : current + 1,
      ArrowUp: current <= 0 ? last : current - 1,
      Home: 0,
      End: last,
    }[event.key];
    options[next]?.focus();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    flush().then(() => notify('已保存')).catch(error => notify(error.message, true));
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && event.target.id === 'assistant-prompt') {
    event.preventDefault();
    generate().catch(error => notify(error.message, true));
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && pending.size) flush().catch(() => {});
});
window.addEventListener('beforeunload', event => {
  if (pending.size || saving) event.preventDefault();
});

try {
  state = await api('/api/state');
  resetProject();
  render();
  if (ui.view === 'memories') refreshMemories().catch(error => notify(error.message, true));
  setInterval(() => {
    if (ui.view !== 'memories' || document.visibilityState !== 'visible') return;
    const p = project();
    const waiting = p && memoryModel() && p.memories.some(entry =>
      (p.memorySettings.extractCards === true && entry.cardExtraction?.status === 'pending') ||
      (p.memorySettings.extractPlot === true && entry.plotExtraction?.status === 'pending'));
    if (waiting || Date.now() - memoryRefreshedAt >= 60_000) refreshMemories().catch(() => {});
  }, 2500);
} catch (error) {
  app.innerHTML = `<div class="startup"><p>${esc(error.message)}</p><a href="/">重新打开工作区</a></div>`;
}
