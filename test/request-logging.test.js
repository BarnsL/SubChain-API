import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSecretStore } from '../src/storage.js';
import { createRoutingRuntime } from '../src/routing.js';
import { QuotaTracker } from '../src/quota.js';
import { RequestJournal } from '../src/request-journal.js';
import { createServer } from '../src/server.js';

function runtime() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subchain-request-logging-'));
  const secretStore = createSecretStore({ dataDir });
  secretStore.set('local-key:alpha', 'alpha-token');
  secretStore.set('local-key:beta', 'beta-token');
  const value = createRoutingRuntime({
    secretStore,
    routing: {
      schemaVersion: 3,
      chains: [{ id: 'default', name: 'Default', links: [{ provider: 'openai-codex', model: 'gpt-test' }] }],
      localKeys: [
        { id: 'alpha', name: 'Alpha workstation', secretRef: 'local-key:alpha', target: { type: 'chain', id: 'default' }, harnessId: 'default' },
        { id: 'beta', name: 'Beta workstation', secretRef: 'local-key:beta', target: { type: 'chain', id: 'default' }, harnessId: 'default' },
      ],
    },
  });
  value.testDataDir = dataDir;
  return value;
}

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = (server) => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

test('scoped log APIs isolate two local keys before filters and the admin view decorates safe names', async () => {
  const value = runtime();
  const journal = new RequestJournal({ enabled: false });
  const managedTransports = {
    has: (transport) => transport === 'codex-app-server',
    async request(transport, link) {
      return new Response(JSON.stringify({
        choices: [{ index: 0, message: { role: 'assistant', content: `PRIVATE_${link.model}_OUTPUT` }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };
  const server = createServer(value, new QuotaTracker(), {
    ui: true,
    journal,
    managedTransports,
    harnessFile: path.join(value.testDataDir, 'harness.json'),
  });
  const base = await listen(server);

  try {
    for (const [key, app, session] of [
      ['alpha-token', 'Alpha App', 'alpha-session'],
      ['beta-token', 'Beta App', 'beta-session'],
    ]) {
      const response = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'X-SubChain-App': app,
          'X-SubChain-Session-Id': session,
        },
        body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: `PRIVATE_${session}_INPUT` }] }),
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('x-subchain-request-id') || '', /^[0-9a-f-]{36}$/);
      await response.text();
    }

    const alphaResponse = await fetch(`${base}/v1/logs?q=Alpha&app=Alpha`, {
      headers: { Authorization: 'Bearer alpha-token' },
    });
    assert.equal(alphaResponse.status, 200);
    assert.equal(alphaResponse.headers.get('cache-control'), 'no-store');
    const alpha = await alphaResponse.json();
    assert.equal(alpha.summary.total, 1);
    assert.deepEqual(alpha.items.map((record) => record.localKeyId), ['alpha']);
    assert.equal(alpha.items[0].target.id, 'default');
    assert.equal(alpha.items[0].harnessId, 'default');
    assert.equal(alpha.items[0].transport, 'codex-app-server');
    assert.equal(alpha.items[0].result.usage.source, 'exact');
    assert.equal(alpha.items[0].result.usage.totalTokens, 11);
    assert.equal(alpha.items[0].localKeyName, undefined);

    const harnessScoped = await (await fetch(`${base}/v1/logs?harness=default`, {
      headers: { Authorization: 'Bearer alpha-token' },
    })).json();
    assert.equal(harnessScoped.summary.total, 1);
    const wrongHarness = await (await fetch(`${base}/v1/logs?harness=research`, {
      headers: { Authorization: 'Bearer alpha-token' },
    })).json();
    assert.equal(wrongHarness.summary.total, 0);

    const crossScopeSearch = await (await fetch(`${base}/v1/logs?q=beta-session`, {
      headers: { Authorization: 'Bearer alpha-token' },
    })).json();
    assert.equal(crossScopeSearch.summary.total, 0);
    assert.equal((await fetch(`${base}/v1/logs`, { headers: { Authorization: 'Bearer invalid' } })).status, 401);

    const revealed = await (await fetch(`${base}/admin/local-keys/alpha`)).json();
    assert.equal(revealed.key, 'alpha-token');
    const harnessResponse = await fetch(`${base}/admin/harnesses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Private audit fixture',
        components: { operatingInstructions: 'PRIVATE_HARNESS_BODY_SENTINEL' },
      }),
    });
    assert.equal(harnessResponse.status, 201);

    const adminResponse = await fetch(`${base}/admin/logs`);
    assert.equal(adminResponse.status, 200);
    assert.equal(adminResponse.headers.get('cache-control'), 'no-store');
    const admin = await adminResponse.json();
    assert.deepEqual(new Set(admin.items.filter((item) => item.localKeyId).map((item) => item.localKeyName)), new Set(['Alpha workstation', 'Beta workstation']));
    assert.ok(admin.items.some((item) => item.audit?.action === 'local-key-revealed' && item.audit.entityId === 'alpha'));
    assert.ok(admin.items.some((item) => item.audit?.action === 'harness-created' && item.audit.entityId));

    const serialized = JSON.stringify(admin);
    assert.doesNotMatch(serialized, /alpha-token|beta-token|PRIVATE_|alpha-session_INPUT|beta-session_INPUT|PRIVATE_HARNESS_BODY_SENTINEL/);

    const secondAdmin = await (await fetch(`${base}/admin/logs`)).json();
    assert.equal(secondAdmin.summary.total, admin.summary.total, 'admin log polling must not recurse');
  } finally {
    await close(server);
    fs.rmSync(value.testDataDir, { recursive: true, force: true });
  }
});

test('invalid local keys are journaled before body parsing and CORS permits opt-in metadata', async () => {
  const value = runtime();
  const journal = new RequestJournal({ enabled: false });
  const server = createServer(value, new QuotaTracker(), { ui: true, journal });
  const base = await listen(server);
  try {
    const options = await fetch(`${base}/v1/chat/completions`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, content-type, x-subchain-app, x-subchain-session-id',
      },
    });
    const allowed = options.headers.get('access-control-allow-headers')?.toLowerCase() || '';
    assert.match(allowed, /x-subchain-app/);
    assert.match(allowed, /x-subchain-session-id/);

    const denied = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer stale', 'Content-Type': 'application/json', 'X-SubChain-App': 'Nous Man' },
      body: '{"PRIVATE_BODY_SENTINEL":',
    });
    assert.equal(denied.status, 401);
    const admin = await (await fetch(`${base}/admin/logs?status=401&app=Nous`)).json();
    assert.equal(admin.items.length, 1);
    assert.equal(admin.items[0].request.inputSummary, 'unavailable-before-auth');
    assert.equal(admin.items[0].localKeyId, undefined);
    assert.doesNotMatch(JSON.stringify(admin), /PRIVATE_BODY_SENTINEL|Bearer stale/);
  } finally {
    await close(server);
    fs.rmSync(value.testDataDir, { recursive: true, force: true });
  }
});
