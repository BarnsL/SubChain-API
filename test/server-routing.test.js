import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createSecretStore } from '../src/storage.js';
import { createServer } from '../src/server.js';
import { QuotaTracker } from '../src/quota.js';
import { createProviderStatusStore } from '../src/provider-status.js';

const routingModule = await import('../src/routing.js');
const { authenticateLocalKey, createRoutingRuntime, rotateLocalKey, tokenForLocalKey } = routingModule;

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function makeRuntime() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subchain-server-'));
  const secretStore = createSecretStore({ dataDir });
  secretStore.set('local-key:alpha', 'alpha-token');
  secretStore.set('local-key:beta', 'beta-token');
  return createRoutingRuntime({
    secretStore,
    routing: {
      schemaVersion: 2,
      chains: [
        { id: 'alpha', name: 'Alpha', links: [{ provider: 'google', model: 'alpha-model' }] },
        { id: 'beta', name: 'Beta', links: [{ provider: 'kimi', model: 'beta-model' }] },
      ],
      localKeys: [
        { id: 'alpha', name: 'Alpha key', secretRef: 'local-key:alpha', target: { type: 'chain', id: 'alpha' } },
        { id: 'beta', name: 'Beta key', secretRef: 'local-key:beta', target: { type: 'chain', id: 'beta' } },
      ],
    },
  });
}

test('a local key lists only its assigned chain models and rejects another chain model', async () => {
  assert.equal(typeof createRoutingRuntime, 'function', 'routing runtime constructor must exist');
  if (typeof createRoutingRuntime !== 'function') return;

  const server = createServer(makeRuntime(), new QuotaTracker(), { ui: false });
  const port = await listen(server);
  try {
    const models = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      headers: { Authorization: 'Bearer alpha-token' },
    });
    assert.equal(models.status, 200);
    assert.deepEqual((await models.json()).data.map((model) => model.id), ['auto', 'alpha-model']);

    const chat = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer alpha-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'beta-model', messages: [{ role: 'user', content: 'hello' }] }),
    });
    assert.equal(chat.status, 502);
    assert.match((await chat.json()).error.message, /No chain link serves model "beta-model"/);
  } finally {
    await close(server);
  }
});

test('a direct provider key normalizes its discovered catalog instead of stale chain links', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subchain-direct-provider-'));
  const secretStore = createSecretStore({ dataDir });
  secretStore.set('local-key:codex', 'codex-token');
  const runtime = createRoutingRuntime({
    secretStore,
    routing: {
      schemaVersion: 3,
      chains: [
        { id: 'default', name: 'Default', links: [{ provider: 'openai-codex', model: 'gpt-stale-chain' }] },
        { id: 'other', name: 'Other', links: [{ provider: 'google', model: 'google-only' }] },
      ],
      localKeys: [{
        id: 'codex', name: 'Codex key', secretRef: 'local-key:codex',
        target: { type: 'provider', id: 'openai-codex' }, harnessId: 'default',
      }],
    },
  });
  const providerStatusStore = createProviderStatusStore({ file: path.join(dataDir, 'provider-status.json') });
  providerStatusStore.recordPing('openai-codex', {
    health: 'ready',
    models: [
      { id: '  gpt-live-first  ' }, { id: 'gpt-live-first' }, { id: '' }, { id: 1 },
      { id: ' gpt-live-explicit ' }, { id: 'gpt-live-explicit' }, {},
    ],
  });
  const requests = [];
  const managedTransports = {
    has: (transport) => transport === 'codex-app-server',
    async request(transport, link, body) {
      requests.push({ transport, model: link.model, body });
      if (link.model === 'gpt-live-first') {
        return new Response(JSON.stringify({ error: { message: 'try the next model' } }), { status: 500 });
      }
      return new Response(JSON.stringify({
        id: 'chatcmpl-local', object: 'chat.completion', model: link.model,
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };
  const server = createServer(runtime, new QuotaTracker(), { ui: false, providerStatusStore, managedTransports });
  const port = await listen(server);
  const endpoint = `http://127.0.0.1:${port}`;
  const headers = { Authorization: 'Bearer codex-token', 'Content-Type': 'application/json' };
  try {
    const models = await fetch(`${endpoint}/v1/models`, { headers });
    assert.equal(models.status, 200);
    assert.deepEqual((await models.json()).data.map((model) => model.id), ['auto', 'gpt-live-first', 'gpt-live-explicit']);

    const automatic = await fetch(`${endpoint}/v1/chat/completions`, {
      method: 'POST', headers,
      body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: 'hello' }] }),
    });
    assert.equal(automatic.status, 200);
    assert.equal(automatic.headers.get('x-subchain-model'), 'gpt-live-explicit');

    const explicit = await fetch(`${endpoint}/v1/chat/completions`, {
      method: 'POST', headers,
      body: JSON.stringify({ model: 'gpt-live-explicit', messages: [{ role: 'user', content: 'hello' }] }),
    });
    assert.equal(explicit.status, 200);
    assert.equal(explicit.headers.get('x-subchain-model'), 'gpt-live-explicit');
    assert.deepEqual(requests.map((request) => request.model), [
      'gpt-live-first', 'gpt-live-explicit', 'gpt-live-explicit',
    ]);

    const inaccessible = await fetch(`${endpoint}/v1/chat/completions`, {
      method: 'POST', headers,
      body: JSON.stringify({ model: 'google-only', messages: [{ role: 'user', content: 'hello' }] }),
    });
    assert.equal(inaccessible.status, 502);
    assert.match((await inaccessible.json()).error.message, /No chain link serves model "google-only"/);
  } finally {
    await close(server);
  }
});

