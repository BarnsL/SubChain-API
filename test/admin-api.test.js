import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSecretStore } from '../src/storage.js';
import { createRoutingRuntime } from '../src/routing.js';
import { QuotaTracker } from '../src/quota.js';
import { createServer, isLoopbackAddress } from '../src/server.js';

function runtime() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subchain-admin-api-'));
  const secretStore = createSecretStore({ dataDir });
  secretStore.set('local-key:default', 'default-token');
  const value = createRoutingRuntime({
    secretStore,
    routing: {
      schemaVersion: 2,
      chains: [{ id: 'default', name: 'Default', migrated: true, links: [{ provider: 'google', model: 'gemini-example' }] }],
      localKeys: [{ id: 'default', name: 'Default', secretRef: 'local-key:default', target: { type: 'chain', id: 'default' } }],
    },
  });
  value.presetDataDir = dataDir;
  fs.mkdirSync(path.join(dataDir, 'presets', 'fixture'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'presets', 'fixture', 'sample.md'), 'fixture preset body', 'utf8');
  fs.writeFileSync(path.join(dataDir, 'presets', 'fixture', 'manifest.json'), JSON.stringify({
    source: 'fixture', repository: 'https://example.invalid/fixture', revision: 'test', fileCount: 1,
    files: [{ path: 'sample.md' }],
  }), 'utf8');
  fs.writeFileSync(path.join(dataDir, 'presets', 'index.json'), JSON.stringify({
    schemaVersion: 1, sources: [{ source: 'fixture', fileCount: 1 }],
  }), 'utf8');
  return value;
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('admin state exposes routing metadata but never local tokens', async () => {
  const server = createServer(runtime(), new QuotaTracker(), { ui: true });
  const port = await listen(server);
  try {
    const state = await fetch(`http://127.0.0.1:${port}/admin/state`);
    assert.equal(state.status, 200);
    assert.equal(state.headers.get('cache-control'), 'no-store');
    const payload = await state.json();
    assert.equal(payload.localKeys[0].id, 'default');
    assert.equal(JSON.stringify(payload).includes('default-token'), false);
    assert.deepEqual(payload.journal, {
      persistence: 'memory-only',
      maxEntries: 500,
      rotateAtBytes: 5 * 1024 * 1024,
      predecessors: 1,
    });

    const created = await fetch(`http://127.0.0.1:${port}/admin/local-keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Zhipu only', target: { type: 'provider', id: 'zhipu' } }),
    });
    assert.equal(created.status, 201);
    const createdPayload = await created.json();
    assert.match(createdPayload.key, /^sc-/);
    assert.equal(createdPayload.localKey.target.id, 'zhipu');
  } finally {
    await close(server);
  }
});

test('admin routes are limited to loopback peers', () => {
  assert.equal(typeof isLoopbackAddress, 'function', 'loopback classifier must exist');
  if (!isLoopbackAddress) return;
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('192.168.1.20'), false);
});

test('admin mutations reject cross-site and non-JSON browser requests', async () => {
  const server = createServer(runtime(), new QuotaTracker(), { ui: true });
  const port = await listen(server);
  try {
    const crossSite = await fetch(`http://127.0.0.1:${port}/admin/local-keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ name: 'Blocked', target: { type: 'provider', id: 'google' } }),
    });
    assert.equal(crossSite.status, 403);
    assert.equal(crossSite.headers.get('cache-control'), 'no-store');

    const simpleForm = await fetch(`http://127.0.0.1:${port}/admin/local-keys`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ name: 'Blocked', target: { type: 'provider', id: 'google' } }),
    });
    assert.equal(simpleForm.status, 415);
  } finally {
    await close(server);
  }
});

