import { esc, icon } from './icons.js';

export const cardTypes = Object.freeze({
  character: { label: '角色', icon: 'person' },
  prop: { label: '道具', icon: 'box' },
  location: { label: '地点', icon: 'pin' },
  organization: { label: '组织', icon: 'building' },
});

const acts = [
  { number: 1, title: '第一幕', subtitle: '开端' },
  { number: 2, title: '第二幕', subtitle: '发展' },
  { number: 3, title: '第三幕', subtitle: '收束' },
];

function typeFor(card) {
  return cardTypes[card.type] ?? cardTypes.character;
}

function cardTypeTabs(selected) {
  const tabs = [['all', '全部'], ...Object.entries(cardTypes).map(([type, entry]) => [type, entry.label])];
  return '<div class="setting-tabs" role="group" aria-label="设定类型">' + tabs.map(([type, label]) =>
    `<button type="button" class="setting-tab" data-act="card-type" data-id="${type}" aria-pressed="${selected === type}">${label}</button>`
  ).join('') + '</div>';
}

function cardButton(className, text) {
  return `<button type="button" class="${className}" data-act="card-add">${icon('plus', 16)} ${text}</button>`;
}

function settingCard(card) {
  const type = typeFor(card);
  return `<article class="setting-card" draggable="true" data-drag-card="${esc(card.id)}">
    <span class="setting-card-grip" aria-hidden="true">${icon('grip', 16)}</span>
    <div class="setting-card-content">
      <h3>${esc(card.title)}</h3>
      <span class="setting-kind">${icon(type.icon, 13)}${type.label}</span>
      ${card.description ? `<p>${esc(card.description)}</p>` : ''}
    </div>
    <button type="button" class="icon-btn setting-card-edit" data-act="card-edit" data-id="${esc(card.id)}" aria-label="编辑${esc(card.title)}" title="编辑设定">${icon('pencil', 16)}</button>
  </article>`;
}

function emptySettings(selected) {
  const label = selected === 'all' ? '设定卡片' : cardTypes[selected]?.label ?? '设定卡片';
  return `<p class="settings-empty">还没有${label}，可以点「新建设定」添加。</p>`;
}

function filteredCards(cards, selected) {
  return selected === 'all' ? cards : cards.filter(card => card.type === selected);
}

function settingLibrary(cards, selected) {
  const visible = filteredCards(cards, selected);
  return `<aside class="outline-library" aria-labelledby="outline-library-title">
    <div class="outline-library-heading">
      <h2 id="outline-library-title">设定卡片</h2>
      ${cardButton('outline-text-button', '新建设定')}
    </div>
    ${cardTypeTabs(selected)}
    <p class="setting-library-hint">把卡片拖入场景，或在编辑场景时关联。</p>
    <div class="outline-library-cards">
      ${visible.length ? visible.map(settingCard).join('') : emptySettings(selected)}
    </div>
  </aside>`;
}

function sceneCard(scene, sequence, chaptersById, cardsById) {
  const chapter = chaptersById.get(scene.chapterId);
  const started = Boolean(chapter?.text?.trim());
  const references = (scene.cardIds ?? []).map(id => cardsById.get(id)).filter(Boolean);
  const sceneId = esc(scene.id);
  const edit = `data-act="scene-edit" data-id="${sceneId}"`;
  return `<article class="outline-scene" draggable="true" data-drag-scene="${sceneId}" data-drop-scene="${sceneId}">
    <div class="outline-scene-meta">
      <span class="outline-status${started ? ' outline-status-written' : ''}">${started ? '已有正文' : '待写'}</span>
      ${chapter ? `<button type="button" class="outline-chapter-link" data-act="chapter" data-id="${esc(chapter.id)}" title="${esc(chapter.title)}">${icon('file', 13)}${esc(chapter.title)}</button>` : ''}
    </div>
    <h3>
      <button type="button" class="outline-scene-title" ${edit} title="编辑场景或关联设定">
        <span><span class="outline-sequence">S${sequence}</span> ${esc(scene.title)}</span>${icon('pencil', 15)}
      </button>
    </h3>
    ${scene.description ? `<p class="outline-scene-description">${esc(scene.description)}</p>` : ''}
    <div class="outline-scene-links">
      ${references.map(card => {
        const type = typeFor(card);
        return `<span class="outline-setting-chip" title="${esc(card.title)}">${icon(type.icon, 13)}<span>${esc(card.title)}</span>
          <button type="button" data-act="scene-unlink" data-id="${sceneId}" data-card="${esc(card.id)}" aria-label="移除对${esc(card.title)}的关联" title="取消关联">${icon('x', 11)}</button>
        </span>`;
      }).join('')}
      ${references.length ? '' : `<button type="button" class="outline-unlinked" ${edit}>${icon('plus', 13)} 关联设定</button>`}
    </div>
  </article>`;
}

