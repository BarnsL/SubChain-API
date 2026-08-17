import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const routingModule = await import('../src/routing.js').catch(() => ({}));
const { loadRouting, migrateRouting, scopeForLocalKey, validateRouting } = routingModule;

function makeTempConfig(legacy) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subchain-routing-'));
  const legacyFile = path.join(dir, 'chain.config.json');
  fs.writeFileSync(legacyFile, JSON.stringify(legacy), 'utf8');
  return { dir, legacyFile, routingFile: path.join(dir, 'routing.config.json') };
}

test('migrates the existing token and every legacy link into the valid Default key', () => {
  assert.equal(typeof loadRouting, 'function', 'routing loader must exist');
  if (typeof loadRouting !== 'function') return;

  const legacy = {
    chain: Array.from({ length: 6 }, (_, index) => ({ provider: 'kimi', model: `model-${index}` })),
  };
  const { legacyFile, routingFile } = makeTempConfig(legacy);
  const routing = loadRouting({ routingFile, legacyFile, legacyAccessKey: 'sc-legacy' });

  assert.deepEqual(routing.localKeys[0], {
    id: 'default',
    name: 'Default',
    secretRef: 'local-key:default',
    target: { type: 'chain', id: 'default' },
    harnessId: 'default',
  });
  assert.equal(routing.chains[0].id, 'default');
  assert.equal(routing.chains[0].migrated, true);
  assert.equal(routing.chains[0].links.length, 6);
});

test('marks the public starter chain as newly authored so it retains the five-link limit', () => {
  assert.equal(typeof loadRouting, 'function', 'routing loader must exist');
  if (typeof loadRouting !== 'function') return;
  const { legacyFile, routingFile } = makeTempConfig({
    migrated: false,
    chain: [{ provider: 'google', model: 'starter-model' }],
  });
  const routing = loadRouting({ routingFile, legacyFile });
  assert.equal(routing.chains[0].migrated, false);
});

test('migrates schema version 2 local keys to the Default Harness', () => {
  assert.equal(typeof migrateRouting, 'function', 'routing migration must exist');
  if (typeof migrateRouting !== 'function') return;
  const migrated = migrateRouting({
    schemaVersion: 2,
    chains: [{ id: 'default', name: 'Default', links: [{ provider: 'kimi', model: 'k3' }] }],
    localKeys: [{
      id: 'default',
      name: 'Default',
      secretRef: 'local-key:default',
      target: { type: 'chain', id: 'default' },
    }],
  });

  assert.equal(migrated.schemaVersion, 3);
  assert.equal(migrated.localKeys[0].harnessId, 'default');
});

test('materialized managed links retain their native transport instead of an API endpoint credential', () => {
  const routing = {
    schemaVersion: 3,
    chains: [{ id: 'codex', name: 'Codex', links: [{ provider: 'openai-codex', model: 'gpt-test' }] }],
    localKeys: [{
      id: 'codex', name: 'Codex', secretRef: 'local-key:codex',
      target: { type: 'chain', id: 'codex' }, harnessId: 'default',
    }],
  };
  const scope = scopeForLocalKey(routing, routing.localKeys[0]);
  assert.equal(scope.links[0].transport, 'codex-app-server');
  assert.equal(scope.links[0].baseUrl, 'managed://codex');
});

test('rejects an eleventh local key and a sixth link on a newly authored chain', () => {
  assert.equal(typeof validateRouting, 'function', 'routing validator must exist');
  if (typeof validateRouting !== 'function') return;

  const sixLinks = Array.from({ length: 6 }, (_, index) => ({ provider: 'kimi', model: `model-${index}` }));
  assert.throws(
    () => validateRouting({ schemaVersion: 2, chains: [{ id: 'new', name: 'New', links: sixLinks }], localKeys: [] }),
    /five links/i
  );

  const tenKeys = Array.from({ length: 10 }, (_, index) => ({
    id: `key-${index}`,
    name: `Key ${index}`,
    secretRef: `local-key:key-${index}`,
    target: { type: 'chain', id: 'only' },
  }));
  assert.throws(
    () => validateRouting({
      schemaVersion: 2,
      chains: [{ id: 'only', name: 'Only', links: [{ provider: 'kimi', model: 'k1' }] }],
      localKeys: [...tenKeys, { ...tenKeys[0], id: 'key-10', name: 'Key 10', secretRef: 'local-key:key-10' }],
    }),
    /at most 10 local keys/i
  );
});
