import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './lib/store.mjs';
import { makeChapter, makeId, makeProject } from './lib/projects.mjs';
import { buildContext, captureMemory, checkDue, conversationContext, isNextChapterIntent, recordChanges } from './lib/memory.mjs';
import { createMemoryCardWorker, memoryCards } from './lib/memory-cards.mjs';
import { chapterPlotPoints } from './lib/story-notes.mjs';
import { callProvider, normalizeProviderEndpoint, normalizeProviderModel, providerPresets } from './lib/providers.mjs';
import { extractReference } from './lib/imports.mjs';
import { extractArticle, MAX_ARTICLE_CHAPTERS, MAX_CHAPTER_CHARACTERS } from './lib/articles.mjs';
import { createWorkspaceTools } from './lib/workspace-tools.mjs';
import { createAgentRunner } from './lib/agent-runner.mjs';
import { chapterGenerationIntent } from './lib/ai-chapters.mjs';
import { createChatAttachments, withChatAttachments } from './lib/chat-attachments.mjs';
import { beginConversationTurn, conversationEntries, saveConversationTurn } from './lib/conversations.mjs';
import { txtExport } from './lib/txt-export.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const defaultDirectory = resolve(root, '.writer-data');

class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function body(req, limit = 8 * 1024 * 1024) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new UserError('请求需要 JSON 数据。');
  if (Number(req.headers['content-length']) > limit) throw new UserError('提交的内容太大。', 413);
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new UserError('提交的内容太大。', 413);
    parts.push(chunk);
  }
  let result;
  try { result = JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw new UserError('数据格式有误。'); }
  if (!result || Array.isArray(result) || typeof result !== 'object') throw new UserError('数据格式有误。');
  return result;
}

function requireProject(state, id) {
  const project = state.projects.find(item => item.id === id);
  if (!project) throw new UserError('找不到这个项目。', 404);
  return project;
}

function memoryHeader({ snapshot, cardExtraction, plotExtraction, ...header }) {
  for (const [field, extraction] of [['cardExtraction', cardExtraction], ['plotExtraction', plotExtraction]]) {
    if (!extraction) continue;
    const { cards, points, chapterIds, baseMemoryId, ...status } = extraction;
    header[field] = { ...status, count: (cards || points)?.length ?? 0 };
  }
  return header;
}

function projectView({ conversations, ...project }) {
  return { ...project, memories: project.memories.map(memoryHeader) };
}

function providerView(provider) {
  const { secret, ...config } = provider;
  let destination;
  try { destination = normalizeProviderEndpoint(config.endpoint, config.protocol); }
  catch { destination = {}; }
  const model = destination.endpoint ? normalizeProviderModel(config.model, destination.endpoint) : config.model;
  return { ...config, ...destination, model, hasKey: Boolean(secret) };
}

function brief(value, length, fallback = '') {
  return typeof value === 'string' ? value.slice(0, length) : fallback;
}

const types = new Set(['character', 'prop', 'location', 'organization']);
const lists = {
  chapters: (x) => ({ id: x.id, title: brief(x.title, 140, '未命名章节'), text: brief(x.text, MAX_CHAPTER_CHARACTERS) }),
  cards: (x) => ({
    id: x.id, title: brief(x.title, 140, '未命名设定'), type: types.has(x.type) ? x.type : 'character',
    description: brief(x.description, 80_000),
  }),
  scenes: (x) => ({
    id: x.id, title: brief(x.title, 140, '未命名场景'), description: brief(x.description, 80_000),
    act: [1, 2, 3].includes(x.act) ? x.act : 1, chapterId: brief(x.chapterId, 64),
    cardIds: Array.isArray(x.cardIds) ? [...new Set(x.cardIds.filter(id => typeof id === 'string'))].slice(0, 120) : [],
  }),
};

function removeChapter(project, id) {
  const index = project.chapters.findIndex(chapter => chapter.id === id);
  if (index === -1) throw new UserError('找不到这个章节，请重新打开项目。', 404);
  const chapters = project.chapters.filter(chapter => chapter.id !== id);
  if (!chapters.length) chapters.push(makeChapter('第一章'));
  if (!chapters.some(chapter => chapter.id === project.activeChapterId)) {
    project.activeChapterId = chapters[Math.min(index, chapters.length - 1)].id;
  }
  project.chapters = chapters;
}