function matchesScene(scene, terms, chaptersById, cardsById) {
  const chapter = chaptersById.get(scene.chapterId);
  const references = (scene.cardIds ?? []).map(id => cardsById.get(id)).filter(Boolean);
  const content = [
    scene.title, scene.description, chapter?.title,
    ...references.flatMap(card => [card.title, card.description, typeFor(card).label]),
  ].join(' ').toLocaleLowerCase();
  return terms.every(term => content.includes(term));
}

function outlineLane(act, scenes, sequenceById, chaptersById, cardsById, searching) {
  return `<section class="outline-lane" data-drop-act="${act.number}" aria-labelledby="outline-act-${act.number}">
    <header class="outline-lane-head">
      <div>
        <h2 id="outline-act-${act.number}">${act.title}<span>${act.subtitle}</span></h2>
        <span class="outline-lane-count">${scenes.length} 个场景</span>
      </div>
      <button type="button" class="icon-btn outline-lane-add" data-act="scene-add" data-actnum="${act.number}" aria-label="在${act.title}添加场景" title="添加场景">${icon('plus', 17)}</button>
    </header>
    <div class="outline-lane-scenes">
      ${scenes.length ? scenes.map(scene => sceneCard(scene, sequenceById.get(scene.id), chaptersById, cardsById)).join('') :
        `<p class="outline-lane-empty">${searching ? '本幕没有匹配的场景' : '暂无场景，可新建或拖入'}</p>`}
    </div>
  </section>`;
}

export function renderOutline({ project, cardType = 'all', outlineFilter = '' }) {
  const chaptersById = new Map(project.chapters.map(chapter => [chapter.id, chapter]));
  const cardsById = new Map(project.cards.map(card => [card.id, card]));
  const ordered = acts.flatMap(act => project.scenes.filter(scene => scene.act === act.number));
  const sequenceById = new Map(ordered.map((scene, index) => [scene.id, index + 1]));
  const terms = outlineFilter.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const visible = ordered.filter(scene => matchesScene(scene, terms, chaptersById, cardsById));
  return `<section class="page outline-page">
    <header class="page-head outline-page-head">
      <div><h1>故事大纲</h1>${project.description ? `<p>${esc(project.description)}</p>` : ''}</div>
    </header>
    <div class="outline-layout">
      <div class="outline-main">
        <div class="outline-toolbar">
          <div class="outline-board-count">${icon('outline', 17)} <span>${terms.length ? `找到 ${visible.length} 个场景` : `${ordered.length} 个场景`}</span></div>
          <label class="outline-search">${icon('search', 16)}<input id="outline-search" type="search" aria-label="搜索场景或设定" placeholder="搜索场景、章节或设定" value="${esc(outlineFilter)}"></label>
          <button type="button" class="btn primary outline-add" data-act="scene-add" data-actnum="1">${icon('plus', 17)} 新建场景</button>
        </div>
        <div class="outline-board" aria-label="三幕场景看板">
          ${acts.map(act => outlineLane(act, visible.filter(scene => scene.act === act.number), sequenceById, chaptersById, cardsById, terms.length > 0)).join('')}
        </div>
      </div>
      ${settingLibrary(project.cards, cardType)}
    </div>
    <details class="outline-planning">
      <summary>${icon('clipboard', 17)} <span>创作规划</span>${icon('chevron', 16)}</summary>
      <label class="outline-planning-body">
        <span>记录整部作品的创作安排，写作时可以选择让模型重点读取。</span>
        <textarea id="planning" rows="5" aria-label="创作规划" placeholder="记下长线目标、叙述视角和伏笔安排。">${esc(project.planning)}</textarea>
      </label>
    </details>
  </section>`;
}

export function renderCards({ project, cardType = 'all' }) {
  const visible = filteredCards(project.cards, cardType);
  return `<section class="page settings-page">
    <header class="page-head settings-page-head">
      <div><h1>设定卡片</h1><p>管理人物和世界设定，在大纲里把它们关联到场景。</p></div>
      ${cardButton('btn primary', '新建设定')}
    </header>
    <div class="settings-toolbar">
      ${cardTypeTabs(cardType)}
      <span class="settings-count">${visible.length} 张卡片</span>
    </div>
    ${visible.length ? `<div class="settings-grid">${visible.map(settingCard).join('')}</div>` : emptySettings(cardType)}
  </section>`;
}
