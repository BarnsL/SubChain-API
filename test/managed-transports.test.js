import test from 'node:test';
import assert from 'node:assert/strict';
import { Cooldowns, dispatch } from '../src/chain.js';
import { QuotaTracker } from '../src/quota.js';
import { chainStatus } from '../src/config.js';
import {
  codexQuotaBuckets,
  createManagedTransports,
  messagesToTranscript,
  resolveCodexCommand,
} from '../src/managed-transports.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function deviceCodeRpc({ account = null, expiresAt = 901_000, onLoginStart } = {}) {
  const calls = [];
  const listeners = new Map();
  let closed = 0;
  const rpc = {
    calls,
    get closed() { return closed; },
    emit(method, params) { listeners.get(method)?.(params); },
    async request(method, params) {
      calls.push({ method, params });
      if (method === 'account/read') return { account, requiresOpenaiAuth: true };
      if (method === 'account/login/start') {
        const result = {
          type: 'chatgptDeviceCode',
          loginId: 'login-1',
          verificationUrl: 'https://auth.openai.com/codex/device',
          userCode: 'ABCD-1234',
          expiresAt,
          accessToken: 'never-returned',
        };
        onLoginStart?.(rpc, result);
        return result;
      }
      if (method === 'account/login/cancel') return {};
      throw new Error(`unexpected ${method}`);
    },
    subscribe(method, listener) { listeners.set(method, listener); return () => listeners.delete(method); },
    close() { closed += 1; },
  };
  return rpc;
}

test('managed ChatGPT login returns a sanitized ready snapshot for an existing subscription', async () => {
  const rpc = deviceCodeRpc({
    account: { type: 'chatgpt', planType: 'plus', email: 'private-at-example.invalid', accessToken: 'never-returned' },
  });
  const managed = createManagedTransports({ codexConnect: async () => rpc });

  const snapshot = await managed.startLogin('codex-app-server');

  assert.deepEqual(snapshot, { status: 'ready' });
  assert.equal(JSON.stringify(snapshot).includes('private-at-example.invalid'), false);
  assert.equal(JSON.stringify(snapshot).includes('accessToken'), false);
  assert.deepEqual(rpc.calls.map((call) => call.method), ['account/read']);
  assert.equal(rpc.closed, 1);
});

test('managed ChatGPT device-code login reuses a pending session and completes only for its matching notification', async () => {
  const rpc = deviceCodeRpc();
  const managed = createManagedTransports({ codexConnect: async () => rpc, now: () => 900_000 });

  const pending = await managed.startLogin('codex-app-server');
  assert.deepEqual(pending, {
    status: 'pending',
    verificationUrl: 'https://auth.openai.com/codex/device',
    userCode: 'ABCD-1234',
    expiresAt: 901_000,
  });
  assert.equal(JSON.stringify(pending).includes('accessToken'), false);
  assert.deepEqual(await managed.startLogin('codex-app-server'), pending);
  assert.equal(rpc.calls.filter((call) => call.method === 'account/login/start').length, 1);

  rpc.emit('account/login/completed', { loginId: 'other-login', success: true, error: null });
  assert.deepEqual(managed.loginStatus('codex-app-server'), pending);

  rpc.emit('account/login/completed', { loginId: 'login-1', success: true, error: null, accountId: 'private-account' });
  assert.deepEqual(managed.loginStatus('codex-app-server'), { status: 'ready' });
  assert.equal(rpc.closed, 1);
});

test('managed ChatGPT login immediately expires stale device instructions and clears them', async () => {
  const rpc = deviceCodeRpc({ expiresAt: 901_000 });
  const managed = createManagedTransports({ codexConnect: async () => rpc, now: () => 901_000 });

  const snapshot = await managed.startLogin('codex-app-server');

  assert.deepEqual(snapshot, { status: 'expired' });
  assert.deepEqual(managed.loginStatus('codex-app-server'), { status: 'expired' });
  assert.equal(rpc.closed, 1);
});

test('managed ChatGPT login keeps a completion emitted with its start response', async () => {
  const rpc = deviceCodeRpc({
    onLoginStart(client, result) {
      client.emit('account/login/completed', { loginId: result.loginId, success: true, error: null });
    },
  });
  const managed = createManagedTransports({ codexConnect: async () => rpc, now: () => 900_000 });

  const snapshot = await managed.startLogin('codex-app-server');

  assert.deepEqual(snapshot, { status: 'ready' });
  assert.deepEqual(managed.loginStatus('codex-app-server'), { status: 'ready' });
  assert.equal(rpc.closed, 1);
});

test('managed ChatGPT login cancellation drops the device code and closes the app server', async () => {
  const rpc = deviceCodeRpc();
  const managed = createManagedTransports({ codexConnect: async () => rpc, now: () => 900_000 });

  await managed.startLogin('codex-app-server');
  const cancelled = await managed.cancelLogin('codex-app-server');

  assert.deepEqual(cancelled, { status: 'cancelled' });
  assert.deepEqual(managed.loginStatus('codex-app-server'), { status: 'cancelled' });
  assert.deepEqual(rpc.calls.at(-1), { method: 'account/login/cancel', params: { loginId: 'login-1' } });
  assert.equal(rpc.closed, 1);
});