test('OpenAI Codex enrollment routes expose only managed login snapshots', async () => {
  const pending = {
    status: 'pending',
    verificationUrl: 'https://auth.openai.com/codex/device',
    userCode: 'ABCD-1234',
    expiresAt: 901_000,
    accessToken: 'never-returned',
    loginId: 'private-login',
    account: { email: 'private-at-example.invalid' },
    stderr: 'private diagnostic',
  };
  const calls = [];
  const managedTransports = {
    async startLogin(transport) {
      calls.push(['start', transport]);
      return pending;
    },
    loginStatus(transport) {
      calls.push(['status', transport]);
      return pending;
    },
    async cancelLogin(transport) {
      calls.push(['cancel', transport]);
      return { status: 'cancelled', loginId: 'private-login', accessToken: 'never-returned' };
    },
  };
  const server = createServer(runtime(), new QuotaTracker(), { ui: true, managedTransports });
  const port = await listen(server);
  const connectPath = `http://127.0.0.1:${port}/admin/providers/openai-codex/connect`;
  try {
    const started = await fetch(connectPath, {
      method: 'POST', headers: { 'content-type': 'application/json' },
    });
    assert.equal(started.status, 200);
    assert.equal(started.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await started.json(), {
      status: 'pending',
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-1234',
      expiresAt: 901_000,
    });

    const status = await fetch(connectPath);
    assert.equal(status.status, 200);
    assert.equal(status.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await status.json(), {
      status: 'pending',
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-1234',
      expiresAt: 901_000,
    });

    const cancelled = await fetch(`${connectPath}/cancel`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
    });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await cancelled.json(), { status: 'cancelled' });
    assert.deepEqual(calls, [
      ['start', 'codex-app-server'],
      ['status', 'codex-app-server'],
      ['cancel', 'codex-app-server'],
    ]);

    const otherProvider = await fetch(`http://127.0.0.1:${port}/admin/providers/google/connect`);
    assert.equal(otherProvider.status, 404);
  } finally {
    await close(server);
  }
});

test('OpenAI Codex enrollment rejects cross-site requests before starting login', async () => {
  let startCount = 0;
  const managedTransports = {
    async startLogin() {
      startCount += 1;
      return { status: 'pending' };
    },
  };
  const server = createServer(runtime(), new QuotaTracker(), { ui: true, managedTransports });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/admin/providers/openai-codex/connect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
    });
    assert.equal(response.status, 403);
    assert.equal(startCount, 0);
  } finally {
    await close(server);
  }
});

test('OpenAI Codex enrollment reports an unavailable managed service without caching', async () => {
  const server = createServer(runtime(), new QuotaTracker(), { ui: true });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/admin/providers/openai-codex/connect`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).error.message, 'Managed provider client is unavailable');
  } finally {
    await close(server);
  }
});

test('OpenAI Codex enrollment masks managed service failures without caching', async () => {
  const managedTransports = {
    async startLogin() {
      throw new Error('private transport failure');
    },
  };
  const server = createServer(runtime(), new QuotaTracker(), { ui: true, managedTransports });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/admin/providers/openai-codex/connect`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
    });
    assert.equal(response.status, 500);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const payload = await response.json();
    assert.equal(payload.error.message, 'Internal server error');
    assert.equal(JSON.stringify(payload).includes('private transport failure'), false);
  } finally {
    await close(server);
  }
});

test('provider account routes rename and manually Ping exactly one subscription', async () => {
  const value = runtime();
  const account = {
    providerId: 'google',
    name: 'Gemini Account 1',
    health: 'ready',
    models: [{ id: 'gemini-example', label: 'Gemini Example' }],
    quotas: [{ id: 'provider', label: 'Provider quota', status: 'unknown' }],
    observedUsage: { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  };
  const providerStatusStore = {
    get: (id) => id === 'google' ? account : null,
    rename: (id, name) => Object.assign(account, { providerId: id, name }),
  };
  let pingCount = 0;
  const providerProbeService = {
    isPinging: () => false,
    ping: async (id) => {
      pingCount += 1;
      assert.equal(id, 'google');
      return { health: 'ready', models: account.models, quotas: account.quotas };
    },
  };
  const server = createServer(value, new QuotaTracker(), { ui: true, providerStatusStore, providerProbeService });
  const port = await listen(server);
  try {
    const renamed = await fetch(`http://127.0.0.1:${port}/admin/providers/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Primary Gemini' }),
    });
    assert.equal(renamed.status, 200);
    assert.equal((await renamed.json()).account.name, 'Primary Gemini');

    const pinged = await fetch(`http://127.0.0.1:${port}/admin/providers/google/ping`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
    });
    assert.equal(pinged.status, 200);
    assert.equal((await pinged.json()).account.health, 'ready');
    assert.equal(pingCount, 1);

    const state = await (await fetch(`http://127.0.0.1:${port}/admin/state`)).json();
    const provider = state.providers.find((item) => item.id === 'google');
    assert.equal(provider.name, 'Primary Gemini');
    assert.deepEqual(provider.models.map((model) => model.id), ['gemini-example']);
  } finally {
    await close(server);
  }
});