function updateProject(project, input) {
  const before = { ...project };
  const startPlot = input.memorySettings?.extractPlot === true && project.memorySettings.extractPlot !== true;
  if (typeof input.title === 'string') {
    const title = brief(input.title.trim(), 120);
    if (!title) throw new UserError('请填写作品名称。');
    project.title = title;
  }
  if (typeof input.description === 'string') project.description = brief(input.description, 8_000);
  if (typeof input.planning === 'string') project.planning = brief(input.planning, 100_000);
  for (const [kind, normalize] of Object.entries(lists)) {
    if (!Array.isArray(input[kind])) continue;
    const items = input[kind];
    const ids = items.map(item => item?.id);
    if (items.length > 2_000 || ids.some(id => typeof id !== 'string' || id.length > 64) || new Set(ids).size !== ids.length) {
      throw new UserError('列表数据有误，请重新载入项目。');
    }
    if (kind === 'chapters' && !items.length) throw new UserError('项目需要保留至少一章。');
    project[kind] = items.map(normalize);
  }
  if (input.chapter) {
    if (!project.chapters.some(chapter => chapter.id === input.chapter.id)) throw new UserError('找不到这个章节。', 404);
    project.chapters = project.chapters.map(chapter => chapter.id === input.chapter.id ? lists.chapters(input.chapter) : chapter);
  }
  if (input.appendChapter) {
    const next = input.appendChapter;
    if (typeof next.id !== 'string' || !next.id || next.id.length > 64 ||
        project.chapters.length >= MAX_ARTICLE_CHAPTERS || project.chapters.some(chapter => chapter.id === next.id)) {
      throw new UserError('无法创建章节。请检查章节数量后重试。');
    }
    project.chapters = [...project.chapters, lists.chapters(next)];
  }
  const removingChapter = typeof input.removeChapterId === 'string';
  if (removingChapter) removeChapter(project, input.removeChapterId);
  if (removingChapter || Array.isArray(input.chapters) || Array.isArray(input.scenes)) {
    const chapterIds = new Set(project.chapters.map(chapter => chapter.id));
    project.scenes = project.scenes.map(scene =>
      scene.chapterId && !chapterIds.has(scene.chapterId) ? { ...scene, chapterId: '' } : scene);
    if (project.conversations && (removingChapter || Array.isArray(input.chapters))) {
      project.conversations = Object.fromEntries(Object.entries(project.conversations).filter(([id]) => chapterIds.has(id)));
    }
  }
  const referenceIds = input.removeReferences;
  if (Array.isArray(referenceIds)) {
    project.references = project.references.filter(item => !referenceIds.includes(item.id));
  }
  if (project.chapters.some(chapter => chapter.id === input.activeChapterId)) {
    project.activeChapterId = input.activeChapterId;
  }
  if (input.memorySettings && typeof input.memorySettings === 'object') {
    const settings = input.memorySettings;
    for (const name of ['chapterEnabled', 'weeklyEnabled', 'volumeEnabled', 'extractCards', 'extractPlot']) {
      if (typeof settings[name] === 'boolean') project.memorySettings[name] = settings[name];
    }
    for (const [name, low, high] of [['intervalDays', 1, 365], ['characterThreshold', 1, 1_000_000]]) {
      if (typeof settings[name] === 'number' && Number.isFinite(settings[name])) {
        project.memorySettings[name] = Math.max(low, Math.min(high, Math.floor(settings[name])));
      }
    }
  }
  project.updatedAt = new Date().toISOString();
  recordChanges(project, before);
  if (input.finishChapterId && project.memorySettings.chapterEnabled &&
      before.chapters.some(chapter => chapter.id === input.finishChapterId)) {
    const existingIds = new Set(before.chapters.map(chapter => chapter.id));
    const previousChapters = project.chapters.filter(chapter => existingIds.has(chapter.id));
    captureMemory({ ...project, chapters: previousChapters }, { reasons: ['chapter'], chapterId: input.finishChapterId });
  }
  if (startPlot && project.chapters.some(chapter => chapter.text.trim()) &&
      !project.memories.some(memory => memory.plotExtraction?.status === 'pending')) {
    captureMemory(project, { chapterId: project.activeChapterId });
  }
  checkDue(project);
  return projectView(project);
}