test('a direct provider key falls back when its provider catalogue has no valid models', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subchain-direct-fallback-'));
  const secretStore = createSecretStore({ dataDir });
  secretStore.set('local-key:codex', 'codex-token');
  const runtime = createRoutingRuntime({
    secretStore,
    routing: {
      schemaVersion: 3,
      chains: [{ id: 'default', name: 'Default', links: [{ provider: 'openai-codex', model: 'gpt-stale-chain' }] }],
      localKeys: [{
        id: 'codex', name: 'Codex key', secretRef: 'local-key:codex',
        target: { type: 'provider', id: 'openai-codex' }, harnessId: 'default',
      }],
    },
  });
  const providerStatusStore = createProviderStatusStore({ file: path.join(dataDir, 'provider-status.json') });
  providerStatusStore.recordPing('openai-codex', { health: 'ready', models: [{ id: '' }, { id: 1 }, {}] });
  const requests = [];
  const managedTransports = {
    has: (transport) => transport === 'codex-app-server',
    async request(transport, link) {
      requests.push({ transport, model: link.model });
      return new Response(JSON.stringify({
        id: 'chatcmpl-local', object: 'chat.completion', model: link.model,
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };
  const server = createServer(runtime, new QuotaTracker(), { ui: false, providerStatusStore, managedTransports });
  const port = await listen(server);
  const endpoint = `http://127.0.0.1:${port}`;
  const headers = { Authorization: 'Bearer codex-token', 'Content-Type': 'application/json' };
  try {
    const models = await fetch(`${endpoint}/v1/models`, { headers });
    assert.equal(models.status, 200);
    assert.deepEqual((await models.json()).data.map((model) => model.id), [
      'auto', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4',
      'gpt-5.4-mini', 'gpt-5.3-codex-spark',
    ]);

    const automatic = await fetch(`${endpoint}/v1/chat/completions`, {
      method: 'POST', headers,
      body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: 'hello' }] }),
    });
    assert.equal(automatic.status, 200);
    assert.equal(automatic.headers.get('x-subchain-model'), 'gpt-5.6-sol');
    assert.deepEqual(requests.map((request) => request.model), ['gpt-5.6-sol']);
  } finally {
    await close(server);
  }
});

test('rotating one local key does not invalidate another', () => {
  assert.equal(typeof rotateLocalKey, 'function', 'local-key rotation must exist');
  if (typeof rotateLocalKey !== 'function') return;

  const runtime = makeRuntime();
  const alphaBefore = runtime.secretStore.get('local-key:alpha');
  const betaAfter = rotateLocalKey(runtime, 'beta');
  assert.equal(runtime.secretStore.get('local-key:alpha'), alphaBefore);
  assert.notEqual(betaAfter, 'beta-token');
});

test('rotating a migrated default key supersedes its legacy environment value', () => {
  assert.equal(typeof tokenForLocalKey, 'function', 'local token lookup must exist');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subchain-default-rotate-'));
  const secretStore = createSecretStore({ dataDir });
  secretStore.set('local-key:default', 'legacy-token');
  const runtime = createRoutingRuntime({
    secretStore,
    env: { SUBCHAIN_ACCESS_KEY: 'legacy-token' },
    routing: {
      schemaVersion: 2,
      chains: [{ id: 'default', name: 'Default', migrated: true, links: [{ provider: 'google', model: 'default-model' }] }],
      localKeys: [{ id: 'default', name: 'Default', secretRef: 'local-key:default', target: { type: 'chain', id: 'default' } }],
    },
  });
  const rotated = rotateLocalKey(runtime, 'default');
  assert.equal(tokenForLocalKey(runtime, runtime.routing.localKeys[0]), rotated);
  assert.equal(authenticateLocalKey(runtime, 'legacy-token'), null);
  assert.equal(authenticateLocalKey(runtime, rotated)?.id, 'default');
});
