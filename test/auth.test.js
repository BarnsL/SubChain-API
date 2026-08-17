import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveCredential } from '../src/auth.js';

test('an explicit SubChain override wins and reports no private pathname', () => {
  const credential = resolveCredential('sakana', {
    env: { SUBCHAIN_SAKANA_API_KEY: 'test-sakana-key' },
    platform: 'linux',
    home: '/tmp/subchain-home',
  });
  assert.deepEqual(credential, { token: 'test-sakana-key', type: 'api-key', source: 'override' });
});

test('non-Windows resolution does not probe a platform-only credential source', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subchain-auth-'));
  let platformStoreCalled = false;
  const credential = resolveCredential('zhipu', {
    env: {},
    platform: 'linux',
    home: dir,
    credentialDir: dir,
    platformStore() {
      platformStoreCalled = true;
      return 'must-not-be-read';
    },
  });
  assert.equal(credential, null);
  assert.equal(platformStoreCalled, false);
});

test('provider credential directories are opt-in and disclose only their generic source type', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subchain-auth-'));
  fs.writeFileSync(path.join(dir, 'zhipu-api-key.txt'), 'directory-zhipu-key\n', 'utf8');
  const credential = resolveCredential('zhipu', {
    env: {},
    platform: 'linux',
    home: '/tmp/subchain-home',
    credentialDir: dir,
  });
  assert.deepEqual(credential, { token: 'directory-zhipu-key', type: 'api-key', source: 'credential-directory' });
});
