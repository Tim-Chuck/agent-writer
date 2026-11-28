export const providerPresets = [
  {
    id: 'openai',
    name: 'OpenAI',
    website: 'https://openai.com/',
    keyUrl: 'https://platform.openai.com/api-keys',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-5.4-mini',
    protocol: 'chat',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    website: 'https://www.anthropic.com/',
    keyUrl: 'https://platform.claude.com/settings/keys',
    endpoint: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-5-5',
    protocol: 'messages',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    website: 'https://ai.google.dev/',
    keyUrl: 'https://aistudio.google.com/apikey',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    model: 'gemini-4-hydrogen',
    protocol: 'chat',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    website: 'https://www.deepseek.com/',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    endpoint: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-flash',
    protocol: 'chat',
  },
  {
    id: 'qwen',
    name: '通义千问（阿里云百炼）',
    website: 'https://bailian.console.aliyun.com/',
    keyUrl: 'https://www.alibabacloud.com/help/model-studio/get-api-key',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen-plus',
    protocol: 'chat',
  },
  {
    id: 'kimi',
    name: 'Kimi（月之暗面）',
    website: 'https://platform.kimi.com/',
    keyUrl: 'https://platform.kimi.com/docs/get-api-key',
    endpoint: 'https://api.moonshot.cn/v1/chat/completions',
    model: 'kimi-k3.1-pro',
    protocol: 'chat',
  },
  {
    id: 'custom',
    name: '自定义供应商',
    website: '',
    keyUrl: '',
    endpoint: '',
    model: '',
    protocol: 'chat',
  },
];

const REQUEST_TIMEOUT_MS = 120_000;
const ERROR_BODY_LIMIT = 16 * 1024;
const completionTokenLimitHosts = new Set(['api.openai.com', 'api.moonshot.cn', 'api.moonshot.ai']);
const routes = { chat: '/chat/completions', messages: '/messages', responses: '/responses' };
const customActions = new Set(['completions', 'generate', 'invoke', 'predict', 'infer']);
const deepSeekDisplayModels = {
  'deepseek v4.1 flash': 'deepseek-flash',
  'deepseek-v4.1-flash': 'deepseek-flash',
  'deepseek-v4.1-flash-1017': 'deepseek-flash',
  'deepseek v4 pro': 'deepseek-v4-pro',
};

const statusMessages = {
  400: ['invalid_request', '模型服务拒绝了请求。请核对接口协议、模型 ID 和模型支持的输入长度。'],
  401: ['invalid_key', 'API Key 验证失败。请检查密钥是否正确或已经过期。'],
  402: ['insufficient_credits', '模型服务账户需要充值或开通可用额度。'],
  403: ['access_denied', 'API Key 无权访问这个模型。请核对账户权限、模型与服务地区。'],
  404: ['endpoint_or_model_not_found', '模型服务未找到请求地址或模型。请核对 API 地址、接口协议和模型 ID。'],
  405: ['invalid_endpoint', '这个地址不接受模型请求。请核对供应商的 API 基础地址或完整请求地址。'],
  413: ['input_too_long', '服务端限制了请求体大小（HTTP 413）。可以分批读取原文后再继续。'],
  422: ['invalid_request', '模型服务无法处理请求。请核对接口协议和模型 ID。'],
  429: ['rate_limited', '模型服务当前限流或额度不足。请稍后重试，或到供应商后台查看额度。'],
};

const modelNotFound = ['model_not_found', '供应商未找到这个模型，或当前 API Key 无权使用它。请核对模型 ID 和账号权限。'];
const upstreamIssues = {
  model_not_found: modelNotFound,
  invalid_model: modelNotFound,
  insufficient_quota: statusMessages[402],
  insufficient_balance: statusMessages[402],
  billing_hard_limit_reached: statusMessages[402],
  context_length_exceeded: ['context_length_exceeded', '这次请求超过模型的上下文窗口。请核对 API 设置里的模型窗口，或让助手先分批查找原文。'],
  rate_limit_exceeded: statusMessages[429],
};

export class ProviderError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

function parseEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new ProviderError('invalid_endpoint', '请输入 API 基础地址或完整请求地址，例如 https://api.example.com/v1。');
  }

  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && (url.protocol !== 'http:' || !isLocal)) {
    throw new ProviderError('invalid_endpoint', '远程模型服务需要 HTTPS。本机服务可以使用 localhost、127.0.0.1 或 [::1] 的 HTTP 地址。');
  }
  if (url.username || url.password || url.hash) {
    throw new ProviderError('invalid_endpoint', 'API 请求地址不能包含用户名、密码或片段。请把密钥填入 API Key 栏。');
  }
  return url;
}

