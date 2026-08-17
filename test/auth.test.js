import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWindowsEnvironmentReader, resolveCredential } from '../src/auth.js';

test('Windows environment credential discovery reads the registry only once per process', () => {
  let calls = 0;
  const reader = createWindowsEnvironmentReader(() => {
    calls += 1;
    return [
      '    GOOGLE_API_KEY    REG_SZ    google-test-value',
      '    ANTHROPIC_TOKEN    REG_EXPAND_SZ    anthropic test value',
    ].join('\r\n');
  });

  assert.equal(reader('GOOGLE_API_KEY'), 'google-test-value');
  assert.equal(reader('anthropic_token'), 'anthropic test value');
  assert.equal(reader('MISSING'), null);
  assert.equal(calls, 1);
});

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

test('configured portable sources resolve documented directory and environment aliases', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subchain-auth-'));
  const envFile = path.join(dir, 'shared.env');
  fs.writeFileSync(path.join(dir, 'sakana.txt'), 'directory-sakana-key\n', 'utf8');
  fs.writeFileSync(envFile, 'GLM_API_KEY=file-zhipu-key\nGEMINI_PAID_API_KEY=file-google-key\n', 'utf8');
  const options = {
    env: {
      SUBCHAIN_CREDENTIALS_DIR: dir,
      SUBCHAIN_CREDENTIAL_ENV_FILE: envFile,
    },
    platform: 'linux',
    home: '/tmp/subchain-home',
  };

  assert.deepEqual(resolveCredential('sakana', options), {
    token: 'directory-sakana-key', type: 'api-key', source: 'credential-directory',
  });
  assert.deepEqual(resolveCredential('zhipu', options), {
    token: 'file-zhipu-key', type: 'api-key', source: 'credential-file',
  });
  assert.deepEqual(resolveCredential('google', options), {
    token: 'file-google-key', type: 'api-key', source: 'credential-file',
  });
});

test('numbered provider slots require their own explicit credential instead of duplicating the family token', () => {
  const familyOnly = resolveCredential('sakana0', {
    env: { SAKANA_API_KEY: 'family-sakana-key' }, platform: 'linux', home: '/tmp/subchain-home',
  });
  assert.equal(familyOnly, null);
  assert.deepEqual(resolveCredential('sakana0', {
    env: { SUBCHAIN_SAKANA0_API_KEY: 'slot-sakana-key' }, platform: 'linux', home: '/tmp/subchain-home',
  }), {
    token: 'slot-sakana-key', type: 'api-key', source: 'override',
  });
});

test('OpenAI API keys and the managed Codex subscription use separate provider lanes', () => {
  const api = resolveCredential('openai-api', {
    env: { OPENAI_API_KEY: '<redacted>' },
    platform: 'linux',
    home: '/tmp/empty',
  });
  const codex = resolveCredential('openai-codex', {
    env: { OPENAI_API_KEY: '<redacted>' },
    platform: 'linux',
    home: '/tmp/empty',
  });
  assert.equal(api?.source, 'environment');
  assert.equal(api?.type, 'api-key');
  assert.equal(codex, null);
});