async function dueForAll(store) {
  await store.mutate(state => {
    let changed = false;
    for (const project of state.projects) {
      const previous = JSON.stringify(project.memoryState);
      if (checkDue(project) || previous !== JSON.stringify(project.memoryState)) changed = true;
    }
    return changed;
  });
}

function readProvider(input, existing, store) {
  const preset = providerPresets.find(item => item.id === input.id);
  if (!preset) throw new UserError('请选择模型供应商。');
  const inputEndpoint = brief(input.endpoint, 1_000, preset.endpoint).trim();
  const inputModel = brief(input.model, 160, preset.model);
  const inputProtocol = brief(input.protocol, 20, preset.protocol);
  const name = brief(input.name, 80).trim() || preset.name;
  let destination;
  try { destination = normalizeProviderEndpoint(inputEndpoint, inputProtocol); }
  catch (error) { throw new UserError(error.message); }
  const address = new URL(destination.endpoint);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname);
  const model = normalizeProviderModel(inputModel, address);
  if (!model) throw new UserError('请填写供应商提供的模型 ID。');
  const secret = input.removeKey ? '' : brief(input.key, 4096).trim();
  const storedOrigin = URL.canParse(existing?.endpoint) ? new URL(existing.endpoint).origin : '';
  const sameService = storedOrigin === address.origin;
  const key = secret || (!input.removeKey && sameService ? store.unseal(existing?.secret) : '');
  if (!key && !local) {
    throw new UserError(existing?.secret && !sameService ? '你更换了 API 服务地址，请填入新服务的 API 密钥。' : '请填写该供应商的 API 密钥。');
  }
  const previousWindow = sameService && existing?.model === model ? existing.contextTokens : undefined;
  const value = input.contextTokens;
  const contextTokens = value === undefined ? previousWindow : value === '' || value === null ? undefined : Number(value);
  if (contextTokens !== undefined && (!Number.isSafeInteger(contextTokens) || contextTokens < 4096 || contextTokens > 2_000_000)) {
    throw new UserError('上下文窗口请输入 4,096 到 2,000,000 之间的 token 数，或留空。');
  }
  return { id: preset.id, ...destination, model, name, key, ...(contextTokens ? { contextTokens } : {}) };
}

function saveProvider(state, { key, ...saved }, store) {
  const provider = { ...saved, secret: key ? store.seal(key) : '' };
  state.providers[saved.id] = provider;
  state.activeProviderId = saved.id;
  return provider;
}

function testProvider(config) {
  return callProvider(config, { system: '你正在测试模型连接。', prompt: '只回复四个字：连接成功。' });
}

function deleteProject(state, id) {
  requireProject(state, id);
  const removedIndex = state.projects.findIndex(project => project.id === id);
  state.projects.splice(removedIndex, 1);
  if (state.activeProjectId === id) {
    state.activeProjectId = state.projects[Math.min(removedIndex, state.projects.length - 1)]?.id ?? '';
  }
  return { activeProjectId: state.activeProjectId };
}

