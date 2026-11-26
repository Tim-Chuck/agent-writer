import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { callProvider, normalizeProviderEndpoint, normalizeProviderModel, ProviderError } from '../lib/providers.mjs';

test('normalizes saved base URLs, vendor paths, explicit routes and legacy custom actions', () => {
  assert.deepEqual(normalizeProviderEndpoint('https://api.deepseek.com/'), {
    endpoint: 'https://api.deepseek.com/chat/completions', protocol: 'chat',
  });
  assert.deepEqual(normalizeProviderEndpoint('https://api.deepseek.com/anthropic', 'messages'), {
    endpoint: 'https://api.deepseek.com/anthropic/v1/messages', protocol: 'messages',
  });
  assert.deepEqual(normalizeProviderEndpoint('https://api.deepseek.com', 'responses'), {
    endpoint: 'https://api.deepseek.com/responses', protocol: 'responses',
  });
  assert.deepEqual(normalizeProviderEndpoint('https://api.example.com/v1/?api-version=1'), {
    endpoint: 'https://api.example.com/v1/chat/completions?api-version=1', protocol: 'chat',
  });
  assert.deepEqual(normalizeProviderEndpoint('https://api.example.com/tenant/v1', 'responses'), {
    endpoint: 'https://api.example.com/tenant/v1/responses', protocol: 'responses',
  });
  assert.deepEqual(normalizeProviderEndpoint('https://generativelanguage.googleapis.com/v1beta/openai/'), {
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', protocol: 'chat',
  });
  assert.deepEqual(normalizeProviderEndpoint('https://api.example.com/tenant/v1/responses/', 'chat'), {
    endpoint: 'https://api.example.com/tenant/v1/responses', protocol: 'responses',
  });
  assert.deepEqual(normalizeProviderEndpoint('https://api.example.com/tenant/v1/messages', 'responses'), {
    endpoint: 'https://api.example.com/tenant/v1/messages', protocol: 'messages',
  });
  assert.deepEqual(normalizeProviderEndpoint('https://api.example.com/tenant/v1/chat/completions', 'messages'), {
    endpoint: 'https://api.example.com/tenant/v1/chat/completions', protocol: 'chat',
  });
  assert.deepEqual(normalizeProviderEndpoint('https://api.example.com/legacy/generate/', 'messages'), {
    endpoint: 'https://api.example.com/legacy/generate/', protocol: 'messages',
  });
  assert.deepEqual(normalizeProviderEndpoint('http://[::1]:11434'), {
    endpoint: 'http://[::1]:11434/v1/chat/completions', protocol: 'chat',
  });
  assert.throws(() => normalizeProviderEndpoint('http://api.example.com/v1'), { code: 'invalid_endpoint' });
  assert.throws(() => normalizeProviderEndpoint('https://user:secret@api.example.com/v1'), error => (
    error.code === 'invalid_endpoint' && !error.message.includes('secret')
  ));
  assert.throws(() => normalizeProviderEndpoint('https://api.example.com/v1', 'unknown'), { code: 'invalid_protocol' });
});

test('normalizes known DeepSeek display names on the official host only', () => {
  assert.equal(normalizeProviderModel(' DeepSeek V4.1 Flash ', 'https://api.deepseek.com/'), 'deepseek-flash');
  assert.equal(normalizeProviderModel('DeepSeek-V4.1-Flash-1017', 'https://api.deepseek.com/v1'), 'deepseek-flash');
  assert.equal(normalizeProviderModel('DeepSeek V4 Pro', 'https://api.deepseek.com/'), 'deepseek-v4-pro');
  assert.equal(normalizeProviderModel('deepseek-v4-flash', 'https://api.deepseek.com/'), 'deepseek-v4-flash');
  assert.equal(normalizeProviderModel('DeepSeek V4.1 Flash', 'https://api.example.com/v1'), 'DeepSeek V4.1 Flash');
});

