import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createSecretStore } from '../src/storage.js';
import { createServer } from '../src/server.js';
import { QuotaTracker } from '../src/quota.js';

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