function importArticle(state, input) {
  if (!Array.isArray(input.chapters) || !input.chapters.length || input.chapters.length > MAX_ARTICLE_CHAPTERS) {
    throw new UserError('请检查要导入的章节。');
  }
  const title = brief(input.title, 120).trim();
  if (!input.projectId && !title) throw new UserError('请填写新项目的作品名称。');
  const chapters = input.chapters.map(chapter => {
    if (typeof chapter?.title !== 'string' || !chapter.title.trim() || typeof chapter.text !== 'string') {
      throw new UserError('章节标题或正文格式有误，请重新选择文件。');
    }
    if (chapter.text.length > MAX_CHAPTER_CHARACTERS) {
      throw new UserError('单章正文超过 150 万字符。请启用自动分章，或把文件分成多份导入。');
    }
    return lists.chapters({ ...chapter, id: makeId() });
  });
  const target = input.projectId ? requireProject(state, input.projectId) : makeProject(title);
  const before = { ...target };
  const first = target.chapters[0];
  const reuseBlank = target.chapters.length === 1 && first.title === '第一章' && first.text === '';
  const available = MAX_ARTICLE_CHAPTERS - target.chapters.length + Number(reuseBlank);
  if (chapters.length > available) throw new UserError('导入后项目将超过 2000 章。请选择新项目或分开导入。');
  const imported = reuseBlank ? [{ ...chapters[0], id: first.id }, ...chapters.slice(1)] : chapters;
  target.chapters = [...(reuseBlank ? [] : target.chapters), ...imported];
  target.activeChapterId = imported[0].id;
  target.updatedAt = new Date().toISOString();
  recordChanges(target, before);
  checkDue(target);
  if (!input.projectId) state.projects.push(target);
  state.activeProjectId = target.id;
  return projectView(target);
}

function addReference(project, imported) {
  const before = { ...project, references: [...project.references] };
  const reference = { ...imported, id: makeId(), addedAt: new Date().toISOString() };
  project.references.push(reference);
  project.updatedAt = new Date().toISOString();
  recordChanges(project, before);
  checkDue(project);
  return reference;
}

function retryExtraction(project, id, kind = 'cards') {
  const plot = kind === 'plot';
  if (project.memorySettings?.[plot ? 'extractPlot' : 'extractCards'] !== true) throw new UserError('请先在记忆页开启对应的自动提取。');
  const memory = project.memories.find(entry => entry.id === id);
  const status = memory?.[plot ? 'plotExtraction' : 'cardExtraction'];
  if (!status) throw new UserError('找不到这次提取记录。', 404);
  if (status.status === 'failed') {
    status.status = 'pending';
    delete status.error;
  }
}

function chatInput(input, chatFiles) {
  let attachments;
  try { attachments = chatFiles.get(input.attachmentIds, input.recentAttachmentIds); }
  catch (error) { throw new UserError(error.message); }
  const prompt = brief(input.prompt, 16_000).trim();
  if (!prompt && !attachments.some(file => file.attached)) throw new UserError('请输入消息或添加附件。');
  return { prompt: prompt || '请阅读这条消息附带的文件，并简要概括内容。', attachments };
}