test('Codex Ping rejects an API-key account because it is not subscription-backed', async () => {
  const rpc = deviceCodeRpc({ account: { type: 'apiKey', apiKey: 'never-returned' } });
  const managed = createManagedTransports({ codexConnect: async () => rpc });

  await assert.rejects(managed.ping('codex-app-server'), /ChatGPT subscription/i);
  assert.deepEqual(rpc.calls.map((call) => call.method), ['account/read']);
  assert.equal(rpc.closed, 1);
});

test('Codex account probing keeps plan, models, quotas, and usage but drops identity fields', async () => {
  const calls = [];
  const rpc = {
    async initialize() {},
    async request(method) {
      calls.push(method);
      if (method === 'account/read') return {
        account: { type: 'chatgpt', email: 'private-at-example.invalid', planType: 'plus' },
        requiresOpenaiAuth: true,
      };
      if (method === 'model/list') return {
        data: [{ id: 'gpt-test', displayName: 'GPT Test', inputModalities: ['text'], hidden: false }],
      };
      if (method === 'account/rateLimits/read') return {
        rateLimitsByLimitId: {
          codex: { limitId: 'codex', primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 2_000 } },
        },
      };
      if (method === 'account/usage/read') return { summary: { lifetimeTokens: 42 } };
      throw new Error(`unexpected ${method}`);
    },
    close() {},
  };
  const managed = createManagedTransports({ codexConnect: async () => rpc });

  const snapshot = await managed.ping('codex-app-server', 'openai-codex');

  assert.deepEqual(calls, ['account/read', 'model/list', 'account/rateLimits/read', 'account/usage/read']);
  assert.equal(snapshot.plan, 'plus');
  assert.equal(snapshot.models[0].id, 'gpt-test');
  assert.equal(snapshot.quotas[0].usedPercent, 25);
  assert.equal(snapshot.usage.lifetimeTokens, 42);
  assert.equal(JSON.stringify(snapshot).includes('private-at-example.invalid'), false);
});

test('Codex quota conversion preserves every rate-limit bucket', () => {
  assert.deepEqual(codexQuotaBuckets({
    rateLimitsByLimitId: {
      codex: { limitId: 'codex', limitName: 'Primary', primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 10 } },
      other: { limitId: 'other', secondary: { usedPercent: 90, windowDurationMins: 60, resetsAt: 20 } },
    },
  }).map((bucket) => [bucket.id, bucket.usedPercent, bucket.resetsAt]), [
    ['codex:primary', 10, 10_000],
    ['other:secondary', 90, 20_000],
  ]);
});

