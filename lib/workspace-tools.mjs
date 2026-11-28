import { createHash } from 'node:crypto';
import { extractArticle, MAX_CHAPTER_CHARACTERS } from './articles.mjs';
import { extractReference } from './imports.mjs';
import { captureMemory } from './memory.mjs';
import { memoryCards } from './memory-cards.mjs';
import { searchPassages, relevance } from './context-search.mjs';
import { chapterPlotPoints } from './story-notes.mjs';
import { makeChapter, makeId, makeProject } from './projects.mjs';

const categories = ['character', 'prop', 'location', 'organization'];
const views = ['write', 'outline', 'cards', 'references', 'memories', 'providers'];
const sourceTypes = ['chapters', 'cards', 'planning', 'scenes', 'memories', 'references'];
const string = (description, maxLength = 160) => ({ type: 'string', description, maxLength });
const option = (description, values) => ({ type: 'string', description, enum: values });
const number = (description, minimum, maximum) => ({ type: 'integer', description, minimum, maximum });
const bool = { type: 'boolean' };
const ids = { type: 'array', items: string('从列表中获得的 ID', 160), maxItems: 120 };
const id = string('从列表查到的 ID', 160);
const title = string('名称', 140);
const description = string('说明', 80_000);
const content = string('文本内容', 100_000);
const query = string('用于检索的人物、地点、道具、事件或可引用的原文关键词', 500);
const offset = number('起始位置。读取正文时为字符偏移，列表时为条目偏移', 0, 2_000_000);
const limit = number('分页长度。读取正文最多 6000 字，列表最多 40 项', 1, 6000);
const generatedChapters = { type: 'array', maxItems: 2000, items: {
  type: 'object', properties: { title, text: content }, required: ['title', 'text'], additionalProperties: false,
} };

function tool(name, description, actions, properties) {
  return { name, description, parameters: { type: 'object', properties: {
    action: option('要执行的操作', actions), ...properties,
  }, required: ['action'], additionalProperties: false } };
}

export const workspaceToolSchemas = [
  tool('projects', '列出工作区项目、读取当前项目基本信息、新建并打开项目、切换项目、重命名、更新简介、删除。切换项目后可以使用该项目的工具。', ['list','read','create','switch','update','delete'],
    { id, title, description, offset, limit }),
  tool('chapters', '列出章节、用 search 检索当前及更早章节的原文片段、分页读正文、切换当前章节、新建、重命名、写入或删除章节，或导出 TXT。search 返回可给 read 使用的章节 ID 和字符偏移。', ['list','search','read','select','create','update','delete','export_txt'],
    { id, title, query, text: content, mode: option('写入方式，缺省为追加', ['append','replace','clear']),
      after_id: id, chapter_ids: { ...ids, maxItems: 2000 }, offset, limit }),
  tool('setting_cards', '列出、读取或编辑作者维护的设定卡片。记忆生成的 AI 设定卡通过 memories 的 cards 操作查看。', ['list','read','create','update','delete'],
    { id, title, description, type: option('设定类型', categories), offset, limit }),
  tool('outline', '查看故事大纲、编辑总体创作规划；新建、编辑、移动、重排或删除场景，关联章节和设定卡片。关联列表可以用 card_ids 整体设置，或用 attach_card_id/unlink_card_id 修改单项。', ['list','read','read_plan','write_plan','create','update','move','delete'],
    { id, title, description, text: content, act: number('第几幕', 1, 3), chapter_id: string('关联章节 ID，空字符串解除关联', 160),
      card_ids: ids, attach_card_id: id, unlink_card_id: id, before_id: id, offset, limit }),
  tool('references', '列出、搜索或分页读参考资料、导入给出的文本、请求作者选择本机文件来导入、移除。search 返回相关原文和偏移。', ['list','search','read','add_text','file','delete'],
    { id, title, query, text: content, offset, limit }),
  tool('attachments', '列出对话附件或分页阅读原文。使用返回的 next_offset 继续读取；为 null 时已读到末尾。', ['list','read'],
    { id, offset, limit }),
  tool('articles', '预览、导入文章，或用 write_chapters 将你生成的多章正文自动分章写入。write_chapters 的 chapters 数组按顺序包含每章标题和完整正文。预览后可在本轮用 import_preview 导入。', ['preview_text','preview_file','import_preview','import_text','file','write_chapters'],
    { title, text: content, destination: option('导入目标，缺省追加当前项目', ['current','new']),
      split: option('分章方式，缺省自动', ['auto','single']), chapters: generatedChapters }),
  tool('memories', '列出、阅读、保存记忆，查看 AI 设定卡和剧情要点，修改自动记忆规则，重试提取。points 可通过 query 或 chapter_id 缩小结果。', ['list','read','save','cards','points','settings','configure','retry'],
    { id, chapter_id: id, query, offset, limit, type: option('AI 卡片类别', categories), chapter_enabled: bool, weekly_enabled: bool,
      volume_enabled: bool, extract_cards: bool, extract_plot: bool, extraction: option('重试的提取类别', ['cards','plot']),
      interval_days: number('定期存储天数', 1, 365), character_threshold: number('定量存储阈值', 1, 1_000_000) }),
  tool('models', '查看模型供应商，切换、测试或保存连接，打开官方主页或密钥页面。需要新密钥时由用户在本机输入。', ['list','select','test','configure','open_site'],
    { id, title, model: string('模型 ID'), endpoint: string('模型 API 地址', 1000), protocol: option('接口协议', ['chat','responses','messages']),
      site: option('官方主页或密钥页面', ['home','key']), remove_key: bool, context_tokens: number('模型公布的上下文窗口大小', 4096, 2_000_000) }),
  tool('workspace', '打开应用内页面、修改当前助手模式或重点阅读范围、切换深读、保存当前稿件、复制文字。', ['open','mode','reading','reading_depth','save','copy'],
    { view: option('页面', views), mode: option('写正文、理情节、查逻辑', ['write','plan','review']),
      source: option('阅读范围类型', sourceTypes), depth: option('标准或深读，下次发消息时生效', ['standard','deep']), all: bool, ids, text: content }),
];