test('the loopback admin API lists and reads only imported preset entries', async () => {
  const value = runtime();
  const harnessFile = path.join(value.presetDataDir, 'harness.json');
  const server = createServer(value, new QuotaTracker(), { ui: true, harnessFile });
  const port = await listen(server);
  try {
    const listed = await fetch(`http://127.0.0.1:${port}/admin/presets?query=sample`);
    assert.equal(listed.status, 200);
    const catalogue = await listed.json();
    assert.equal(catalogue.total, 1);

    const preview = await fetch(`http://127.0.0.1:${port}/admin/presets/read?id=${encodeURIComponent(catalogue.items[0].id)}`);
    assert.equal(preview.status, 200);
    assert.equal((await preview.json()).content, 'fixture preset body');

    const applied = await fetch(`http://127.0.0.1:${port}/admin/harness/preset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: catalogue.items[0].id, target: 'persona', mode: 'replace' }),
    });
    assert.equal(applied.status, 200);
    assert.equal((await applied.json()).harness.systemPrompts.persona, 'fixture preset body');
    assert.equal(JSON.parse(fs.readFileSync(harnessFile, 'utf8')).harnesses[0].components.persona, 'fixture preset body');
  } finally {
    await close(server);
  }
});

test('named Harnesses can mix preset components, attach to a local key, and cannot be deleted while assigned', async () => {
  const value = runtime();
  const harnessFile = path.join(value.presetDataDir, 'harness-library.json');
  const server = createServer(value, new QuotaTracker(), { ui: true, harnessFile });
  const port = await listen(server);
  try {
    const createdResponse = await fetch(`http://127.0.0.1:${port}/admin/harnesses`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Research Safe' }),
    });
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()).harness;

    const updatedResponse = await fetch(`http://127.0.0.1:${port}/admin/harnesses/${created.id}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ components: { identity: 'Research assistant' } }),
    });
    assert.equal((await updatedResponse.json()).harness.components.identity, 'Research assistant');

    const catalogue = await (await fetch(`http://127.0.0.1:${port}/admin/presets?query=sample`)).json();
    const applied = await fetch(`http://127.0.0.1:${port}/admin/harness/preset`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ harnessId: created.id, id: catalogue.items[0].id, target: 'toolPolicy', mode: 'replace' }),
    });
    assert.equal((await applied.json()).harness.components.toolPolicy, 'fixture preset body');

    const assigned = await fetch(`http://127.0.0.1:${port}/admin/local-keys/default`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ harnessId: created.id }),
    });
    assert.equal((await assigned.json()).localKey.harnessId, created.id);

    const blocked = await fetch(`http://127.0.0.1:${port}/admin/harnesses/${created.id}`, { method: 'DELETE' });
    assert.equal(blocked.status, 409);

    const library = await (await fetch(`http://127.0.0.1:${port}/admin/harnesses`)).json();
    assert.deepEqual(library.harnesses.map((harness) => harness.id), ['default', created.id]);
  } finally {
    await close(server);
  }
});

test('each local key applies its selected Harness before a managed provider receives the request', async () => {
  const value = runtime();
  value.routing.chains[0].links = [{ provider: 'openai-codex', model: 'gpt-test' }];
  value.routing.localKeys[0].harnessId = 'research';
  const harnessFile = path.join(value.presetDataDir, 'selected-harness.json');
  fs.writeFileSync(harnessFile, JSON.stringify({
    schemaVersion: 2,
    harnesses: [
      { id: 'default', name: 'Default Harness', components: {} },
      { id: 'research', name: 'Research', components: { identity: 'Selected Harness identity' } },
    ],
  }));
  let received;
  const managedTransports = {
    has: () => true,
    async request(_transport, link, body) {
      received = body;
      return new Response(JSON.stringify({
        id: 'chatcmpl-test', object: 'chat.completion', model: link.model,
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      }), { headers: { 'content-type': 'application/json' } });
    },
  };
  const server = createServer(value, new QuotaTracker(), { ui: true, harnessFile, managedTransports });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer default-token', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: 'hello' }] }),
    });
    assert.equal(response.status, 200);
    assert.equal(received.messages[0].content, 'Selected Harness identity');
  } finally {
    await close(server);
  }
});