test('managed provider links dispatch without pretending an OAuth token is an API key', async () => {
  const requests = [];
  const managedTransports = {
    has: (name) => name === 'codex-app-server',
    async request(transport, link, body) {
      requests.push({ transport, link, body });
      return new Response(JSON.stringify({
        id: 'chatcmpl-local', object: 'chat.completion', model: link.model,
        choices: [{ index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };
  const scope = {
    settings: { mode: 'chain', maxAttempts: 1, requestTimeoutMs: 1_000, providerThresholds: {}, fallbackThresholdPercent: 95 },
    links: [{ index: 0, provider: 'openai-codex', model: 'gpt-test', transport: 'codex-app-server' }],
  };

  const result = await dispatch(scope, new Cooldowns(1_000), new QuotaTracker(), {
    model: 'auto', messages: [{ role: 'user', content: 'hi' }],
  }, { managedTransports });

  assert.equal(result.provider, 'openai-codex');
  assert.equal(requests[0].transport, 'codex-app-server');
  assert.equal('key' in requests[0], false);
});

test('message transcripts retain roles and forbid managed clients from invoking tools', () => {
  const transcript = messagesToTranscript([
    { role: 'system', content: 'Be concise.' },
    { role: 'user', content: 'Hello' },
  ]);
  assert.match(transcript, /SYSTEM:\nBe concise\./);
  assert.match(transcript, /USER:\nHello/);
  assert.match(transcript, /Do not invoke tools/i);
});

test('legacy chain status treats a supported managed runtime as a subscription lane', () => {
  const status = chainStatus({ links: [{
    index: 0,
    provider: 'openai-codex',
    model: 'gpt-test',
    transport: 'codex-app-server',
  }] });
  assert.equal(status[0].hasKey, true);
  assert.equal(status[0].managed, true);
});

test('Codex command discovery prefers a spawnable app-owned runtime without a user-specific path', () => {
  const localAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'subchain-codex-runtime-'));
  const runtime = path.join(localAppData, 'OpenAI', 'Codex', 'bin', 'build-id');
  fs.mkdirSync(runtime, { recursive: true });
  fs.writeFileSync(path.join(runtime, 'codex.exe'), 'fixture');
  assert.equal(resolveCodexCommand({ platform: 'win32', env: { LOCALAPPDATA: localAppData } }), path.join(runtime, 'codex.exe'));
});

test('Codex completions use the discovered read-only permission profile and delete the transient thread', async () => {
  const calls = [];
  const listeners = new Map();
  const rpc = {
    async request(method, params) {
      calls.push({ method, params });
      if (method === 'thread/start') return { thread: { id: 'transient-thread' } };
      if (method === 'turn/start') {
        listeners.get('item/completed')?.({ threadId: 'transient-thread', item: { type: 'agentMessage', text: 'done' } });
        return { turn: { id: 'turn-1' } };
      }
      return {};
    },
    subscribe(method, listener) { listeners.set(method, listener); return () => listeners.delete(method); },
    async waitFor() { return { threadId: 'transient-thread', turn: { status: 'completed' } }; },
    close() {},
  };
  const managed = createManagedTransports({ codexConnect: async () => rpc });
  const response = await managed.request('codex-app-server', { model: 'gpt-test' }, {
    messages: [{ role: 'user', content: 'hello' }], stream: false,
  });

  assert.equal((await response.json()).choices[0].message.content, 'done');
  const threadStart = calls.find((call) => call.method === 'thread/start').params;
  assert.equal(threadStart.permissions, ':read-only');
  assert.equal('sandbox' in threadStart, false);
  assert.equal('sandboxPolicy' in calls.find((call) => call.method === 'turn/start').params, false);
  assert.equal(calls.at(-1).method, 'thread/delete');
});

test('Antigravity model discovery parses its labelled tabular output into two quota families', async () => {
  const managed = createManagedTransports({
    commandRunner: async () => [
      'Fetching available models...',
      'gemini-test-high\tGemini Test (High)',
      'claude-test\tClaude Test',
      'gpt-test\tGPT Test',
    ].join('\n'),
  });
  const snapshot = await managed.ping('antigravity-cli');
  assert.deepEqual(snapshot.models.map((model) => [model.id, model.label, model.quotaFamily]), [
    ['gemini-test-high', 'Gemini Test (High)', 'google-models'],
    ['claude-test', 'Claude Test', 'third-party-models'],
    ['gpt-test', 'GPT Test', 'third-party-models'],
  ]);
  assert.deepEqual(snapshot.quotas.map((quota) => quota.id), ['google-models', 'third-party-models']);
});

test('Antigravity completions stay in sandboxed plan mode without auto-approval flags', async () => {
  const calls = [];
  const managed = createManagedTransports({
    commandRunner: async (command, args) => {
      calls.push({ command, args });
      return JSON.stringify({ result: 'done', usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 } });
    },
  });
  const response = await managed.request('antigravity-cli', { model: 'gemini-test-low' }, {
    messages: [{ role: 'user', content: 'hello' }], stream: false,
  });
  const payload = await response.json();
  assert.equal(payload.choices[0].message.content, 'done');
  assert.deepEqual(payload.usage, { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 });
  assert.equal(calls[0].args.includes('--sandbox'), true);
  assert.deepEqual(calls[0].args.slice(calls[0].args.indexOf('--mode'), calls[0].args.indexOf('--mode') + 2), ['--mode', 'plan']);
  assert.equal(calls[0].args.includes('--dangerously-skip-permissions'), false);
  assert.equal(calls[0].args.includes('--disable-slash-commands'), false);
});

test('Antigravity quota failures become a sanitized family-specific 429 response', async () => {
  const managed = createManagedTransports({
    commandRunner: async () => JSON.stringify({
      conversation_id: 'private-conversation-id',
      status: 'ERROR',
      response: '',
      error: 'Individual quota reached. Resets in 2h3m.',
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    }),
  });
  const response = await managed.request('antigravity-cli', { model: 'gemini-test-low' }, {
    messages: [{ role: 'user', content: 'hello' }], stream: false,
  });
  const payload = await response.json();
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('x-subchain-quota-family'), 'google-models');
  assert.match(payload.error.message, /quota reached/i);
  assert.equal(JSON.stringify(payload).includes('private-conversation-id'), false);
});

test('managed quota failures update the exact account and quota family during dispatch', async () => {
  const quota = new QuotaTracker();
  const managedTransports = {
    has: () => true,
    async request() {
      return new Response(JSON.stringify({ error: { message: 'quota reached' } }), {
        status: 429,
        headers: { 'x-subchain-quota-family': 'google-models' },
      });
    },
  };
  const scope = {
    settings: { mode: 'chain', maxAttempts: 1, requestTimeoutMs: 1_000, providerThresholds: {}, fallbackThresholdPercent: 95 },
    links: [{ index: 0, provider: 'google-antigravity', model: 'gemini-test', transport: 'antigravity-cli' }],
  };
  await assert.rejects(
    dispatch(scope, new Cooldowns(1_000), quota, { model: 'auto', messages: [{ role: 'user', content: 'hi' }] }, { managedTransports }),
    /candidate.*failed/i,
  );
  assert.deepEqual(quota.get('google-antigravity').quotas.map((bucket) => [bucket.id, bucket.status]), [
    ['google-models', 'exhausted'],
  ]);
});
