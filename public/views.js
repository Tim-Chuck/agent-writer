import { esc, icon } from './icons.js';

const counts = new Intl.NumberFormat('zh-CN');
const dates = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const referenceAccept = '.txt,.text,.md,.markdown,.csv,.tsv,.json,.jsonl,.html,.htm,.xhtml,.xml,.docx,.pdf,.epub,.odt';
const memoryReasons = { chapter: '章节记忆', weekly: '定期记忆', volume: '定量记忆', manual: '手动记忆' };
const cardTypes = { character: '角色', prop: '道具', location: '地点', organization: '组织' };
const memoryCardIcons = { character: 'person', prop: 'box', location: 'pin', organization: 'building' };
const plotTypes = { event: '事件与因果', state: '状态变化', knowledge: '人物知情', thread: '伏笔与承诺' };

function formatDate(value) {
  const date = new Date(value || NaN);
  return Number.isNaN(date.valueOf()) ? '' : dates.format(date);
}

function externalLink(url, label) {
  return /^https:\/\//.test(url || '')
    ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}${icon('link')}</a>`
    : '';
}

function emptyState(symbol, title, message) {
  return `<div class="aux-empty"><div class="aux-symbol">${icon(symbol)}</div><strong>${esc(title)}</strong><p>${esc(message)}</p></div>`;
}

export function renderProviders({ presets = [], providers = {}, providerTab, activeProviderId }) {
  const preset = presets.find(({ id }) => id === providerTab) ?? presets.find(({ id }) => id === activeProviderId) ?? presets[0];
  if (!preset) return '<section class="page aux-page"><h1>模型连接</h1><p class="muted">正在载入供应商…</p></section>';

  const saved = providers[preset.id];
  const config = { ...preset, ...saved };
  const custom = preset.id === 'custom';
  const active = activeProviderId === preset.id && Boolean(saved);
  const keyPlaceholder = saved?.hasKey ? '已保存密钥，留空即可继续使用' : '粘贴从供应商获取的 API 密钥';
  const navigation = presets.map(({ id, name }) => {
    const selected = id === preset.id;
    const connected = id === activeProviderId && Boolean(providers[id]);
    return `<li><button type="button" class="aux-provider-tab${selected ? ' is-active' : ''}" data-act="provider-tab" data-id="${esc(id)}" aria-pressed="${selected}">
      <span>${esc(name)}</span>${connected ? `<span class="aux-provider-check" title="当前模型" aria-label="当前模型">${icon('check')}</span>` : ''}
    </button></li>`;
  }).join('');

  return `<section class="page aux-page aux-providers" aria-labelledby="providers-title">
    <header class="page-head aux-head">
      <div><h1 id="providers-title">模型连接</h1><p class="muted">选择一个供应商，填入 API 密钥，即可用于创作、构思与润色。</p></div>
    </header>
    <div class="aux-provider-layout">
      <nav class="panel aux-provider-picker" aria-label="模型供应商"><ul>${navigation}</ul></nav>
      <section class="panel aux-provider-panel" aria-labelledby="provider-title">
        <div class="aux-provider-head">
          <h2 id="provider-title">${esc(config.name)}</h2>
          <div class="aux-provider-links">${externalLink(preset.website, '官网')}${externalLink(preset.keyUrl, '获取密钥')}</div>
          ${active ? `<span class="pill aux-current-provider">${icon('check')}当前使用</span>` : ''}
        </div>
        <form id="provider-form" class="aux-provider-form" method="post" action="/api/providers/save" novalidate>
          <input type="hidden" name="id" value="${esc(preset.id)}">
          <label class="field"><span>API 请求地址</span><input name="endpoint" type="url" inputmode="url" autocomplete="off" spellcheck="false" required aria-describedby="api-endpoint-help" value="${esc(config.endpoint || '')}" placeholder="https://api.example.com/v1"><small id="api-endpoint-help" class="aux-form-help muted">可填写基础地址或完整接口地址。基础地址会自动补全请求路径。</small></label>
          <label class="field"><span>默认模型</span><input name="model" autocomplete="off" spellcheck="false" required value="${esc(config.model || '')}" placeholder="填入供应商提供的模型 ID"></label>
          <div class="field aux-key-field">
            <label for="provider-key">API 密钥</label>
            <div class="aux-key-input">
              <input name="key" id="provider-key" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false" placeholder="${keyPlaceholder}">
              <button type="button" class="icon-btn" data-act="toggle-key" aria-label="显示或隐藏密钥" title="显示或隐藏密钥">${icon('eye')}</button>
            </div>
          </div>
          ${custom ? '<p class="aux-form-help muted">本机模型可使用 localhost 的 HTTP 地址。远程模型使用 HTTPS。</p>' : ''}
          <details class="aux-advanced"${custom ? ' open' : ''}>
            <summary>${icon('chevron')}<span>高级设置</span></summary>
            <div class="aux-advanced-fields">
              <label class="field"><span>供应商名称</span><input name="name" autocomplete="off" value="${esc(config.name || '')}"></label>
              <label class="field"><span>接口协议</span><select name="protocol">
                <option value="chat"${config.protocol === 'chat' ? ' selected' : ''}>OpenAI 兼容 Chat Completions</option>
                <option value="responses"${config.protocol === 'responses' ? ' selected' : ''}>OpenAI Responses</option>
                <option value="messages"${config.protocol === 'messages' ? ' selected' : ''}>Anthropic Messages</option>
              </select></label>
              <label class="field"><span>上下文窗口（token）</span><input name="contextTokens" type="number" min="4096" max="2000000" step="1" value="${esc(config.contextTokens ?? '')}" placeholder="可选，填供应商公布的数值" aria-describedby="context-window-help"><small id="context-window-help" class="aux-form-help muted">按此数值估算阅读额度，并为生成留出空间。</small></label>
            </div>
          </details>
          <div class="aux-actions">
            <button type="submit" class="btn primary">保存连接</button>
            <button type="button" class="btn secondary" data-act="provider-test" data-id="${esc(preset.id)}">测试连接</button>
            ${saved && !active ? `<button type="button" class="btn aux-inline-action" data-act="provider-select" data-id="${esc(preset.id)}">设为当前模型</button>` : ''}
          </div>
          <p id="provider-status" class="muted" role="status"></p>
        </form>
      </section>
    </div>
  </section>`;
}

export function renderReferences({ project, referenceId }) {
  const references = project.references ?? [];
  const selected = references.find(({ id }) => id === referenceId) ?? references[0];
  const referenceRows = references.map(({ id, name, format, text }) => `<li class="aux-reference-row${selected?.id === id ? ' is-active' : ''}">
    <button type="button" data-act="reference-select" data-id="${esc(id)}" aria-pressed="${selected?.id === id}">
      <span class="aux-symbol">${icon('file')}</span><span class="aux-row-label"><strong>${esc(name)}</strong><small>${esc((format || '文本').toUpperCase())} · ${counts.format(text?.length ?? 0)} 字</small></span>
    </button>
    <button type="button" class="icon-btn aux-remove" data-act="reference-remove" data-id="${esc(id)}" aria-label="移除 ${esc(name)}" title="移除资料">${icon('trash')}</button>
  </li>`).join('');

  return `<section class="page aux-page aux-references" aria-labelledby="references-title">
    <header class="page-head aux-head"><div><h1 id="references-title">参考资料</h1><p class="muted">把查到的资料、语言样本和研究笔记放在当前项目里。</p></div></header>
    <div class="aux-drop" data-drop="references">
      <div class="aux-symbol aux-drop-symbol">${icon('upload')}</div>
      <div class="aux-drop-copy"><strong>拖入文件导入文字</strong><p>支持 TXT、Markdown、DOCX、PDF、EPUB、ODT、网页和表格文本。单个文件最大 25 MB。</p></div>
      <input id="reference-files" class="aux-file-input" type="file" multiple accept="${referenceAccept}" aria-label="选择参考资料文件">
      <label for="reference-files" class="btn primary">${icon('plus')}选择文件</label>
    </div>
    <div id="reference-status" role="status"></div>
    <div class="aux-reference-layout">
      <section class="panel aux-reference-list" aria-labelledby="reference-list-title">
        <div class="aux-panel-head"><h2 id="reference-list-title">项目资料 <small>${counts.format(references.length)}</small></h2></div>
        ${references.length ? `<ul>${referenceRows}</ul>` : emptyState('file', '资料夹是空的', '导入后，可以在这里选择一份资料阅读。')}
      </section>
      <section class="panel aux-reference-preview" aria-labelledby="reference-preview-title">
        ${selected ? `<div class="aux-panel-head"><div><h2 id="reference-preview-title">${esc(selected.name)}</h2><p class="muted">${counts.format(selected.text?.length ?? 0)} 字${selected.addedAt ? ` · 导入于 ${esc(formatDate(selected.addedAt))}` : ''}</p></div></div>
          <pre tabindex="0" aria-label="${esc(selected.name)} 的文字内容">${esc(selected.text ?? '')}</pre>` : `<div class="aux-panel-head"><h2 id="reference-preview-title">文字预览</h2></div>${emptyState('book', '在这里读导入的文字', 'PDF 需要可选中的文字层。扫描件可以先识别文字再导入。')}`}
      </section>
    </div>
  </section>`;
}

function renderMemoryCollection(items, label, labelFor, textFor) {
  if (!items?.length) return '';
  const visible = items.slice(0, 16);
  const excerpts = visible.map(item => {
    const text = textFor(item) || '';
    return `<div><strong>${esc(labelFor(item) || '未命名')}</strong><p>${esc(text.slice(0, 1200) || '暂无正文')}${text.length > 1200 ? '…' : ''}</p></div>`;
  }).join('');
  return `<details class="aux-snapshot-group"><summary><span>${esc(label)}</span><span class="muted">${counts.format(items.length)} 项</span>${icon('chevron')}</summary>
    <div class="aux-snapshot-excerpts">${excerpts}${items.length > visible.length ? `<p class="muted">还有 ${counts.format(items.length - visible.length)} 项保存在这次记忆中。</p>` : ''}</div></details>`;
}

function renderMemoryDetail(header, detail, enabled, model) {
  if (!header) return '';
  const snapshot = detail?.id === header.id ? detail.snapshot : null;
  const reason = (header.reasons ?? []).map(value => memoryReasons[value]).filter(Boolean).join('、');
  const textLength = Number(header.characterCount) || 0;
  const [summary, ...excerpt] = (header.summary || '').split('\n');
  const groups = snapshot ? [
    renderMemoryCollection(snapshot.chapters, '正文', item => item.title, item => item.text),
    renderMemoryCollection(snapshot.cards, '设定', item => `${cardTypes[item.type] || '设定'} · ${item.title}`, item => item.description),
    renderMemoryCollection(snapshot.planning ? [{ title: '项目规划', text: snapshot.planning }] : [], '规划', item => item.title, item => item.text),
    renderMemoryCollection(snapshot.scenes, '大纲', item => item.title, item => item.description),
    renderMemoryCollection(snapshot.references, '参考资料', item => item.name, item => item.text),
  ].join('') : '';

  return `<section class="panel aux-snapshot" aria-labelledby="snapshot-title">
    <header class="aux-panel-head"><div><h2 id="snapshot-title">${esc(header.title || '记忆详情')}</h2><p class="muted">${esc([formatDate(header.createdAt), reason, `${counts.format(textLength)} 字`].filter(Boolean).join(' · '))}</p></div></header>
    <div class="aux-snapshot-body">
      ${renderExtractionStatus(header, enabled, model)}
      ${summary ? `<p class="aux-memory-totals">${esc(summary)}</p>` : ''}
      ${excerpt.length ? `<blockquote>${esc(excerpt.join('\n'))}</blockquote>` : ''}
      ${groups ? `<div class="aux-snapshot-groups">${groups}</div><p class="aux-form-help muted">这里展示每项内容的节选。</p>` : ''}
    </div>
  </section>`;
}

function renderExtractionStatus(entry, enabled, model, kind = 'cards') {
  const plot = kind === 'plot';
  const label = plot ? '提取剧情要点' : '识别设定';
  const scan = entry?.[plot ? 'plotExtraction' : 'cardExtraction'];
  if (!scan || scan.status === 'complete') return '';
  if (scan.status === 'failed') {
    return `<div class="aux-extraction-status is-error"><p>${esc(scan.error || label + '未完成。')}</p>
      ${enabled ? `<button type="button" class="btn secondary" data-act="memory-retry" data-kind="${kind}" data-id="${esc(entry.id)}">${plot ? '重试提取' : '重试识别'}</button>` : ''}</div>`;
  }
  const status = !enabled ? `${label}已暂停` : model === '' ? '等待连接模型' : scan.total > 0 ?
    `正在${label}（${scan.completed ?? 0}/${scan.total}）` : `等待${label}`;
  return `<p class="aux-extraction-status" role="status">${status}</p>`;
}

function renderPlotPoints({ project, memoryPoints, model }) {
  const enabled = project.memorySettings?.extractPlot === true;
  const waiting = project.memories.findLast(entry => entry.plotExtraction?.status === 'pending');
  const failed = project.memories.find(entry => entry.plotExtraction?.status === 'failed');
  const chapters = new Map();
  for (const point of memoryPoints) {
    if (!chapters.has(point.chapterId)) chapters.set(point.chapterId, []);
    chapters.get(point.chapterId).push(point);
  }
  const entries = [...chapters.values()].map((points, index) => `<details class="aux-snapshot-group"${index === 0 ? ' open' : ''}>
    <summary><span>${esc(points[0].chapterTitle)}</span><small class="muted">${counts.format(points.length)} 条</small>${icon('chevron', 16)}</summary>
    <ul class="aux-plot-list">${points.map(point => `<li><small>${esc(plotTypes[point.type])}</small><p>${esc(point.text)}</p>
      <blockquote>${esc(point.evidence)}</blockquote>
      <button type="button" class="btn aux-ai-source" data-act="plot-source" data-id="${esc(point.chapterId)}" data-offset="${esc(point.offset)}" data-length="${esc(point.evidence.length)}">${icon('file', 14)}查看正文位置</button></li>`).join('')}</ul>
    </details>`).join('');
  return `<section class="panel aux-memory-cards" aria-labelledby="plot-points-title">
    <header class="aux-panel-head"><div><h2 id="plot-points-title">剧情要点 <small>${counts.format(memoryPoints.length)}</small></h2>
      <p class="muted">写作时会根据本轮要求查找相关要点和原文。</p></div></header>
    <div class="aux-ai-content">
      ${renderExtractionStatus(waiting, enabled, model, 'plot')}${renderExtractionStatus(failed, enabled, model, 'plot')}
      ${entries ? `<div class="aux-snapshot-groups">${entries}</div>` : emptyState('outline', '还没有可用的剧情要点', enabled
        ? '写好正文后保存记忆，模型会提取事件、人物知情范围和伏笔。' : '开启「提取剧情要点」后，模型会读取当前稿件并生成有原文依据的要点。')}
    </div></section>`;
}

function renderMemoryCards({ project, memoryCards, memoryFilter, model }) {
  const enabled = project.memorySettings?.extractCards === true;
  const waiting = project.memories.findLast(entry => entry.cardExtraction?.status === 'pending');
  const failed = project.memories.find(entry => entry.cardExtraction?.status === 'failed');
  const cards = memoryFilter === 'all' ? memoryCards : memoryCards.filter(card => card.type === memoryFilter);
  const filters = Object.entries({ all: '全部', ...cardTypes }).map(([id, label]) =>
    `<button type="button" class="btn aux-memory-filter" data-act="memory-filter" data-id="${id}" aria-pressed="${id === memoryFilter}">${label}</button>`).join('');
  const items = cards.map(card => `<article class="aux-ai-card">
    <div class="aux-ai-kind"><span class="aux-symbol">${icon(memoryCardIcons[card.type])}</span>${cardTypes[card.type]}</div>
    <h3>${esc(card.title)}</h3>
    ${card.authored ? '<small class="aux-ai-authored">有同名的作者设定</small>' : ''}
    <ul>${card.notes.map(note => `<li><p>${esc(note.description)}</p>
      <button type="button" class="btn aux-ai-source" data-act="memory-select" data-id="${esc(note.memoryId)}" title="${esc(note.evidence)}">来源 · ${esc(note.chapterTitle || '未命名章节')}</button></li>`).join('')}</ul>
  </article>`).join('');
  const emptyTitle = memoryCards.length ? '这个分类还没有卡片' : '还没有 AI 设定卡';
  const emptyMessage = memoryCards.length ? '可以切换分类查看其他卡片。' : enabled ?
    '保存记忆后，会从正文识别设定并显示在这里。' : '开启自动识别后，下次保存记忆时会生成卡片。';
  return `<section class="panel aux-memory-cards" aria-labelledby="memory-cards-title">
    <header class="aux-panel-head"><div><h2 id="memory-cards-title">AI 设定卡 <small>${counts.format(memoryCards.length)}</small></h2>
      <p class="muted">从正文识别设定，单独保存在记忆中。</p></div></header>
    <div class="aux-ai-content">
      ${renderExtractionStatus(waiting, enabled, model)}
      ${renderExtractionStatus(failed, enabled, model)}
      <div class="aux-memory-filters" role="group" aria-label="按设定类型筛选">${filters}</div>
      ${cards.length ? `<div class="aux-ai-grid">${items}</div>` : emptyState('layers', emptyTitle, emptyMessage)}
    </div>
  </section>`;
}

export function renderMemoryContent(view) {
  if (view.memoryTab === 'cards') return renderMemoryCards(view);
  if (view.memoryTab === 'plot') return renderPlotPoints(view);
  const { project, memoryId, memoryDetail } = view;
  const entries = project.memories ?? [];
  const selected = entries.find(({ id }) => id === memoryId);
  const rows = entries.map(({ id, title, createdAt, chapterId, cardExtraction }) => {
    const analysis = cardExtraction?.status === 'complete' ? (cardExtraction.count ? `识别 ${cardExtraction.count} 条设定` : '无新增设定') :
      cardExtraction?.status === 'failed' ? '设定识别未完成' : cardExtraction ? '待识别设定' : '';
    return `<li><button type="button" class="aux-memory-row${selected?.id === id ? ' is-active' : ''}" data-act="memory-select" data-id="${esc(id)}" aria-pressed="${selected?.id === id}">
      <span class="aux-symbol">${icon(chapterId ? 'file' : 'brain')}</span><span class="aux-row-label"><strong>${esc(title || '记忆')}</strong><small>${esc([formatDate(createdAt), analysis].filter(Boolean).join(' · '))}</small></span>${icon('chevron')}
    </button></li>`;
  }).join('');
  return `<section class="panel aux-memory-list" aria-labelledby="memory-list-title">
    <div class="aux-panel-head"><h2 id="memory-list-title">保存记录 <small>${counts.format(entries.length)}</small></h2></div>
    ${entries.length ? `<ul>${rows}</ul>` : emptyState('brain', '还没有保存记录', '可以立即存一份，或者等下次开启新章节时自动保存。')}
    </section>${renderMemoryDetail(selected, memoryDetail, project.memorySettings?.extractCards === true, view.model)}`;
}

export function renderMemories(view) {
  const { project, memoryTab, model } = view;
  const settings = project.memorySettings ?? {};
  const changes = Number(project.memoryState?.changedCharacters) || 0;
  const tabs = [['history', '保存记录'], ['plot', '剧情要点'], ['cards', 'AI 设定卡']].map(([id, label]) =>
    `<button type="button" class="btn" data-act="memory-tab" data-id="${id}" aria-pressed="${memoryTab === id}">${label}</button>`).join('');

  return `<section class="page aux-page aux-memories" aria-labelledby="memories-title">
    <header class="page-head aux-head"><div><h1 id="memories-title">记忆</h1><p class="muted">保存项目在不同创作阶段的正文、设定、规划、大纲和资料。</p></div>
      <button type="button" class="btn primary" data-act="memory-save">${icon('plus')}保存当前记忆</button></header>
    <div class="aux-memory-tabs"><div role="group" aria-label="记忆视图">${tabs}</div></div>
    <div class="aux-memory-layout">
      <div class="aux-memory-history" id="memory-content">${renderMemoryContent(view)}</div>
      <div class="aux-memory-side">
      <section class="panel aux-memory-settings" aria-labelledby="memory-extraction-title">
        <div class="aux-panel-head"><h2 id="memory-extraction-title">自动提取</h2>${icon('sparkles')}</div>
        <div class="aux-memory-form">
          <label class="aux-setting"><span><strong>保存记忆时识别</strong><small>由当前模型识别正文中的角色、道具、地点和组织。</small></span><input type="checkbox" id="memory-extraction-toggle"${settings.extractCards === true ? ' checked' : ''}></label>
          <label class="aux-setting"><span><strong>提取剧情要点</strong><small>开启时读取现有正文，之后只提取新增或改动的章节。</small></span><input type="checkbox" id="memory-plot-toggle"${settings.extractPlot === true ? ' checked' : ''}></label>
          ${model ? `<p class="aux-form-help muted" title="${esc(model)}">当前模型 · ${esc(model)}</p>` :
            '<button type="button" class="btn secondary" data-act="navigate" data-id="providers">连接模型</button>'}
        </div>
      </section>
      <section class="panel aux-memory-settings" aria-labelledby="memory-settings-title">
        <div class="aux-panel-head"><div><h2 id="memory-settings-title">自动保存</h2><p class="muted">按当前项目的创作节奏设置。</p></div>${icon('gear')}</div>
        <form id="memory-form" class="aux-memory-form">
          <fieldset><legend class="aux-visually-hidden">按章节存储</legend>
            <label class="aux-setting"><span><strong>按章节存储</strong><small>完成章节，或助手识别到「开始下一章创作」等请求时保存。</small></span><input name="chapterEnabled" type="checkbox"${settings.chapterEnabled !== false ? ' checked' : ''}></label>
          </fieldset>
          <fieldset><legend class="aux-visually-hidden">定期存储</legend>
            <label class="aux-setting"><span><strong>定期存储</strong><small>应用运行时检查，重新打开时补存已到期的记忆。</small></span><input name="weeklyEnabled" type="checkbox"${settings.weeklyEnabled !== false ? ' checked' : ''}></label>
            <label class="aux-number"><span>每</span><input name="intervalDays" type="number" min="1" max="365" required value="${esc(settings.intervalDays ?? 7)}" aria-label="自动保存间隔天数"><span>天保存一次</span></label>
          </fieldset>
          <fieldset><legend class="aux-visually-hidden">定量存储</legend>
            <label class="aux-setting"><span><strong>定量存储</strong><small>按累计文本改动量保存，当前累计 <span id="memory-change-count">${counts.format(changes)}</span> 字。</small></span><input name="volumeEnabled" type="checkbox"${settings.volumeEnabled ? ' checked' : ''}></label>
            <label class="aux-number"><span>累计</span><input name="characterThreshold" type="number" min="1" max="1000000" required value="${esc(settings.characterThreshold ?? 5000)}" aria-label="自动保存累计文本改动量"><span>字改动后保存</span></label>
          </fieldset>
          <button class="btn primary" type="submit">保存设置</button>
        </form>
      </section>
      </div>
    </div>
  </section>`;
}
