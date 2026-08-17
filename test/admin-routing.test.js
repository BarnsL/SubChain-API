import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSecretStore } from '../src/storage.js';
import { createRoutingRuntime } from '../src/routing.js';

const adminModule = await import('../src/admin.js');
const { addChain, addChainLink, addLocalKey, routingInventory, updateLocalKey } = adminModule;

function makeRuntime() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subchain-admin-'));
  return createRoutingRuntime({
    secretStore: createSecretStore({ dataDir }),
    routing: {
      schemaVersion: 2,
      chains: [{ id: 'default', name: 'Default', migrated: true, links: [{ provider: 'google', model: 'gemini-example' }] }],
      localKeys: [{ id: 'default', name: 'Default', secretRef: 'local-key:default', target: { type: 'chain', id: 'default' } }],
    },
  });
}

test('routing administration caps keys and chains at ten and new chains at five links', () => {
  assert.equal(typeof addLocalKey, 'function', 'local-key administration must exist');
  assert.equal(typeof addChain, 'function', 'chain administration must exist');
  assert.equal(typeof addChainLink, 'function', 'chain-link administration must exist');
  if (!addLocalKey || !addChain || !addChainLink) return;

  const runtime = makeRuntime();
  for (let index = 1; index < 10; index++) {
    const created = addLocalKey(runtime, {
      name: `Provider ${index}`,
      target: { type: 'provider', id: 'zhipu' },
    });
    assert.match(created.token, /^sc-/);
  }
  assert.equal(runtime.routing.localKeys.length, 10);
  assert.throws(() => addLocalKey(runtime, { name: 'Eleven', target: { type: 'provider', id: 'zhipu' } }), /at most 10 local keys/);

  for (let index = 1; index < 10; index++) {
    addChain(runtime, { name: `Chain ${index}`, link: { provider: 'sakana', model: `sakana-initial-${index}` } });
  }
  assert.equal(runtime.routing.chains.length, 10);
  assert.throws(() => addChain(runtime, { name: 'Eleven', link: { provider: 'sakana', model: 'sakana-eleven' } }), /at most 10 chains/);

  const target = runtime.routing.chains.find((chain) => chain.id === 'chain-1');
  for (let index = 0; index < 4; index++) addChainLink(runtime, target.id, { provider: 'sakana', model: `sakana-${index}` });
  assert.equal(target.links.length, 5);
  assert.throws(() => addChainLink(runtime, target.id, { provider: 'sakana', model: 'sakana-5' }), /more than five links/);
});

test('local-key administration persists a named Harness without rotating its token', () => {
  const runtime = makeRuntime();
  const created = addLocalKey(runtime, {
    name: 'Research',
    target: { type: 'provider', id: 'zhipu' },
    harnessId: 'research-safe',
  });
  const token = created.token;
  assert.equal(created.key.harnessId, 'research-safe');

  const updated = updateLocalKey(runtime, created.key.id, { harnessId: 'default' });
  assert.equal(updated.harnessId, 'default');
  assert.equal(runtime.secretStore.get(created.key.secretRef), token);
});

test('provider inventory does not probe every unused numbered credential slot', () => {
  const calls = [];
  const providers = routingInventory(makeRuntime(), null, {
    credentialResolver(providerId) {
      calls.push(providerId);
      return null;
    },
  }).providers;
  assert.ok(providers.some((provider) => provider.id === 'google'));
  assert.equal(calls.includes('google'), true);
  assert.equal(calls.some((providerId) => /\d+$/.test(providerId)), false);
});

test('a local key can target one numbered provider subscription directly', () => {
  const runtime = makeRuntime();
  const created = addLocalKey(runtime, {
    name: 'Second Google account',
    target: { type: 'provider', id: 'google1' },
  });
  assert.deepEqual(created.key.target, { type: 'provider', id: 'google1' });
});

test('managed provider inventory distinguishes an available runtime from a missing ChatGPT login', () => {
  const runtime = makeRuntime();
  const accounts = new Map([
    ['openai-codex', { providerId: 'openai-codex', health: 'missing' }],
    ['google-antigravity', { providerId: 'google-antigravity', health: 'ready' }],
  ]);
  const providers = routingInventory(runtime, null, {
    statusStore: {
      list: () => [...accounts.values()],
      get: (providerId) => accounts.get(providerId) || null,
    },
    managedProviderAvailable: () => true,
  }).providers;
  const codex = providers.find((provider) => provider.id === 'openai-codex');
  const antigravity = providers.find((provider) => provider.id === 'google-antigravity');

  assert.equal(codex.hasCredential, false);
  assert.equal(codex.canConnectSubscription, true);
  assert.equal(antigravity.hasCredential, true);
  assert.equal(antigravity.canConnectSubscription, false);
});

test('fresh provider inventory exposes ChatGPT enrollment when its managed runtime is available', () => {
  const provider = routingInventory(makeRuntime(), null, {
    statusStore: { list: () => [], get: () => null },
    managedProviderAvailable: (providerId) => providerId === 'openai-codex',
  }).providers.find((candidate) => candidate.id === 'openai-codex');

  assert.equal(provider.health, 'missing');
  assert.equal(provider.hasCredential, false);
  assert.equal(provider.canConnectSubscription, true);
});
