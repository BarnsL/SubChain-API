import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { QuotaTracker, usageFromPayload } from '../src/quota.js';

const statusModule = await import('../src/provider-status.js').catch(() => ({}));
const { createProviderStatusStore } = statusModule;

function statusFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'subchain-provider-status-')), 'status.json');
}

test('provider status stores aliases, models, and quota buckets without unrecognized account data', () => {
  assert.equal(typeof createProviderStatusStore, 'function', 'provider status store must exist');
  if (!createProviderStatusStore) return;
  const file = statusFile();
  const store = createProviderStatusStore({ file, clock: () => 1_000 });
  store.rename('openai-codex', 'Codex Pro 1');
  store.recordPing('openai-codex', {
    health: 'ready',
    plan: 'pro',
    accountEmail: 'redacted',
    models: [{ id: 'gpt-example', label: 'GPT Example' }],
    quotas: [{ id: 'codex', usedPercent: 18, windowMinutes: 10_080 }],
    usage: { lifetimeTokens: 1_234 },
  });

  const account = store.get('openai-codex');
  assert.equal(account.name, 'Codex Pro 1');
  assert.equal(account.models[0].id, 'gpt-example');
  assert.equal(account.quotas[0].usedPercent, 18);
  assert.equal(account.usage.lifetimeTokens, 1_234);
  assert.equal('accountEmail' in account, false);
  assert.equal(account.lastPingAt, 1_000);
  assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8'))).includes('redacted'), false);
});

test('a failed provider ping preserves the last successful model catalogue', () => {
  const store = createProviderStatusStore({ file: statusFile(), clock: () => 2_000 });
  store.recordPing('kimi', { health: 'ready', models: [{ id: 'k3' }], quotas: [] });
  store.recordPing('kimi', { health: 'error', error: 'Provider ping failed' });
  const account = store.get('kimi');
  assert.equal(account.health, 'error');
  assert.deepEqual(account.models.map((model) => model.id), ['k3']);
  assert.equal(account.lastSuccessAt, 2_000);
});

test('provider usage accumulates by account without changing another account', () => {
  const store = createProviderStatusStore({ file: statusFile(), clock: () => 3_000 });
  store.recordUsage('anthropic1', { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 });
  store.recordUsage('anthropic1', { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
  assert.deepEqual(store.get('anthropic1').observedUsage, {
    requests: 2,
    promptTokens: 13,
    completionTokens: 6,
    totalTokens: 19,
  });
  assert.equal(store.get('anthropic2'), null);
});

test('quota tracking keeps multi-bucket state isolated by provider account', () => {
  const tracker = new QuotaTracker();
  tracker.merge('anthropic1', { quotas: [{ id: 'plan', usedPercent: 75, status: 'available' }] });
  tracker.merge('anthropic2', { quotas: [{ id: 'plan', usedPercent: 5, status: 'available' }] });
  assert.equal(tracker.get('anthropic1').quotas[0].usedPercent, 75);
  assert.equal(tracker.get('anthropic2').quotas[0].usedPercent, 5);
  tracker.recordUsage('anthropic1', { input_tokens: 8, output_tokens: 2 });
  assert.equal(tracker.get('anthropic1').observedUsage.totalTokens, 10);
  assert.equal(tracker.get('anthropic2').observedUsage.totalTokens, 0);
});

test('OpenAI-compatible response usage is extracted without retaining response content', () => {
  assert.deepEqual(usageFromPayload(JSON.stringify({
    choices: [{ message: { content: 'private response text' } }],
    usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
  })), { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 });
  assert.equal(usageFromPayload('not json'), null);
});