export function normalizeProviderEndpoint(endpoint, protocol = 'chat') {
  const url = parseEndpoint(endpoint);
  if (!Object.hasOwn(routes, protocol)) throw new ProviderError('invalid_protocol', '请选择有效的模型接口协议。');

  const path = url.pathname.replace(/\/+$/, '');
  const explicit = Object.keys(routes).find(kind => path.endsWith(routes[kind]));
  if (explicit) {
    url.pathname = path;
    return { endpoint: url.href, protocol: explicit };
  }
  if (customActions.has(path.split('/').at(-1))) return { endpoint: url.href, protocol };

  let prefix = path || '/v1';
  if (url.hostname === 'api.deepseek.com') {
    if (protocol === 'messages' && (!path || path === '/anthropic')) prefix = '/anthropic/v1';
    else if (!path) prefix = '';
  }
  if (url.hostname === 'generativelanguage.googleapis.com' && protocol === 'chat' && (!path || path === '/v1beta')) {
    prefix = '/v1beta/openai';
  }
  if (!path && url.hostname === 'dashscope.aliyuncs.com' && protocol === 'chat') prefix = '/compatible-mode/v1';
  url.pathname = prefix + routes[protocol];
  return { endpoint: url.href, protocol };
}

export function normalizeProviderModel(model, endpoint) {
  const name = typeof model === 'string' ? model.trim() : '';
  const url = URL.parse(endpoint);
  if (url?.hostname !== 'api.deepseek.com') return name;
  const displayName = name.toLowerCase();
  return Object.hasOwn(deepSeekDisplayModels, displayName) ? deepSeekDisplayModels[displayName] : name;
}

