import { esc, icon } from './icons.js';

const counts = new Intl.NumberFormat('zh-CN');
const dates = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const referenceAccept = '.txt,.text,.md,.markdown,.csv,.tsv,.json,.jsonl,.html,.htm,.xhtml,.xml,.docx,.pdf,.epub,.odt';
const memoryReasons = { chapter: '章节记忆', weekly: '定期记忆', volume: '定量记忆', manual: '手动记忆' };
const cardTypes = { character: '角色', prop: '道具', location: '地点', organization: '组织' };

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

function renderMemoryDetail(header, detail) {
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
      ${summary ? `<p class="aux-memory-totals">${esc(summary)}</p>` : ''}
      ${excerpt.length ? `<blockquote>${esc(excerpt.join('\n'))}</blockquote>` : ''}
      ${groups ? `<div class="aux-snapshot-groups">${groups}</div><p class="aux-form-help muted">这里展示每项内容的节选。</p>` : ''}
    </div>
  </section>`;
}

export function renderMemories({ project, memoryId, memoryDetail }) {
  const settings = project.memorySettings ?? {};
  const entries = project.memories ?? [];
  const selected = entries.find(({ id }) => id === memoryId);
  const changes = Number(project.memoryState?.changedCharacters) || 0;
  const rows = entries.map(({ id, title, createdAt, chapterId }) => `<li><button type="button" class="aux-memory-row${selected?.id === id ? ' is-active' : ''}" data-act="memory-select" data-id="${esc(id)}" aria-pressed="${selected?.id === id}">
    <span class="aux-symbol">${icon(chapterId ? 'file' : 'brain')}</span><span class="aux-row-label"><strong>${esc(title || '记忆')}</strong><small>${esc(formatDate(createdAt))}</small></span>${icon('chevron')}
  </button></li>`).join('');

  return `<section class="page aux-page aux-memories" aria-labelledby="memories-title">
    <header class="page-head aux-head"><div><h1 id="memories-title">记忆</h1><p class="muted">保存项目在不同创作阶段的正文、设定、规划、大纲和资料。</p></div>
      <button type="button" class="btn primary" data-act="memory-save">${icon('plus')}保存当前记忆</button></header>
    <div class="aux-memory-layout">
      <div class="aux-memory-history">
        <section class="panel aux-memory-list" aria-labelledby="memory-list-title">
          <div class="aux-panel-head"><h2 id="memory-list-title">保存记录 <small>${counts.format(entries.length)}</small></h2></div>
          ${entries.length ? `<ul>${rows}</ul>` : emptyState('brain', '还没有保存记录', '可以立即存一份，或者等下次开启新章节时自动保存。')}
        </section>
        ${renderMemoryDetail(selected, memoryDetail)}
      </div>
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
            <label class="aux-setting"><span><strong>定量存储</strong><small>按累计文本改动量保存，当前累计 ${counts.format(changes)} 字。</small></span><input name="volumeEnabled" type="checkbox"${settings.volumeEnabled ? ' checked' : ''}></label>
            <label class="aux-number"><span>累计</span><input name="characterThreshold" type="number" min="1" max="1000000" required value="${esc(settings.characterThreshold ?? 5000)}" aria-label="自动保存累计文本改动量"><span>字改动后保存</span></label>
          </fieldset>
          <button class="btn primary" type="submit">保存设置</button>
        </form>
      </section>
    </div>
  </section>`;
}
