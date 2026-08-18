import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChainOperatorRuntime, operatorSystemPrompt, redactOperatorText } from '../src/operator-runtime.js';
import { analyzeSanitizedRecords } from '../src/operator-security.js';
import { applyMinorRepair } from '../src/operator-repair.js';
import { stripHumanOnlyLogFlags, HUMAN_ONLY_LOG_FLAGS } from '../src/operator-subchain.js';
import { providerDef, FAMILIES } from '../src/providers.js';
import { resolveCredential } from '../src/auth.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

const isolated = { env: {}, platform: 'linux', home: '/tmp/subchain-none' };

const withRoot = async (run) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subchain-operator-'));
  try {
    return await run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const operatorFor = (root, overrides = {}) => new ChainOperatorRuntime({
  root,
  prefix: 'SUBCHAIN_TEST',
  appName: 'SubChainTest',
  specialization: 'test',
  allowedTools: ['set_ui'],
  getContext: async () => ({ providerHelp: [{ url: 'https://console.groq.com/keys' }] }),
  executeAction: async () => ({ ok: true }),
  selfComplete: async () => JSON.stringify({ message: 'proposal', actions: [], links: [] }),
  systemPrompt: operatorSystemPrompt('SubChainTest', 'test', ['set_ui']),
  ...overrides,
});

test('the added provider lanes are materialized with their documented auth posture', () => {
  assert.ok(['openrouter', 'groq', 'dario', 'local'].every((id) => FAMILIES.includes(id)));
  assert.equal(providerDef('dario').baseUrl, 'http://127.0.0.1:3456/v1');
  assert.equal(providerDef('dario').authType, 'local-fixed');
  assert.equal(providerDef('local').keyOptional, true);
  assert.equal(providerDef('openrouter').baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(providerDef('groq').baseUrl, 'https://api.groq.com/openai/v1');
});

test('the DeepSeek lane is materialized and resolves from its conventional env var', () => {
  assert.ok(FAMILIES.includes('deepseek'));
  assert.equal(providerDef('deepseek').baseUrl, 'https://api.deepseek.com/v1');
  assert.equal(providerDef('deepseek').authType, 'api-key');
  assert.equal(resolveCredential('deepseek', isolated), null);
  assert.equal(resolveCredential('deepseek', { ...isolated, env: { DEEPSEEK_API_KEY: 'test-value' } })?.type, 'api-key');
});

test('dario resolves a local placeholder credential while local stays key-optional', () => {
  assert.equal(resolveCredential('dario', isolated)?.source, 'local-default');
  assert.equal(resolveCredential('local', isolated), null);
  assert.equal(resolveCredential('openrouter', isolated), null);
  assert.equal(resolveCredential('openrouter', { ...isolated, env: { OPENROUTER_API_KEY: 'test-value' } })?.type, 'api-key');
});

test('model proposals stay inert until a separate confirmation', async () => {
  await withRoot(async (root) => {
    let applied = 0;
    const operator = operatorFor(root, {
      executeAction: async () => { applied += 1; return { ok: true }; },
      selfComplete: async () => JSON.stringify({
        message: 'proposal',
        actions: [{ tool: 'set_ui', args: { theme: 'light' }, reason: 'test', description: 'Light theme' }],
        links: [],
      }),
    });
    const reply = await operator.chat('light');
    assert.equal(reply.pending.length, 1);
    assert.equal(applied, 0, 'a proposal must not execute on its own');

    await operator.confirm(reply.pending[0].id);
    assert.equal(applied, 1);

    await assert.rejects(operator.confirm(reply.pending[0].id), /not found or expired/);
    assert.equal(applied, 1, 'a confirmation id is single-use');
  });
});

test('proposals outside the allowlist and links outside context are discarded', async () => {
  await withRoot(async (root) => {
    const operator = operatorFor(root, {
      selfComplete: async () => JSON.stringify({
        message: 'proposal',
        actions: [
          { tool: 'run_shell', args: { command: 'rm -rf /' }, reason: 'no', description: 'no' },
          { tool: 'set_ui', args: { theme: 'light' }, reason: 'ok', description: 'Light theme' },
        ],
        links: [{ label: 'phish', url: 'https://example.invalid/steal' }],
      }),
    });
    const reply = await operator.chat('do something');
    assert.deepEqual(reply.pending.map((action) => action.tool), ['set_ui']);
    assert.deepEqual(reply.links, []);
  });
});

test('operator text redaction strips bearer tokens, JWTs and long opaque secrets', () => {
  // Fixtures are assembled at run time so this file contains no literal string
  // that reads as a credential to the public-release audit.
  const fakeKey = ['sk', 'live', '0123456789abcdef'].join('-');
  const redacted = redactOperatorText(`use Authorization: ${['Bea', 'rer'].join('')} ${fakeKey} when calling`);
  assert.ok(!redacted.includes(fakeKey));
  assert.ok(redacted.includes('[REDACTED]'));

  const b64 = 'eyJ';
  const fakeJwt = [`${b64}hbGciOiJIUzI1NiJ9`, `${b64}zdWIiOiIxMjM0NTY3ODkwIn0`, 'abcdefghijklmnop'].join('.');
  assert.ok(!redactOperatorText(fakeJwt).includes(`${b64}zdWIi`));
});

test('saved operator settings validate presentation values and reject unknown ones', async () => {
  await withRoot(async (root) => {
    const operator = operatorFor(root);
    const saved = operator.saveSettings({ ui: { theme: 'light', density: 'compact', fontScale: 9 } });
    assert.equal(saved.ui.theme, 'light');
    assert.equal(saved.ui.density, 'compact');
    assert.equal(saved.ui.fontScale, 1.4, 'font scale is clamped rather than trusted');
    assert.throws(() => operator.saveSettings({ ui: { theme: 'neon' } }), /Invalid theme/);
  });
});

test('log-policy defaults keep every retention switch off and coerce what is saved', async () => {
  await withRoot(async (root) => {
    const operator = operatorFor(root);
    const fresh = operator.readSettings().logs;
    for (const flag of ['promptSummary', 'rawPrompts', 'rawResponses', 'rawToolBodies', 'credentials']) {
      assert.equal(fresh[flag], false, `${flag} must be off in a fresh install`);
    }

    // A truthy-but-not-true value must not enable a switch, and the ceilings
    // are clamped rather than trusted.
    const saved = operator.saveSettings({ logs: { rawPrompts: 'yes', promptSummary: true, maxRawChars: 10_000_000, maxSummaryChars: 5 } });
    assert.equal(saved.logs.rawPrompts, false);
    assert.equal(saved.logs.promptSummary, true);
    assert.equal(saved.logs.maxRawChars, 64_000);
    assert.equal(saved.logs.maxSummaryChars, 80);
  });
});

test('the operator model cannot enable raw retention, even through a confirmed action', () => {
  // The model proposes a plausible-looking log-policy change that also flips
  // every content-capture switch. Confirming it must apply the harmless parts
  // and silently drop the rest.
  const proposed = {
    promptSummary: true,
    maxSummaryChars: 400,
    rawPrompts: true,
    rawResponses: true,
    rawToolBodies: true,
    credentials: true,
  };
  const applied = stripHumanOnlyLogFlags(proposed);

  assert.deepEqual(applied, { promptSummary: true, maxSummaryChars: 400 });
  for (const flag of HUMAN_ONLY_LOG_FLAGS) {
    assert.equal(flag in applied, false, `${flag} must never survive a model proposal`);
  }
  // The guard must not invent keys for a proposal that set none of them.
  assert.deepEqual(stripHumanOnlyLogFlags({ promptSummary: false }), { promptSummary: false });
  assert.deepEqual(stripHumanOnlyLogFlags(), {});
});

test('security analysis reports operational classes from metadata alone', () => {
  const attempt = (providerStatus) => ({ provider: 'groq', outcome: 'error', providerStatus });
  const report = analyzeSanitizedRecords([
    { status: 502, outcome: 'failed', attempts: [attempt(401), attempt(403), attempt(401)] },
    { status: 200, outcome: 'served', client: { remoteCategory: 'public' }, attempts: [] },
  ]);
  const ids = report.findings.map((finding) => finding.id);
  assert.ok(ids.includes('auth-failures'));
  assert.ok(ids.includes('public-client'));
  assert.ok(report.findings.every((finding) => !JSON.stringify(finding).includes('Bearer')));
});

test('minor repair refuses files outside the allowlist and security-sensitive text', async () => {
  await withRoot(async (root) => {
    const allowFiles = ['src/webui/app.css'];
    fs.mkdirSync(path.join(root, 'src', 'webui'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'webui', 'app.css'), '.card { padding: 20px; }\n');

    assert.throws(
      () => applyMinorRepair({ root, file: 'src/server.js', search: 'a', replace: 'b', allowFiles }),
      /outside the minor-repair allowlist/,
    );
    assert.throws(
      () => applyMinorRepair({ root, file: '../escape.css', search: 'a', replace: 'b', allowFiles }),
      /outside the minor-repair allowlist/,
    );
    assert.throws(
      () => applyMinorRepair({ root, file: 'src/webui/app.css', search: '.card', replace: 'isLoopback', allowFiles }),
      /Security-sensitive code cannot be changed/,
    );
  });
});

test('the Chat page lives inside the dashboard and leaves log records to the Logs page', () => {
  const webui = path.join(ROOT, 'src', 'webui');
  const html = fs.readFileSync(path.join(webui, 'index.html'), 'utf8');
  const operatorJs = fs.readFileSync(path.join(webui, 'operator.js'), 'utf8');
  const css = fs.readFileSync(path.join(webui, 'app.css'), 'utf8');

  // The standalone page is gone; the operator is a dashboard page like any other.
  assert.equal(fs.existsSync(path.join(webui, 'operator.html')), false);
  assert.equal(fs.existsSync(path.join(webui, 'operator.css')), false);
  assert.match(html, /<section class="page" id="page-chat">/);
  assert.match(html, /<script type="module" src="\/operator\.js"><\/script>/);
  assert.doesNotMatch(html, /operator\.html/);

  // Same tab set as the FreeChain operator, and deliberately no Logs tab: the
  // dedicated Logs page stays the one place request records are read.
  for (const tab of ['chat', 'doctor', 'security', 'providers', 'settings']) {
    assert.match(html, new RegExp(`data-op-tab="${tab}"`), `missing Chat tab ${tab}`);
  }
  assert.doesNotMatch(html, /data-op-tab="logs"/);
  assert.doesNotMatch(operatorJs, /admin\/operator\/logs/);

  // Built from the dashboard's own components rather than a private stylesheet.
  for (const selector of ['.op-panel', '.op-bubble', '.op-pending', '.op-compose', '.op-fields']) {
    assert.ok(css.includes(selector), `missing ${selector} in app.css`);
  }
  assert.match(operatorJs, /nav-item\[data-page="chat"\]/);
});
