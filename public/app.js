import { esc, icon } from './icons.js';
import { chapterNumber, contextItems, countWords, emptyWorkspace, sidebar, writer } from './workspace.js';
import { renderCards, renderOutline } from './outline.js';
import { renderMemories, renderProviders, renderReferences } from './views.js';

const app = document.getElementById('app');
const dialog = document.getElementById('dialog');
dialog.setAttribute('aria-labelledby', 'modal-title');
const toast = document.getElementById('toast');
const pages = { write: '写作台', outline: '故事大纲', cards: '设定卡片', references: '参考资料', memories: '记忆', providers: 'API 设置' };
const defaultSelection = { chapters: true, cards: true, scenes: true, planning: true };
const ui = {
  view: Object.hasOwn(pages, location.hash.slice(1)) ? location.hash.slice(1) : 'write',
  chapterId: '', referenceId: '', memoryId: '', memoryDetail: null,
  cardType: 'all', outlineFilter: '', providerTab: '', assistantTab: 'sources',
  expanded: new Set(), sourcesInfo: false, mobileNav: false, mobileAssistant: false,
  drafts: new Map(), entries: new Map(), generating: new Set(), mode: 'write', saved: '已保存',
};
let state;
let toastTimer;
let saveTimer;
let saveQueue = Promise.resolve();
let saving = 0;
let dialogAction;
let drag;
const pending = new Map();

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
const chapter = (book = project()) => book?.chapters.find(item => item.id === ui.chapterId) || book?.chapters[0];
const threadKey = () => `${project().id}/${chapter().id}`;
const urlFor = (id, path = '') => `/api/projects/${id}${path}`;
const storageKey = suffix => `agent-writer/${project().id}/${suffix}`;

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

function render({ keepScroll = true } = {}) {
  const previous = keepScroll ? app.querySelector('.manuscript-scroll')?.scrollTop || 0 : 0;
  const p = project();
  const c = chapter(p);
  const shell = sidebar({ state, project: p, chapter: c, view: ui.view, mobileNav: ui.mobileNav });
  let content;
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
      content = renderMemories({ project: p, memoryId: ui.memoryId, memoryDetail: ui.memoryDetail });
      break;
    case 'providers':
      content = renderProviders({ ...state, providerTab: ui.providerTab || state.activeProviderId || 'openai' });
      break;
    default:
      if (p) {
        const key = threadKey();
        content = writer({
          ...ui, project: p, chapter: c, state, tab: ui.assistantTab, selection: selection(),
          entries: ui.entries.get(key) || [], prompt: ui.drafts.get(key) || '',
          busy: ui.generating.has(key),
        });
      } else {
        content = emptyWorkspace();
      }
  }
  const mobileTitle = !p && ui.view === 'write' ? '工作区' : pages[ui.view];
  app.innerHTML = `<div class="shell">${shell}${ui.mobileNav ? '<button type="button" class="mobile-scrim" data-act="mobile-nav" aria-label="关闭导航"></button>' : ''}<main class="main-view" id="main-view">${p && ui.view === 'write' ? '' : `<header class="mobile-top"><button class="icon-btn" type="button" data-act="mobile-nav" aria-label="打开导航">${icon('menu')}</button><span>${mobileTitle}</span></header>`}${content}</main></div>`;
  app.querySelectorAll('input[data-mixed="true"]').forEach(el => { el.indeterminate = true; });
  const scroll = app.querySelector('.manuscript-scroll');
  if (scroll) scroll.scrollTop = previous;
  fitManuscript();
  const conversation = document.getElementById('assistant-scroll');
  if (ui.assistantTab === 'conversation' && conversation) conversation.scrollTop = conversation.scrollHeight;
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
  const result = await api(urlFor(current.id, '/memories'));
  const changed = current.memories[0]?.id !== result.memories[0]?.id;
  current.memories = result.memories;
  current.memoryState = result.memoryState;
  if (changed && ui.view === 'memories' && project()?.id === current.id &&
      !document.activeElement?.closest('#memory-form')) render();
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
  target.updatedAt = incoming.updatedAt;
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
  ui.chapterId = current ? localRead(storageKey('chapter'), current.activeChapterId || current.defaultChapterId || current.chapters[0].id) : '';
  if (!current && ui.view !== 'providers') ui.view = 'write';
  ui.referenceId = '';
  ui.memoryId = '';
  ui.memoryDetail = null;
  ui.outlineFilter = '';
  ui.assistantTab = 'sources';
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
  const filePicker = desktopPicker ?
    `<div class="article-file-control"><button class="btn secondary" type="button" aria-describedby="article-file-help">${icon('upload')}选择文件</button><span class="article-filename muted" aria-live="polite">未选择任何文件</span></div>` :
    '<input id="article-file" name="articleFile" type="file" accept=".txt,.text,.md,.markdown,.docx,.odt,.pdf,.epub,.html,.htm,.xhtml" aria-describedby="article-file-help">';
  const fileField = `<div class="field article-file">${desktopPicker ? '<span>文章文件</span>' : '<label for="article-file">文章文件</label>'}${filePicker}<small id="article-file-help" class="muted">TXT、Markdown、Word、ODT、EPUB、HTML 或文字版 PDF，最多 25 MB。</small></div>`;
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
  fileControl?.addEventListener('change', () => {
    const file = fileControl.files[0];
    if (!file) return;
    void loadPreview(async () => {
      if (file.size > 25 * 1024 * 1024) throw new Error('单个文章文件不能超过 25 MB。');
      return { preview: await api('/api/articles/preview', 'POST', { name: file.name, data: await fileData(file) }) };
    }, '正在读取并识别章节…');
  });
  pickButton?.addEventListener('click', async () => {
    if (preview && submit.disabled) return;
    pickButton.disabled = true;
    await loadPreview(desktopPicker, '正在选择并读取文章…');
    pickButton.disabled = false;
    if (form.isConnected && dialog.open) pickButton.focus();
  });
}

