import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const harnessModule = await import('../src/harness.js');
const {
  applyHarnessConfig,
  createHarness,
  loadHarnessLibrary,
  removeHarness,
  resolveHarnessFile,
  sanitizeHarnessHeaders,
  updateHarness,
} = harnessModule;

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
  assert.equal(typeof loadHarnessLibrary, 'function', 'Harness library loading must exist');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'subchain-harness-')), 'harness.json');
  fs.writeFileSync(file, JSON.stringify({ systemPrompts: { operatingInstructions: 'isolated prompt' } }), 'utf8');
  const library = loadHarnessLibrary(file);
  assert.equal(library.schemaVersion, 2);
  assert.equal(library.harnesses[0].id, 'default');
  assert.equal(library.harnesses[0].components.operatingInstructions, 'isolated prompt');
});

test('Harness prompt components are composed in deterministic order', () => {
  const configured = applyHarnessConfig(
    { model: 'auto', messages: [{ role: 'user', content: 'Hello' }] },
    {
      components: {
        identity: 'Identity',
        operatingInstructions: 'Operate',
        safetyPolicy: 'Safety',
        outputStyle: 'Style',
        persona: 'Persona',
      },
    },
  );

  assert.equal(configured.messages[0].content, 'Identity\n\nOperate\n\nSafety\n\nStyle\n\nPersona');
});

test('Harness administration creates unique ids and protects the Default Harness', () => {
  assert.equal(typeof createHarness, 'function', 'Harness creation must exist');
  assert.equal(typeof updateHarness, 'function', 'Harness updates must exist');
  assert.equal(typeof removeHarness, 'function', 'Harness deletion must exist');
  if (!createHarness || !updateHarness || !removeHarness) return;

  const library = loadHarnessLibrary(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'subchain-harness-')), 'missing.json'));
  const first = createHarness(library, { name: 'Research Mode' });
  const second = createHarness(library, { name: 'Research Mode' });
  assert.equal(first.id, 'research-mode');
  assert.equal(second.id, 'research-mode-2');
  updateHarness(library, first.id, { name: 'Research Safe', components: { safetyPolicy: 'Cite sources.' } });
  assert.equal(first.name, 'Research Safe');
  assert.equal(first.components.safetyPolicy, 'Cite sources.');
  assert.throws(() => removeHarness(library, 'default'), /Default Harness cannot be deleted/i);
  assert.equal(removeHarness(library, second.id).id, second.id);
});

test('Harness HTTP metadata cannot override credentials or connection framing', () => {
  assert.deepEqual(sanitizeHarnessHeaders({
    'X-App-Name': 'research-console',
    Authorization: 'not-allowed',
    Cookie: 'not-allowed',
    Host: 'not-allowed',
    'Content-Length': '999',
    'Bad Header': 'not-allowed',
    'X-Object': { unsafe: true },
  }), { 'X-App-Name': 'research-console' });
});

test('named Harnesses default to private platform application data', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subchain-harness-data-'));
  assert.equal(resolveHarnessFile({ dataDir }), path.join(dataDir, 'harnesses.json'));
});