async function api(req, res, pathname, store, cardWorker, agent, chatFiles) {
  const method = req.method;
  if (method === 'GET' && pathname === '/api/state') {
    await dueForAll(store);
    const view = await store.read(({ workspaceConversation, ...state }) => ({
      ...state,
      projects: state.projects.map(projectView),
      providers: Object.fromEntries(Object.entries(state.providers).map(([id, item]) => [id, providerView(item)])),
      presets: providerPresets,
    }));
    send(res, 200, view);
    return;
  }
  if (method === 'POST' && pathname === '/api/projects') {
    const input = await body(req);
    const title = brief(input.title, 120).trim();
    if (!title) throw new UserError('请填写作品名称。');
    const project = await store.mutate(state => {
      const next = makeProject(title, brief(input.description, 8000));
      state.projects.push(next);
      state.activeProjectId = next.id;
      return projectView(next);
    });
    send(res, 201, project);
    return;
  }
  if (method === 'POST' && pathname === '/api/agent/attachments') {
    const input = await body(req, 36 * 1024 * 1024);
    if (typeof input.name !== 'string' || typeof input.data !== 'string') throw new UserError('请选择要添加的文件。');
    let file;
    try { file = await chatFiles.add(brief(input.name, 255), Buffer.from(input.data, 'base64')); }
    catch (error) { throw new UserError(error.message); }
    send(res, 201, file);
    return;
  }
  if (method === 'GET' && pathname === '/api/agent/conversation') {
    send(res, 200, { entries: await store.read(state => conversationEntries(state, '')) });
    return;
  }
  if (method === 'POST' && pathname === '/api/agent/generate') {
    const input = await body(req);
    const { prompt, attachments } = chatInput(input, chatFiles);
    const provider = await store.read(state => {
      const id = input.providerId || state.activeProviderId;
      return Object.hasOwn(state.providers, id) ? state.providers[id] : null;
    });
    if (!provider) throw new UserError('请先在 API 设置中连接一个模型。', 409);
    const conversation = await beginConversationTurn(store, { projectId: '', text: brief(input.prompt, 16_000).trim(), attachments });
    const recent = conversationContext(conversation.recent);
    const context = { system: '你是 Agent Writer 的中文小说创作助手。当前还没有选中的作品。',
      prompt: recent ? `${recent}\n\n# 本次要求\n${prompt}` : prompt, report: { sections: [] } };
    const response = await agent.start({ provider: { ...provider, key: store.unseal(provider.secret) },
      context: withChatAttachments(context, attachments), attachments, conversation,
      generation: chapterGenerationIntent(prompt, input.mode), projectId: '', originId: 'workspace' });
    if (response.error && !response.trace.length) throw new UserError(response.error, 502);
    send(res, 200, response);
    return;
  }
  if (method === 'POST' && pathname === '/api/articles/preview') {
    const input = await body(req, 36 * 1024 * 1024);
    if (typeof input.name !== 'string' || typeof input.data !== 'string') throw new UserError('请选择要导入的文章文件。');
    let preview;
    try { preview = await extractArticle(input.name, Buffer.from(input.data, 'base64')); }
    catch (error) { throw new UserError(error.message); }
    send(res, 200, preview);
    return;
  }
  if (method === 'POST' && pathname === '/api/articles/import') {
    const input = await body(req, 16 * 1024 * 1024);
    const result = await store.mutate(state => importArticle(state, input));
    send(res, 201, result);
    return;
  }
  if (method === 'POST' && ['/api/providers/save', '/api/providers/test', '/api/providers/select'].includes(pathname)) {
    const input = await body(req);
    if (pathname.endsWith('/select')) {
      await store.mutate(state => {
        if (!Object.hasOwn(state.providers, input.id)) throw new UserError('请先保存此模型连接。');
        state.activeProviderId = input.id;
      });
      send(res, 200, { id: input.id });
      return;
    }
    const state = await store.read();
    const config = readProvider(input, state.providers[input.id], store);
    if (pathname.endsWith('/test')) {
      try {
        await testProvider(config);
      } catch (error) {
        throw new UserError(error.message, 502);
      }
      send(res, 200, { ok: true, endpoint: config.endpoint, protocol: config.protocol });
      return;
    }
    const provider = await store.mutate(next => providerView(saveProvider(next, config, store)));
    send(res, 200, provider);
    return;
  }
  const match = /^\/api\/projects\/([\w-]+)(?:\/(.+))?$/.exec(pathname);
  if (!match) throw new UserError('找不到该操作。', 404);
  const [, id, action] = match;
  if (method === 'GET' && action?.startsWith('conversation/')) {
    let chapterId;
    try { chapterId = decodeURIComponent(action.slice('conversation/'.length)); }
    catch { throw new UserError('章节编号无效。'); }
    const entries = await store.read(state => {
      const target = requireProject(state, id);
      if (!target.chapters.some(chapter => chapter.id === chapterId)) throw new UserError('找不到这个章节。', 404);
      return conversationEntries(state, id, chapterId);
    });
    send(res, 200, { entries });
    return;
  }
  if (method === 'POST' && action === 'export-txt') {
    const input = await body(req);
    const exported = await store.read(state => {
      const project = requireProject(state, id);
      try { return txtExport(project, input.chapterIds); }
      catch (error) { throw new UserError(error.message); }
    });
    send(res, 200, exported);
    return;
  }
  if (method === 'POST' && action === 'agent/continue') {
    const input = await body(req, 36 * 1024 * 1024);
    const response = await agent.resume(id, input);
    if (!response) throw new UserError('这项确认已过期或已经处理，请重新发起操作。', 409);
    send(res, 200, response);
    return;
  }
  if (method === 'DELETE' && !action) {
    const result = await store.mutate(state => deleteProject(state, id));
    send(res, 200, result);
    return;
  }
  if (method === 'PATCH' && !action) {
    const input = await body(req);
    const response = await store.mutate(state => updateProject(requireProject(state, id), input));
    send(res, 200, response);
    return;
  }
  if (method === 'POST' && action === 'select') {
    await store.mutate(state => {
      requireProject(state, id);
      state.activeProjectId = id;
    });
    send(res, 200, { id });
    return;
  }
  if (method === 'POST' && action === 'references') {
    const input = await body(req, 36 * 1024 * 1024);
    const name = basename(brief(input.name, 255).replaceAll('\\', '/'));
    if (!name || typeof input.data !== 'string') throw new UserError('请选择要导入的文件。');
    let imported;
    try { imported = await extractReference(name, Buffer.from(input.data, 'base64')); }
    catch (error) { throw new UserError(error.message); }
    const project = await store.mutate(state => {
      const target = requireProject(state, id);
      addReference(target, imported);
      return projectView(target);
    });
    send(res, 201, project);
    return;
  }
  const retryRoute = /^memories\/([\w-]+)\/retry-(cards|plot)$/.exec(action ?? '');
  if (method === 'POST' && retryRoute) {
    const result = await store.mutate(state => {
      const project = requireProject(state, id);
      retryExtraction(project, retryRoute[1], retryRoute[2]);
      return projectView(project);
    });
    send(res, 200, result);
    return;
  }
  if (method === 'GET' && action?.startsWith('memories/')) {
    const project = requireProject(await store.read(), id);
    const memory = project.memories.find(item => item.id === action.slice('memories/'.length));
    if (!memory) throw new UserError('找不到这份记忆。', 404);
    send(res, 200, memory);
    return;
  }
  if (method === 'GET' && action === 'memories') {
    const result = await store.read(state => {
      const project = requireProject(state, id);
      const points = chapterPlotPoints(project);
      return { memories: project.memories.map(memoryHeader), memoryState: project.memoryState, cards: memoryCards(project),
        points: project.chapters.flatMap(chapter => points.get(chapter.id) ?? []) };
    });
    send(res, 200, result);
    return;
  }
  if (method === 'POST' && action === 'memories') {
    const input = await body(req);
    const project = await store.mutate(state => {
      const target = requireProject(state, id);
      captureMemory(target, { reasons: ['manual'], chapterId: input.chapterId });
      return projectView(target);
    });
    send(res, 200, project);
    return;
  }
  if (method === 'POST' && action === 'generate') {
    const input = await body(req);
    const { prompt, attachments } = chatInput(input, chatFiles);
    const project = await store.mutate(state => {
      const target = requireProject(state, id);
      checkDue(target);
      if (target.memorySettings.chapterEnabled && isNextChapterIntent(prompt)) {
        captureMemory(target, { reasons: ['chapter'], chapterId: input.chapterId });
      }
      const { conversations, ...writingContext } = target;
      return writingContext;
    });
    cardWorker.wake();
    const provider = await store.read(state => {
      const chosen = input.providerId || state.activeProviderId;
      return Object.hasOwn(state.providers, chosen) ? state.providers[chosen] : null;
    });
    if (!provider) throw new UserError('请先在 API 设置中连接一个模型。', 409);
    const current = project.chapters.find(chapter => chapter.id === (input.chapterId ?? project.activeChapterId)) ?? project.chapters.at(-1);
    const conversation = await beginConversationTurn(store, { projectId: id, chapterId: current.id,
      text: brief(input.prompt, 16_000).trim(), attachments });
    if (!conversation) throw new UserError('找不到这个章节。', 404);
    const context = buildContext(project, {
      chapterId: current.id, selected: input.selected, prompt, mode: input.mode,
      conversation: conversation.recent.length ? conversation.recent : input.conversation,
      earlierConversation: conversation.earlier, depth: input.depth, contextTokens: provider.contextTokens,
      attachmentCharacters: Math.min(12_000, attachments.reduce((size, file) => size + file.characters, 0)),
    });
    const response = await agent.start({
      provider: { ...provider, key: store.unseal(provider.secret) }, context: withChatAttachments(context, attachments), attachments,
      generation: chapterGenerationIntent(prompt, input.mode), projectId: id, chapterId: context.report.chapterId, conversation,
    });
    if (response.error && !response.trace.length) throw new UserError(response.error, 502);
    const memories = await store.read(state => state.projects.find(project => project.id === id)?.memories.map(memoryHeader) ?? []);
    send(res, 200, { ...response, memories });
    return;
  }
  throw new UserError('找不到该操作。', 404);
}