const schemas = new Map(workspaceToolSchemas.map(schema => [schema.name, schema]));
const result = (message, data, changed = false) => ({ message, data, changed });
const fail = message => { throw new Error(message); };

function validate(value, schema, name) {
  if (schema.type === 'string' && (typeof value !== 'string' || value.length > (schema.maxLength ?? Infinity) ||
      (schema.enum && !schema.enum.includes(value)))) fail(`参数 ${name} 无效。`);
  if (schema.type === 'boolean' && typeof value !== 'boolean') fail(`参数 ${name} 必须为 true 或 false。`);
  if (schema.type === 'integer' && (!Number.isSafeInteger(value) || value < schema.minimum || value > schema.maximum)) fail(`参数 ${name} 超出范围。`);
  if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length > schema.maxItems) fail(`参数 ${name} 需要一个有效列表。`);
    for (const item of value) validate(item, schema.items, name);
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        schema.required.some(key => !Object.hasOwn(value, key))) fail(`参数 ${name} 需要包含标题和正文。`);
    for (const [key, property] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, key)) fail(`参数 ${name} 包含不支持的字段。`);
      validate(property, schema.properties[key], key);
    }
  }
}

function parseArgs(name, raw) {
  const schema = schemas.get(name)?.parameters;
  if (!schema) fail('没有这个应用工具。');
  let args;
  try { args = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { fail('工具参数需要合法的 JSON 对象。'); }
  if (!args || typeof args !== 'object' || Array.isArray(args)) fail('工具参数需要一个对象。');
  if (!Object.hasOwn(args, 'action')) fail('请提供 action。');
  for (const [key, value] of Object.entries(args)) {
    if (!Object.hasOwn(schema.properties, key)) fail(`参数 ${key} 不受支持。`);
    validate(value, schema.properties[key], key);
  }
  return args;
}

const need = (value, label) => typeof value === 'string' && value.trim() ? value.trim() : fail(`请提供${label}。`);
const find = (items, key, label) => items.find(item => item.id === key) || fail(`找不到${label}，请先查看列表。`);
const own = (object, key) => Object.hasOwn(object, key) ? object[key] : undefined;
const titled = ({ id, title }) => ({ id, title });
const cardSummary = ({ id, title, type }) => ({ id, title, type });

function page(items, args) {
  const start = args.offset ?? 0;
  const end = start + Math.min(args.limit ?? 30, 40);
  return { items: items.slice(start, end), total: items.length, next_offset: end < items.length ? end : null };
}

function excerpt(text, args) {
  const start = args.offset ?? 0;
  const end = start + Math.min(args.limit ?? 3500, 6000);
  return { text: text.slice(start, end), total: text.length, next_offset: end < text.length ? end : null };
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function permission(grant, summary, target, kind = 'confirm', extra = {}) {
  const proof = fingerprint(target);
  if (!grant) return { request: { kind, summary, danger: /^(?:永久删除|删除|移除|替换|清空)/.test(summary), ...extra }, proof };
  if (grant.proof !== proof) fail('目标在确认期间发生了变化，请重新核对后操作。');
  return null;
}

function fileBytes(file) {
  if (!file || typeof file.name !== 'string' || typeof file.data !== 'string' || file.data.length > 35_000_000) {
    fail('请选择 25 MB 以内的有效文件。');
  }
  return Buffer.from(file.data, 'base64');
}

/** The handlers use the same store and mutations as the application's buttons. */
export function createWorkspaceTools({ store, requireProject, updateProject, deleteProject, importArticle,
  addReference, retryExtraction, readProvider, saveProvider, testProvider, providerView, providerPresets }) {
  const read = (run, select) => store.read(state => select(requireProject(state, run.projectId), state));
  const change = (run, patch) => store.mutate(state => {
    const project = requireProject(state, run.projectId);
    return patch(project, input => updateProject(project, input), state);
  });
  const guarded = (run, grant, review, execute) => grant
    ? change(run, (project, update, state) => { review(project, grant); return execute(project, update, state); })
    : read(run, project => review(project));

  const selectedChapter = (project, run, args) => find(project.chapters, args.id || run.chapterId || project.activeChapterId, '章节');

  async function projects(args, run, grant) {
    const { action } = args;
    if (action === 'list') return store.read(state => result('已列出项目。', page(state.projects.map(titled), args)));
    if (action === 'read') return read(run, project => result('已读取项目。', {
      ...titled(project), description: project.description, chapter_count: project.chapters.length, active_chapter: project.activeChapterId,
    }));
    if (action === 'create') {
      const book = await store.mutate(state => {
        const next = makeProject(need(args.title, '项目名称').slice(0, 120), args.description?.slice(0, 8000));
        state.projects.push(next);
        state.activeProjectId = next.id;
        return { ...titled(next), chapter_id: next.activeChapterId };
      });
      run.projectId = book.id;
      run.chapterId = book.chapter_id;
      run.ui.projectId = book.id;
      return result(`已创建项目「${book.title}」。`, book, true);
    }
    if (action === 'switch') {
      const target = await store.read(state => requireProject(state, need(args.id, '项目 ID')));
      if (target.id !== run.projectId) {
        const pending = permission(grant, `切换到项目「${target.title}」，并允许当前对话读取该项目。`, [target.id, target.title]);
        if (pending) return pending;
        await store.mutate(state => { state.activeProjectId = requireProject(state, target.id).id; });
      }
      run.projectId = target.id;
      run.chapterId = target.activeChapterId || target.chapters[0].id;
      run.ui.projectId = target.id;
      return result(`已打开项目「${target.title}」。`, { id: target.id, chapter_id: run.chapterId }, true);
    }
    if (action === 'update') return change(run, (project, update) => {
      const next = update({ title: args.title, description: args.description });
      return result(`已更新项目「${next.title}」。`, titled(next), true);
    });
    const targetId = args.id || run.projectId;
    const review = (project, approval) => permission(approval,
      `永久删除项目「${project.title}」及其中的 ${project.chapters.length} 章正文、设定、资料、记忆和对话记录。`,
      [project.id, project.title, project.updatedAt, project.memories[0]?.id]);
    if (!grant) return store.read(state => review(requireProject(state, targetId)));
    const next = await store.mutate(state => {
      const project = requireProject(state, targetId);
      review(project, grant);
      return deleteProject(state, targetId);
    });
    if (targetId === run.projectId) {
      run.projectId = next.activeProjectId;
      run.chapterId = '';
      run.ui.projectId = next.activeProjectId;
    }
    return result('已删除项目。', { id: targetId }, true);
  }

  async function chapters(args, run, grant) {
    const { action } = args;
    if (action === 'search') return read(run, project => {
      const current = project.chapters.findIndex(chapter => chapter.id === (run.chapterId || project.activeChapterId));
      const eligible = project.chapters.slice(0, current + 1).reverse();
      const text = need(args.query, '搜索关键词');
      const items = searchPassages(eligible, text, Math.min(10, args.limit ?? 5));
      return result(`找到 ${items.length} 段相关前文。`, { items });
    });
    if (action === 'export_txt') return read(run, project => {
      const chapterIds = args.chapter_ids ?? (args.id ? [args.id] : undefined);
      if (chapterIds && !chapterIds.length) fail('请至少选择一个章节。');
      const chosen = chapterIds ? [...new Set(chapterIds)] : undefined;
      for (const chapterId of chosen ?? []) find(project.chapters, chapterId, '章节');
      const scope = chosen ? `${chosen.length} 个章节` : '全书';
      return permission(grant, `导出「${project.title}」的${scope}为 TXT。`, [project.id, chosen], 'export', {
        projectId: project.id, chapterIds: chosen,
      }) || result(`已导出 TXT（${scope}）。`);
    });
    if (action === 'list') return read(run, project => result('已列出章节。', page(project.chapters.map((item, index) =>
      ({ ...titled(item), number: index + 1, characters: item.text.length, current: item.id === run.chapterId })), args)));
    if (action === 'read') return read(run, project => {
      const chapter = selectedChapter(project, run, args);
      return result(`已读取「${chapter.title}」。`, { ...titled(chapter), ...excerpt(chapter.text, args) });
    });
    if (action === 'select' || action === 'create') {
      const next = await change(run, (project, update) => {
        const previous = project.chapters.find(item => item.id === run.chapterId) || project.chapters.find(item => item.id === project.activeChapterId);
        if (action === 'select') {
          const existing = selectedChapter(project, run, args);
          update({ activeChapterId: existing.id });
          return titled(existing);
        }
        const chapter = { ...makeChapter(args.title ? need(args.title, '章节名称') : `第 ${String(project.chapters.length + 1).padStart(2, '0')} 章`), text: args.text ?? '' };
        if (args.after_id) {
          const after = find(project.chapters, args.after_id, '插入位置');
          const at = project.chapters.indexOf(after) + 1;
          update({ chapters: [...project.chapters.slice(0, at), chapter, ...project.chapters.slice(at)], finishChapterId: previous?.id, activeChapterId: chapter.id });
        } else {
          update({ appendChapter: chapter, finishChapterId: previous?.id, activeChapterId: chapter.id });
        }
        return titled(chapter);
      });
      run.chapterId = next.id;
      run.ui.chapterId = next.id;
      run.ui.view = 'write';
      if (action === 'create' && args.text?.trim()) run.wroteChapters = true;
      return result(`${action === 'create' ? '已新建' : '已打开'}章节「${next.title}」。`, next, true);
    }
    function write(project, update) {
      const chapter = selectedChapter(project, run, args);
      const next = { ...chapter };
      if (args.title !== undefined) next.title = need(args.title, '章节名称');
      if (args.mode === 'clear') next.text = '';
      else if (args.text !== undefined) next.text = args.mode === 'replace' ? args.text :
        [chapter.text, args.text].filter(Boolean).join('\n\n');
      if (next.text.length > MAX_CHAPTER_CHARACTERS) fail('单章正文不能超过 150 万字符。');
      update({ chapter: next });
      if (args.text?.trim()) run.wroteChapters = true;
      return result(`已更新「${next.title}」。`, { ...titled(next), characters: next.text.length }, true);
    }
    if (action === 'update' && !['replace','clear'].includes(args.mode)) return change(run, write);
    function review(project, approval) {
      const chapter = selectedChapter(project, run, args);
      if (action === 'update' && !chapter.text && !approval) return null;
      const operation = action === 'delete' ? '删除' : args.mode === 'clear' ? '清空' : '替换';
      const subject = action === 'delete' ? '及其正文和对话记录' : '的正文';
      return permission(approval, `${operation}「${project.title}」中「${chapter.title}」${subject}，涉及 ${chapter.text.length} 字。`, chapter);
    }
    if (!grant && action === 'update') {
      return change(run, (project, update) => review(project) || write(project, update));
    }
    return guarded(run, grant, review, (project, update) => {
      if (action === 'update') return write(project, update);
      const chapter = selectedChapter(project, run, args);
      const next = update({ removeChapterId: chapter.id });
      if (run.chapterId === chapter.id) {
        run.chapterId = next.activeChapterId;
        run.ui.chapterId = next.activeChapterId;
      }
      return result(`已删除章节「${chapter.title}」。`, { id: chapter.id, active_chapter: next.activeChapterId }, true);
    });
  }

  async function settingCards(args, run, grant) {
    const { action } = args;
    if (action === 'list') return read(run, project => result('已列出作者设定。', page(project.cards
      .filter(card => !args.type || card.type === args.type).map(cardSummary), args)));
    if (action === 'read') return read(run, project => {
      const card = find(project.cards, args.id, '设定卡片');
      return result(`已读取设定「${card.title}」。`, { ...cardSummary(card), ...excerpt(card.description, args) });
    });
    if (action === 'delete') return guarded(run, grant, (project, approval) => {
      const card = find(project.cards, args.id, '设定卡片');
      return permission(approval, `删除「${project.title}」的设定卡「${card.title}」并解除大纲引用。`, card);
    }, (project, update) => {
      update({ cards: project.cards.filter(card => card.id !== args.id),
        scenes: project.scenes.map(scene => ({ ...scene, cardIds: scene.cardIds.filter(id => id !== args.id) })) });
      return result('已删除设定卡。', { id: args.id }, true);
    });
    return change(run, (project, update) => {
      const original = action === 'create' ? null : find(project.cards, args.id, '设定卡片');
      const card = { id: original?.id || makeId(), title: args.title === undefined && original ? original.title : need(args.title, '设定卡名称'),
        type: args.type || original?.type || 'character', description: args.description ?? original?.description ?? '' };
      update({ cards: original ? project.cards.map(item => item.id === card.id ? card : item) : [...project.cards, card] });
      return result(`已保存设定「${card.title}」。`, cardSummary(card), true);
    });
  }

  async function outline(args, run, grant) {
    const { action } = args;
    const sceneSummary = ({ id, title, act, chapterId, cardIds }) => ({ id, title, act, chapter_id: chapterId, card_ids: cardIds });
    if (action === 'list') return read(run, project => result('已列出大纲场景。', page(project.scenes.map(sceneSummary), args)));
    if (action === 'read') return read(run, project => {
      const scene = find(project.scenes, args.id, '场景');
      return result(`已读取场景「${scene.title}」。`, { ...sceneSummary(scene), ...excerpt(scene.description, args) });
    });
    if (action === 'read_plan') return read(run, project => result('已读取创作规划。', excerpt(project.planning, args)));
    if (action === 'write_plan') return change(run, (project, update) => {
      if (typeof args.text !== 'string') fail('请提供规划内容。');
      if (grant || (project.planning && project.planning !== args.text)) {
        const pending = permission(grant, `替换「${project.title}」现有的创作规划。`, project.planning);
        if (pending) return pending;
      }
      update({ planning: args.text });
      return result('已保存创作规划。', undefined, true);
    });
    if (action === 'delete') return guarded(run, grant, (project, approval) => {
      const scene = find(project.scenes, args.id, '场景');
      return permission(approval, `删除「${project.title}」的大纲场景「${scene.title}」。`, scene);
    }, (project, update) => {
      update({ scenes: project.scenes.filter(scene => scene.id !== args.id) });
      return result('已删除大纲场景。', { id: args.id }, true);
    });
    return change(run, (project, update) => {
      const original = action === 'create' ? null : find(project.scenes, args.id, '场景');
      const before = args.before_id ? find(project.scenes, args.before_id, '排序目标场景') : null;
      if (before && before.id === original?.id) fail('不能把场景移到自己前面。');
      const scene = { id: original?.id || makeId(), title: args.title === undefined && original ? original.title : need(args.title, '场景名称'),
        description: args.description ?? original?.description ?? '', act: before?.act || args.act || original?.act || 1,
        chapterId: args.chapter_id ?? original?.chapterId ?? '', cardIds: args.card_ids || original?.cardIds || [] };
      if (scene.chapterId) find(project.chapters, scene.chapterId, '关联章节');
      if (args.attach_card_id) scene.cardIds = [...new Set([...scene.cardIds, args.attach_card_id])];
      if (args.unlink_card_id) scene.cardIds = scene.cardIds.filter(id => id !== args.unlink_card_id);
      scene.cardIds.forEach(id => find(project.cards, id, '关联设定卡片'));
      let scenes = original ? project.scenes.map(item => item.id === scene.id ? scene : item) : [...project.scenes, scene];
      if (before || action === 'move') {
        scenes = scenes.filter(item => item.id !== scene.id);
        scenes.splice(before ? scenes.findIndex(item => item.id === before.id) : scenes.length, 0, scene);
      }
      update({ scenes });
      return result(`已保存场景「${scene.title}」。`, sceneSummary(scene), true);
    });
  }

  async function references(args, run, grant) {
    const { action } = args;
    if (action === 'search') return read(run, project => {
      const sources = project.references.map(file => ({ ...file, title: file.name }));
      const items = searchPassages(sources, need(args.query, '搜索关键词'), Math.min(10, args.limit ?? 5));
      return result(`找到 ${items.length} 段参考原文。`, { items });
    });
    if (action === 'list') return read(run, project => result('已列出参考资料。', page(project.references.map(({ id, name, format, text }) =>
      ({ id, title: name, format, characters: text.length })), args)));
    if (action === 'read') return read(run, project => {
      const source = find(project.references, args.id, '参考资料');
      return result(`已读取「${source.name}」。`, { id: source.id, title: source.name, ...excerpt(source.text, args) });
    });
    if (action === 'delete') return guarded(run, grant, (project, approval) => {
      const source = find(project.references, args.id, '参考资料');
      return permission(approval, `移除「${project.title}」中的参考资料「${source.name}」。`, source);
    }, (project, update) => {
      update({ removeReferences: [args.id] });
      return result('已移除参考资料。', { id: args.id }, true);
    });
    let imported;
    if (action === 'file') {
      if (!grant) return permission(null, '请选择要导入的参考资料。', run.projectId, 'file', { purpose: 'reference' });
      if (grant.proof !== fingerprint(run.projectId)) fail('当前项目已变化。');
      imported = await extractReference(grant.file?.name, fileBytes(grant.file));
    } else {
      const name = need(args.title, '资料名称');
      imported = await extractReference(name.endsWith('.txt') ? name : name + '.txt', Buffer.from(need(args.text, '资料文字')));
    }
    return change(run, project => {
      const reference = addReference(project, imported);
      return result(`已导入参考资料「${reference.name}」。`, { id: reference.id, title: reference.name }, true);
    });
  }

  async function saveArticle(run, chapters, { title, destination } = {}) {
    const imported = await store.mutate(state => importArticle(state, {
      title, projectId: destination === 'new' || !run.projectId ? null : run.projectId, chapters,
    }));
    run.projectId = imported.id;
    run.chapterId = imported.activeChapterId;
    run.ui.projectId = imported.id;
    run.ui.chapterId = imported.activeChapterId;
    run.ui.view = 'write';
    run.wroteChapters = true;
    return imported;
  }

  async function writeChapters(run, chapters, options) {
    if (run.generation?.draftOnly) fail('作者要求只输出草稿，本轮不能自动写入。');
    const count = run.generation?.count;
    if (!Array.isArray(chapters) || chapters.length < 2 || (count > 1 && chapters.length !== count)) {
      fail(count > 1 ? `这次需要 ${count} 章完整正文，请按顺序一次提交。` : '请提交至少两章完整正文。');
    }
    if (chapters.some(chapter => !chapter.title?.trim() || !chapter.text?.trim())) fail('每章都需要标题和正文。');
    const imported = await saveArticle(run, chapters, { title: options?.title || '生成文章', destination: options?.destination });
    return result(`已自动分章写入「${imported.title}」，共 ${chapters.length} 章。`, {
      project_id: imported.id, chapters: chapters.length, first_chapter: imported.activeChapterId,
    }, true);
  }

  async function articles(args, run, grant) {
    if (args.action === 'write_chapters') return writeChapters(run, args.chapters, args);
    let preview;
    if (args.action === 'import_preview') {
      preview = run.articlePreview || fail('请先预览要导入的文章。');
    } else if (args.action === 'file' || args.action === 'preview_file') {
      if (!grant) return permission(null, args.action === 'file' ? '请选择要导入的文章文件。' : '请选择要预览的文章文件。',
        run.projectId, 'file', { purpose: 'article' });
      if (grant.proof !== fingerprint(run.projectId)) fail('当前项目已变化。');
      preview = await extractArticle(grant.file?.name, fileBytes(grant.file));
    } else {
      const name = need(args.title, '文章名称');
      const filename = /\.(?:md|markdown|txt)$/i.test(name) ? name : name + '.txt';
      preview = await extractArticle(filename, Buffer.from(need(args.text, '文章正文')));
    }
    const chapters = args.split === 'single' ? [{ title: preview.title, text: preview.text }] : preview.chapters;
    if (args.action.startsWith('preview')) {
      run.articlePreview = preview;
      return result(`已预览「${preview.title}」，共 ${chapters.length} 章。`, {
        title: preview.title, chapters: chapters.slice(0, 40).map(chapter => ({ title: chapter.title, characters: chapter.text.length })),
        total: chapters.length, recognized: preview.recognized,
      });
    }
    const imported = await saveArticle(run, chapters, { title: args.title || preview.title, destination: args.destination });
    delete run.articlePreview;
    return result(`已导入 ${chapters.length} 章到「${imported.title}」。`, { project_id: imported.id, chapters: chapters.length }, true);
  }

  async function memories(args, run, grant) {
    const { action } = args;
    if (action === 'list') return read(run, project => result('已列出已保存的记忆。', page(project.memories.map(memory =>
      ({ ...titled(memory), date: memory.createdAt, reasons: memory.reasons, extraction: memory.cardExtraction?.status })), args)));
    if (action === 'read') return read(run, project => {
      const memory = find(project.memories, args.id, '记忆快照');
      const archive = memory.snapshot;
      const chapter = args.chapter_id ? find(archive.chapters, args.chapter_id, '快照章节') : null;
      const data = chapter ? { ...titled(chapter), ...excerpt(chapter.text, args) } : {
        ...titled(memory), summary: memory.summary, chapters: page(archive.chapters.map(titled), args),
        cards: archive.cards.slice(0, 12).map(cardSummary), planning: (archive.planning ?? '').slice(0, 900),
        scenes: archive.scenes.slice(0, 12).map(titled), references: archive.references.slice(0, 12).map(({ id, name }) => ({ id, title: name })),
      };
      return result(`已读取「${memory.title}」。`, data);
    });
    if (action === 'cards') return read(run, project => result('已列出 AI 设定卡。作者设定优先。', page(memoryCards(project)
      .filter(card => !args.type || card.type === args.type).map(card => ({ ...cardSummary(card),
        notes: card.notes.slice(0, 2).map(note => ({ description: note.description, chapter: note.chapterTitle, memory_id: note.memoryId })),
      })), args)));
    if (action === 'points') return read(run, project => {
      const index = project.chapters.findIndex(chapter => chapter.id === (run.chapterId || project.activeChapterId));
      const eligible = project.chapters.slice(0, index + 1);
      const groups = chapterPlotPoints(project);
      const score = relevance(args.query || '');
      const points = eligible.filter(chapter => !args.chapter_id || args.chapter_id === chapter.id)
        .flatMap(chapter => groups.get(chapter.id) ?? []).map(point => ({ ...point, score: score(point.text + ' ' + point.evidence) }));
      const matches = args.query ? points.filter(point => point.score > 0).sort((left, right) => right.score - left.score) : points;
      return result('已读取带原文依据的剧情要点。', page(matches, { ...args, limit: Math.min(args.limit ?? 8, 20) }));
    });
    if (action === 'settings') return read(run, project => result('已读取记忆设置。', project.memorySettings));
    if (action === 'save') return change(run, project => {
      if (args.chapter_id) find(project.chapters, args.chapter_id, '章节');
      const memory = captureMemory(project, { reasons: ['manual'], chapterId: args.chapter_id || run.chapterId });
      return result('已保存当前记忆。', titled(memory), true);
    });
    if (action === 'retry') return change(run, project => {
      retryExtraction(project, args.id, args.extraction);
      return result('已请求重新提取。', { id: args.id }, true);
    });
    const settings = { chapterEnabled: args.chapter_enabled, weeklyEnabled: args.weekly_enabled, volumeEnabled: args.volume_enabled,
      extractCards: args.extract_cards, extractPlot: args.extract_plot, intervalDays: args.interval_days, characterThreshold: args.character_threshold };
    return change(run, (project, update) => {
      if ((settings.extractCards === true && project.memorySettings.extractCards !== true) ||
          (settings.extractPlot === true && project.memorySettings.extractPlot !== true)) {
        const pending = permission(grant, `为「${project.title}」开启 AI 提取。提取时会把新增或改动的正文发给当前模型。`, [project.id, settings]);
        if (pending) return pending;
      }
      const next = update({ memorySettings: settings });
      return result('已更新记忆设置。', next.memorySettings, true);
    });
  }

  async function models(args, run, grant) {
    const { action } = args;
    if (action === 'list') return store.read(state => result('已列出模型连接。', {
      active_id: state.activeProviderId,
      connections: Object.values(state.providers).map(({ id, name, model, protocol }) => ({ id, name, model, protocol })),
      presets: providerPresets.map(({ id, name, model, protocol, website, keyUrl, endpoint }) => ({ id, name, model, protocol, website, keyUrl, endpoint })),
    }));
    if (action === 'open_site') {
      const preset = providerPresets.find(item => item.id === args.id);
      const url = args.site === 'key' ? preset?.keyUrl : preset?.website;
      if (!url) fail('这个供应商没有预设的官方链接。');
      return permission(grant, `打开 ${preset.name} 的${args.site === 'key' ? '密钥页面' : '官方网站'}。`, url, 'link', { url }) ||
        result('已打开供应商页面。');
    }
    if (action === 'select') return store.mutate(state => {
      const provider = own(state.providers, args.id);
      if (!provider) fail('请先保存该模型连接。');
      state.activeProviderId = provider.id;
      return result(`已设为当前模型「${provider.model}」。下次用户发送消息时生效。`, { id: provider.id, model: provider.model }, true);
    });
    const current = await store.read(state => own(state.providers, args.id || state.activeProviderId));
    if (action === 'test' && current && args.endpoint === undefined && args.model === undefined && args.protocol === undefined) {
      await testProvider({ ...current, key: store.unseal(current.secret) });
      return result(`模型「${current.model}」连接成功。`, { id: current.id });
    }
    const preset = providerPresets.find(item => item.id === args.id) || fail('请从模型供应商列表选择有效 ID。');
    const candidate = {
      id: preset.id, model: args.model ?? current?.model ?? preset.model, name: args.title ?? current?.name ?? preset.name,
      endpoint: args.endpoint ?? current?.endpoint ?? preset.endpoint, protocol: args.protocol ?? current?.protocol ?? preset.protocol,
      removeKey: args.remove_key === true, contextTokens: args.context_tokens,
    };
    const endpoint = new URL(candidate.endpoint);
    if (endpoint.username || endpoint.password || endpoint.hash) fail('模型连接地址请使用不含用户名、密码或片段的 API 地址。');
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname);
    const existingOrigin = current?.endpoint ? new URL(current.endpoint).origin : '';
    const needsKey = !local && (!current?.secret || existingOrigin !== endpoint.origin || candidate.removeKey);
    const operation = action === 'test' ? '测试' : '保存并启用';
    const review = permission(grant, `${operation}模型「${candidate.model}」，服务地址为 ${endpoint.origin}${endpoint.pathname}。`,
      [candidate, current?.secret ?? null], needsKey ? 'key' : 'confirm');
    if (review) return review;
    if (action === 'test') {
      await testProvider(readProvider({ ...candidate, key: grant.key }, current, store));
      return result(`模型「${candidate.model}」连接成功。`);
    }
    return store.mutate(state => {
      const existing = own(state.providers, preset.id);
      permission(grant, '', [candidate, existing?.secret ?? null]);
      const saved = saveProvider(state, readProvider({ ...candidate, key: grant.key }, existing, store), store);
      const safe = providerView(saved);
      return result(`已保存模型连接「${safe.model}」。下次用户发送消息时生效。`, { id: safe.id, model: safe.model }, true);
    });
  }

  function workspace(args, run, grant) {
    switch (args.action) {
      case 'open':
        if (!args.view) fail('请提供要打开的页面。');
        if (!run.projectId && !['write', 'providers'].includes(args.view)) fail('请先新建或打开一个项目。');
        run.ui.view = args.view;
        return result('已安排打开页面。', { view: args.view });
      case 'mode':
        if (!args.mode) fail('请提供助手模式。');
        run.ui.mode = args.mode;
        return result('已设置助手模式。', { mode: args.mode });
      case 'reading_depth':
        if (!run.projectId || !args.depth) fail('请先打开项目并指定阅读深度。');
        run.ui.depth = args.depth;
        return result('已设置阅读深度，下次发送消息时生效。', { depth: args.depth });
      case 'reading':
        if (!run.projectId) fail('请先打开一个项目。');
        if (!args.source || (typeof args.all !== 'boolean' && !args.ids)) fail('请提供阅读类型和选择范围。');
        run.ui.reading = { ...run.ui.reading, [args.source]: args.all ?? args.ids };
        return result('已设置重点阅读范围。', { source: args.source });
      case 'copy':
        if (!grant) return permission(null, '将这段文字复制到剪贴板。', args.text, 'copy', { text: need(args.text, '要复制的文本') });
        return result('已复制到剪贴板。');
      default:
        return result('当前稿件已保存。');
    }
  }

  function attachments(args, run) {
    const files = run.attachments || [];
    if (args.action === 'list') {
      return result('已列出对话附件。', page(files.map(({ id, name, characters }) => ({ id, name, characters })), args));
    }
    const file = !args.id && files.length === 1 ? files[0] : find(files, args.id, '对话附件');
    return result('已读取附件「' + file.name + '」。', { id: file.id, name: file.name, ...excerpt(file.text, args) });
  }

  const handlers = { projects, chapters, setting_cards: settingCards, outline, references, attachments, articles, memories, models, workspace };
  return {
    writeChapters,
    async execute(call, run, grant) {
      try {
        const args = parseArgs(call.name, call.args);
        return await handlers[call.name](args, run, grant);
      } catch (error) {
        return { error: String(error.message || '操作未完成。').slice(0, 500) };
      }
    },
  };
}
