import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const harnessModule = await import('../src/harness.js');
const { applyHarnessConfig, loadHarness } = harnessModule;

test('a selected Harness prompt becomes a system message before provider transforms run', () => {
  assert.equal(typeof applyHarnessConfig, 'function', 'Harness prompt application must exist');
  if (!applyHarnessConfig) return;

  const body = { model: 'auto', messages: [{ role: 'user', content: 'Hello' }] };
  const configured = applyHarnessConfig(body, {
    systemPrompts: { operatingInstructions: 'Work carefully.', persona: 'Be concise.' },
    generation: {}, infrastructure: {}, aliases: {}, headers: {}, tools: {}, thinking: {},
  });

  assert.deepEqual(configured.messages, [
    { role: 'system', content: 'Work carefully.\n\nBe concise.' },
    { role: 'user', content: 'Hello' },
  ]);
});

test('Harness loading can target an isolated configuration file', () => {
  assert.equal(typeof loadHarness, 'function', 'Harness loading must exist');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'subchain-harness-')), 'harness.json');
  fs.writeFileSync(file, JSON.stringify({ systemPrompts: { operatingInstructions: 'isolated prompt' } }), 'utf8');
  assert.equal(loadHarness(file).systemPrompts.operatingInstructions, 'isolated prompt');
});
