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
    const payload = await state.json();
    assert.equal(payload.localKeys[0].id, 'default');
    assert.equal(JSON.stringify(payload).includes('default-token'), false);

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

    const pinged = await fetch(`http://127.0.0.1:${port}/admin/providers/google/ping`, { method: 'POST' });
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
