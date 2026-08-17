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
  return createRoutingRuntime({
    secretStore,
    routing: {
      schemaVersion: 2,
      chains: [{ id: 'default', name: 'Default', migrated: true, links: [{ provider: 'google', model: 'gemini-example' }] }],
      localKeys: [{ id: 'default', name: 'Default', secretRef: 'local-key:default', target: { type: 'chain', id: 'default' } }],
    },
  });
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
