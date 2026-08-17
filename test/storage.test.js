import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const storageModule = await import('../src/storage.js').catch(() => ({}));
const { createSecretStore, resolveDataDir } = storageModule;

test('uses an explicit data directory and persists local-key secrets outside routing metadata', () => {
  assert.equal(typeof createSecretStore, 'function', 'secret store must exist');
  assert.equal(typeof resolveDataDir, 'function', 'data directory resolver must exist');
  if (typeof createSecretStore !== 'function' || typeof resolveDataDir !== 'function') return;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subchain-secrets-'));
  assert.equal(resolveDataDir({ env: { SUBCHAIN_DATA_DIR: dir }, platform: 'linux', home: '/tmp/home' }), dir);

  const first = createSecretStore({ dataDir: dir });
  assert.equal(first.get('local-key:default'), null);
  first.set('local-key:default', 'sc-test-token');

  const second = createSecretStore({ dataDir: dir });
  assert.equal(second.get('local-key:default'), 'sc-test-token');
  assert.equal(fs.existsSync(path.join(dir, 'routing.config.json')), false);
});

test('refuses malformed secret references instead of writing arbitrary keys', () => {
  assert.equal(typeof createSecretStore, 'function', 'secret store must exist');
  if (typeof createSecretStore !== 'function') return;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subchain-secrets-'));
  const store = createSecretStore({ dataDir: dir });
  assert.throws(() => store.set('../outside', 'value'), /secret reference/i);
});