const staticFiles = new Set(['index.html', 'style.css', 'app.js', 'views.js', 'views.css', 'icons.js', 'workspace.js', 'outline.js', 'outline.css']);
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };
async function respond(req, res, { origin, port, token, store, cardWorker, agent, chatFiles }) {
  res.setHeader('X-Agent-Writer', '1');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  try {
    const host = req.headers.host;
    const localHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!localHosts.includes(host) || (req.headers.origin && req.headers.origin !== `http://${host}`) ||
        (token && req.headers['x-agent-writer-token'] !== token)) {
      throw new UserError('请从本机地址打开 Agent Writer。', 403);
    }
    const { pathname } = new URL(req.url, origin);
    if (pathname.startsWith('/api/')) {
      await api(req, res, pathname, store, cardWorker, agent, chatFiles);
      if (req.method !== 'GET' || pathname === '/api/state') cardWorker.wake();
      return;
    }
    if (pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    const file = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!['GET', 'HEAD'].includes(req.method) || !staticFiles.has(file)) throw new UserError('找不到这个页面。', 404);
    const data = await readFile(resolve(root, 'public', file));
    res.writeHead(200, {
      'Content-Type': `${mime[extname(file)]}; charset=utf-8`,
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch (error) {
    if (error instanceof UserError) send(res, error.status, { error: error.message });
    else {
      console.error(error.name, error.code || 'internal');
      send(res, 500, { error: '这个操作暂时未完成，请重试。' });
    }
  }
}

export async function startWriterServer({ port = 4317, directory = defaultDirectory, token } = {}) {
  const store = await openStore(resolve(directory));
  const chatFiles = createChatAttachments();
  const cardWorker = createMemoryCardWorker(store);
  const agent = createAgentRunner(createWorkspaceTools({ store, requireProject, updateProject, deleteProject,
    importArticle, addReference, retryExtraction, readProvider, saveProvider, testProvider, providerView, providerPresets }),
  cardWorker.wake, (turn, response, run) => saveConversationTurn(store, turn, response, run));
  const bind = '127.0.0.1';
  const server = createServer((req, res) => {
    const actualPort = server.address().port;
    void respond(req, res, { origin: `http://${bind}:${actualPort}`, port: actualPort, token, store, cardWorker, agent, chatFiles });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, bind, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const origin = `http://${bind}:${server.address().port}`;
  const check = () => dueForAll(store)
    .then(() => cardWorker.wake())
    .catch(error => console.error('Memory scheduler:', error.code || error.name));
  const scheduler = setInterval(() => { agent.prune(); void check(); }, 60_000);
  scheduler.unref();
  void check();
  return {
    origin,
    async close() {
      clearInterval(scheduler);
      await Promise.all([
        cardWorker.close(),
        new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
      ]);
    },
  };
}

function openBrowser(baseUrl) {
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', baseUrl] : [baseUrl];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  child.unref();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.AGENT_WRITER_PORT || 4317);
  const open = process.argv.includes('--open');
  try {
    const server = await startWriterServer({ port, directory: process.env.AGENT_WRITER_DATA_DIR || defaultDirectory });
    console.log(`Agent Writer · ${server.origin}`);
    if (open) openBrowser(server.origin);
  } catch (error) {
    const baseUrl = `http://127.0.0.1:${port}`;
    const existing = error.code === 'EADDRINUSE' && open
      ? await fetch(baseUrl, { method: 'HEAD', signal: AbortSignal.timeout(1200) }).catch(() => null)
      : null;
    if (existing?.headers.get('X-Agent-Writer') === '1') {
      openBrowser(baseUrl);
    } else {
      console.error('Agent Writer 启动失败：', error.code || error.name);
      process.exitCode = 1;
    }
  }
}