test('uses each protocol envelope at the correct normalized path', async t => {
  const requests = [];
  const mock = createServer(async (req, res) => {
    let json = '';
    for await (const chunk of req) json += chunk;
    requests.push({ path: req.url, headers: req.headers, body: JSON.parse(json) });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/responses') {
      res.end(JSON.stringify({ output: [
        { type: 'reasoning', content: [{ type: 'output_text', text: 'hidden' }] },
        { type: 'message', role: 'assistant', content: [
          { type: 'refusal', refusal: 'ignored' }, { type: 'output_text', text: '第一段。' }, { type: 'output_text', text: '第二段。' },
        ] },
      ] }));
    } else if (req.url === '/v1/messages') {
      res.end(JSON.stringify({ content: [{ type: 'thinking', thinking: 'hidden' }, { type: 'text', text: '连上了。' }] }));
    } else {
      res.end(JSON.stringify({ choices: [{ message: { reasoning_content: 'hidden', content: '连接成功。' } }] }));
    }
  });
  mock.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => mock.close(resolve)));
  await once(mock, 'listening');
  const origin = `http://127.0.0.1:${mock.address().port}`;
  const input = { system: '使用中文。', prompt: '你好。', maxTokens: 512 };
  const provider = { model: 'local-example', key: 'fake-local-key' };

  assert.equal(await callProvider({ ...provider, endpoint: `${origin}/v1`, protocol: 'chat' }, input), '连接成功。');
  assert.equal(requests[0].path, '/v1/chat/completions');
  assert.equal(requests[0].headers.authorization, 'Bearer fake-local-key');
  assert.deepEqual(requests[0].body.messages, [{ role: 'system', content: input.system }, { role: 'user', content: input.prompt }]);

  assert.equal(await callProvider({ ...provider, endpoint: `${origin}/v1/messages`, protocol: 'chat' }, input), '连上了。');
  assert.equal(requests[1].path, '/v1/messages');
  assert.equal(requests[1].headers['x-api-key'], 'fake-local-key');
  assert.equal(requests[1].headers['anthropic-version'], '2023-06-01');
  assert.equal(requests[1].body.max_tokens, 512);

  assert.equal(await callProvider({ ...provider, endpoint: `${origin}/v1`, protocol: 'responses' }, input), '第一段。\n第二段。');
  assert.equal(requests[2].path, '/v1/responses');
  assert.equal(requests[2].headers.authorization, 'Bearer fake-local-key');
  assert.deepEqual(requests[2].body, {
    model: 'local-example', input: input.prompt, instructions: input.system, max_output_tokens: 512, stream: false,
  });
});

test('sends the verified DeepSeek ID and keeps sanitized provider failures actionable', async t => {
  const key = 'fake-reflected-secret';
  let request;
  let reply = () => new Response(JSON.stringify({ choices: [{ message: { content: '正常。' } }] }));
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    request = { url: url.href, options };
    return reply();
  });
  const input = { prompt: '写一段正文。' };
  const provider = { endpoint: 'https://api.deepseek.com/', model: 'DeepSeek V4.1 Flash', protocol: 'chat', key };
  assert.equal(await callProvider(provider, input), '正常。');
  assert.equal(request.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(JSON.parse(request.options.body).model, 'deepseek-flash');
  assert.equal(request.options.redirect, 'manual');

  reply = () => new Response(JSON.stringify({ error: { code: 'model_not_found', message: key } }), { status: 404 });
  await assert.rejects(callProvider(provider, input), error => (
    error instanceof ProviderError && error.code === 'model_not_found' && error.status === 404 && !error.message.includes(key)
  ));

  reply = () => new Response(JSON.stringify({ error: { code: 'insufficient_quota', message: key } }), { status: 429 });
  await assert.rejects(callProvider(provider, input), { code: 'insufficient_credits', status: 429 });

  reply = () => new Response(JSON.stringify({ error: { message: key } }), { status: 401 });
  await assert.rejects(callProvider(provider, input), error => error.code === 'invalid_key' && !error.message.includes(key));

  reply = () => new Response(null, { status: 307, headers: { Location: 'https://other.example.com/' } });
  await assert.rejects(callProvider(provider, input), { code: 'redirect', status: 307 });

  reply = () => new Response(JSON.stringify({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }));
  await assert.rejects(callProvider({ ...provider, protocol: 'responses' }, input), { code: 'output_limit' });
});