function deleteProjectDialog(id) {
  const book = state.projects.find(item => item.id === id);
  if (!book) return;
  showDialog('删除项目',
    `<p class="modal-note">确定删除「${esc(book.title)}」吗？正文、设定、参考资料和记忆会一起删除。此操作无法撤销。</p>`,
    '确认删除', async () => {
      await flush();
      const result = await api(urlFor(book.id), 'DELETE');
      state.projects = state.projects.filter(item => item.id !== book.id);
      state.activeProjectId = result.activeProjectId;
      for (const threads of [ui.drafts, ui.entries, ui.generating]) {
        for (const key of threads.keys()) {
          if (key.startsWith(book.id + '/')) threads.delete(key);
        }
      }
      try {
        localStorage.removeItem(`agent-writer/${book.id}/chapter`);
        localStorage.removeItem(`agent-writer/${book.id}/reading`);
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

async function uploadFiles(files) {
  if (!files.length) return;
  const target = project();
  await flush();
  let imported = 0;
  const errors = [];
  for (const [index, file] of Array.from(files).entries()) {
    notify(`正在读取 ${index + 1}/${files.length}：${file.name}`);
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error('文件超过 25 MB。');
      const incoming = await api(urlFor(target.id, '/references'), 'POST', { name: file.name, data: await fileData(file) });
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
  if (ui.generating.has(key)) return;
  const prompt = (ui.drafts.get(key) || '').trim();
  if (!prompt) {
    document.getElementById('assistant-prompt')?.focus();
    return;
  }
  const p = project();
  const c = chapter();
  const entries = ui.entries.get(key) || [];
  const request = {
    chapterId: c.id, selected: selection(), prompt, mode: ui.mode, providerId: state.activeProviderId,
    conversation: entries.slice(-6).filter(item => item.role !== 'error').map(({ role, text }) => ({ role, text })),
  };
  entries.push({ role: 'user', text: prompt });
  ui.entries.set(key, entries);
  ui.generating.add(key);
  ui.drafts.set(key, '');
  ui.assistantTab = 'conversation';
  render();
  try {
    await flush();
    const result = await api(urlFor(p.id, '/generate'), 'POST', request);
    entries.push({ id: crypto.randomUUID(), role: 'assistant', text: result.text, report: result.report });
    p.memories = result.memories;
  } catch (error) {
    entries.push({ role: 'error', text: error.message });
    if (state.projects.includes(p) && !ui.drafts.get(key)) ui.drafts.set(key, prompt);
  } finally {
    ui.generating.delete(key);
    if (project()?.id === p.id && chapter().id === c.id && ui.view === 'write') render();
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
  'project-delete': el => deleteProjectDialog(el.dataset.id),
  'chapter-add': chapterDialog,
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
  'memory-save': async () => {
    const p = project();
    const chapterId = chapter(p).id;
    await flush();
    const result = await api(urlFor(p.id, '/memories'), 'POST', { chapterId });
    const added = result.memories.length > p.memories.length;
    mergeBook(p, result);
    render();
    notify(added ? '已保存当前记忆' : '当前内容已经存入记忆');
  },
  'memory-select': async el => {
    const { id } = el.dataset;
    ui.memoryId = id;
    ui.memoryDetail = null;
    render();
    const p = project();
    const detail = await api(urlFor(p.id, '/memories/' + id));
    if (ui.memoryId === id && project()?.id === p.id && ui.view === 'memories') {
      ui.memoryDetail = detail;
      render();
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
      const submit = form.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        await dialogAction(Object.fromEntries(data), data);
        dialog.close();
      } catch (error) {
        showFormError(form, error.message);
      } finally {
        if (submit) submit.disabled = false;
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
      const current = app.querySelector('.chapter-link.is-active span:last-child');
      if (current) current.textContent = c.title.trim() || '未命名章节';
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

function dragTarget(event) {
  if (event.dataTransfer.types.includes('Files')) return event.target.closest('[data-drop="references"]');
  if (drag?.card) return event.target.closest('[data-drop-scene]');
  if (drag?.scene) return event.target.closest('[data-drop-scene], [data-drop-act]');
  return null;
}

function clearDrop() {
  app.querySelectorAll('.drop-over').forEach(el => el.classList.remove('drop-over'));
}

document.addEventListener('dragover', event => {
  const target = dragTarget(event);
  if (!target) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = drag?.scene ? 'move' : 'copy';
  if (!target.classList.contains('drop-over')) {
    clearDrop();
    target.classList.add('drop-over');
  }
});

document.addEventListener('dragleave', event => {
  const target = event.target.closest('.drop-over');
  if (target && !target.contains(event.relatedTarget)) target.classList.remove('drop-over');
});

document.addEventListener('dragend', () => { drag = null; clearDrop(); });

document.addEventListener('drop', event => {
  const target = dragTarget(event);
  if (!target) return;
  event.preventDefault();
  const payload = drag;
  drag = null;
  clearDrop();
  let operation;
  if (target.dataset.drop === 'references') operation = uploadFiles(event.dataTransfer.files);
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
  setInterval(() => {
    if (ui.view === 'memories' && document.visibilityState === 'visible') refreshMemories().catch(() => {});
  }, 60_000);
} catch (error) {
  app.innerHTML = `<div class="startup"><p>${esc(error.message)}</p><a href="/">重新打开工作区</a></div>`;
}