function readText(content, type = 'text') {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part?.type === type && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function readResponsesText(data) {
  const shortcut = readText(data?.output_text);
  if (shortcut) return shortcut;
  if (!Array.isArray(data?.output)) return '';
  return data.output.filter(item => item?.type === 'message')
    .map(item => readText(item.content, 'output_text')).filter(Boolean).join('\n');
}

function makeRequest(url, protocol, model, key, { system, prompt, maxTokens }) {
  const headers = { 'Content-Type': 'application/json' };
  const tokenLimit = Number.isSafeInteger(maxTokens) && maxTokens > 0 ? maxTokens : undefined;
  const body = { model, stream: false };

  if (protocol === 'messages') {
    body.messages = [{ role: 'user', content: prompt }];
    if (system) body.system = system;
    body.max_tokens = tokenLimit ?? 4096;
    headers['anthropic-version'] = '2023-06-01';
    if (key) headers['x-api-key'] = key;
    return { headers, body };
  }

  if (key) headers.Authorization = `Bearer ${key}`;
  if (protocol === 'responses') {
    body.input = prompt;
    if (system) body.instructions = system;
    if (tokenLimit) body.max_output_tokens = tokenLimit;
    if (url.hostname === 'api.openai.com') body.store = false;
  } else {
    body.messages = [{ role: 'user', content: prompt }];
    if (system) body.messages.unshift({ role: 'system', content: system });
    if (tokenLimit) {
      const tokenField = completionTokenLimitHosts.has(url.hostname) ? 'max_completion_tokens' : 'max_tokens';
      body[tokenField] = tokenLimit;
    }
  }
  return { headers, body };
}

async function readErrorBody(response) {
  if (!response.body) return null;
  const decoder = new TextDecoder();
  let size = 0;
  let content = '';
  try {
    for await (const value of response.body) {
      size += value.byteLength;
      if (size > ERROR_BODY_LIMIT) return null;
      content += decoder.decode(value, { stream: true });
    }
    return JSON.parse(content + decoder.decode());
  } catch {
    return null;
  }
}

function upstreamIssue(data) {
  const detail = data?.error;
  const code = [detail?.code, detail?.type, data?.code].find(value => typeof value === 'string' && Object.hasOwn(upstreamIssues, value));
  if (code) return upstreamIssues[code];
  if (typeof detail?.message === 'string' && /maximum context length|context (?:window|length) (?:is )?exceed|exceeds (?:the )?(?:model\b.*? )?(?:context window|context length)/i.test(detail.message)) {
    return upstreamIssues.context_length_exceeded;
  }
  if (typeof detail?.message === 'string' && /^model not exists?[.!]?$/i.test(detail.message.trim())) return modelNotFound;
  return null;
}

const timeoutError = timeoutMs => new ProviderError('timeout', `等待模型服务超过 ${Math.round(timeoutMs / 1000)} 秒。${
  timeoutMs > REQUEST_TIMEOUT_MS ? '可以分批查阅资料后继续。' : '可在「阅读范围」开启深读后重试。'}`);

function addTools(body, protocol, url, tools, steps) {
  if (protocol === 'responses') {
    body.tools = tools.map(tool => ({ type: 'function', ...tool, strict: false }));
    if (url.hostname === 'api.openai.com') body.include = ['reasoning.encrypted_content'];
    body.input = [{ role: 'user', content: body.input }];
    for (const { output, results } of steps) {
      body.input.push(...output, ...results.map(({ id, content }) => ({ type: 'function_call_output', call_id: id, output: content })));
    }
  } else if (protocol === 'messages') {
    body.tools = tools.map(({ name, description, parameters }) => ({ name, description, input_schema: parameters }));
    for (const { output, results } of steps) {
      body.messages.push({ role: 'assistant', content: output }, {
        role: 'user', content: results.map(({ id, content }) => ({ type: 'tool_result', tool_use_id: id, content })),
      });
    }
  } else {
    body.tools = tools.map(tool => ({ type: 'function', function: tool }));
    for (const { output, results } of steps) {
      body.messages.push(output, ...results.map(({ id, content }) => ({ role: 'tool', tool_call_id: id, content })));
    }
  }
}

function readToolTurn(data, protocol) {
  if (protocol === 'responses') {
    const output = Array.isArray(data?.output) ? data.output : [];
    return { output, calls: output.filter(item => item.type === 'function_call')
      .map(item => ({ id: item.call_id, name: item.name, args: item.arguments })) };
  }
  if (protocol === 'messages') {
    const output = Array.isArray(data?.content) ? data.content : [];
    return { output, calls: output.filter(item => item.type === 'tool_use')
      .map(item => ({ id: item.id, name: item.name, args: item.input })) };
  }
  const message = data?.choices?.[0]?.message;
  const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  const output = { role: 'assistant', content: message?.content ?? null, tool_calls: calls };
  if (typeof message?.reasoning_content === 'string') output.reasoning_content = message.reasoning_content;
  return { output, calls: calls.map(item => ({ id: item.id, name: item.function?.name, args: item.function?.arguments })) };
}

export async function callProvider({ endpoint, model, protocol, key }, {
  system = '', prompt, maxTokens, signal: cancellation, tools, steps = [], timeoutMs = REQUEST_TIMEOUT_MS,
}) {
  const request = normalizeProviderEndpoint(endpoint, protocol);
  const url = new URL(request.endpoint);
  const modelId = normalizeProviderModel(model, url);
  const apiKey = typeof key === 'string' ? key.trim() : '';
  if (!modelId) throw new ProviderError('invalid_model', '请选择或填写模型 ID。');
  if (typeof prompt !== 'string' || !prompt.trim()) throw new ProviderError('invalid_prompt', '请输入要交给模型的内容。');
  const { headers, body } = makeRequest(url, request.protocol, modelId, apiKey, { system, prompt, maxTokens });
  if (tools) addTools(body, request.protocol, url, tools, steps);

  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = cancellation ? AbortSignal.any([timeout, cancellation]) : timeout;
  let response;
  try {
    response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'manual', signal });
  } catch {
    if (signal.aborted) throw timeoutError(timeoutMs);
    throw new ProviderError('network_error', '无法连接模型服务。请检查网络、API 地址和本机模型服务是否已启动。');
  }

  if (!response.ok) {
    const { status } = response;
    if (status >= 300 && status < 400) {
      await response.body?.cancel().catch(() => {});
      throw new ProviderError('redirect', '模型服务返回了跳转。请改用请求实际到达的完整 API 地址。', status);
    }
    if (status >= 500) {
      await response.body?.cancel().catch(() => {});
      throw new ProviderError('service_unavailable', `模型服务暂时不可用（HTTP ${status}）。请稍后重试。`, status);
    }
    const issue = upstreamIssue(await readErrorBody(response));
    const [code, message] = issue ?? statusMessages[status] ?? ['upstream_error', `模型服务返回了错误（HTTP ${status}）。请核对配置后重试。`];
    throw new ProviderError(code, message, status);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    if (signal.aborted) throw timeoutError(timeoutMs);
    throw new ProviderError('invalid_response', '服务返回了无法读取的内容。请确认填写的是模型 API 地址。');
  }

  if (data?.error || data?.status === 'failed') {
    const [code, message] = upstreamIssue(data) ?? ['upstream_error', '模型服务报告请求失败。请核对 API 设置和账号额度。'];
    throw new ProviderError(code, message, response.status);
  }
  const completion = data?.choices?.[0];
  const text = request.protocol === 'responses'
    ? readResponsesText(data)
    : readText(request.protocol === 'messages' ? data?.content : completion?.message?.content);
  const truncated = completion?.finish_reason === 'length' || data?.stop_reason === 'max_tokens' ||
    data?.incomplete_details?.reason === 'max_output_tokens';
  const turn = tools ? readToolTurn(data, request.protocol) : null;
  if (turn?.calls.length) {
    if (turn.calls.some(call => typeof call.id !== 'string' || !call.id || typeof call.name !== 'string') ||
        new Set(turn.calls.map(call => call.id)).size !== turn.calls.length) {
      throw new ProviderError('invalid_tool_call', '模型返回的工具调用格式不完整。');
    }
    return { text, truncated, ...turn };
  }
  if (!text) {
    if (truncated) {
      throw new ProviderError('output_limit', '模型在输出文字前用完了应答额度。请提高输出上限或缩短本次内容。');
    }
    if (completion?.finish_reason === 'content_filter' || data?.incomplete_details?.reason === 'content_filter') {
      throw new ProviderError('content_filtered', '供应商没有返回文字，请调整创作请求后重试。');
    }
    throw new ProviderError('empty_response', '模型没有返回可用的文字。请确认模型支持文字生成并选择对应的接口协议。');
  }
  return turn ? { text, truncated, ...turn } : text;
}
