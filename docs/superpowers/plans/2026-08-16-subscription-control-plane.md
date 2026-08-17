# Subscription Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build account-level subscription routing, live model and quota discovery, manual provider pings, named composable Harnesses, and per-local-key Harness selection without exposing provider credentials.

**Architecture:** Retain the existing provider-slot identifiers and HTTP chain dispatcher, then add managed-client transports for Codex and Antigravity, a private provider-status store, and a versioned Harness library. Dashboard state remains secret-free and loopback administration owns every mutation.

**Tech Stack:** Node.js 20 standard library, `node:test`, plain DOM JavaScript, CSS, JSONL JSON-RPC for Codex app-server, and installed provider CLIs where supported.

## Global Constraints

- Never expose credentials, local API keys, account emails, private source paths, imported preset bodies, or raw provider identifiers in logs or documentation.
- Admin, provider ping, account rename, Harness mutation, and local-key reveal routes remain loopback-only.
- Codex uses its documented managed ChatGPT authentication before any token-extraction fallback is considered.
- Imported presets remain inert local data and are never vendored into Git.
- Existing routing and Harness files migrate without rotating local API keys.
- Keep the existing dark teal dashboard visual system and make controls keyboard accessible and responsive.
- Write a failing focused test before every non-trivial production change.

---

### Task 1: Migrate routing and Harness persistence

**Files:**
- Modify: `src/routing.js`
- Replace: `src/harness.js`
- Modify: `src/admin.js`
- Modify: `test/routing.test.js`
- Modify: `test/harness.test.js`
- Modify: `test/admin-routing.test.js`

**Interfaces:**
- Produces: `loadHarnessLibrary(file)`, `saveHarnessLibrary(library, file)`, `createHarness(library, input)`, `updateHarness(library, id, input)`, `removeHarness(library, id)`, `applyHarnessConfig(body, harness)`
- Produces: routing schema version 3 with `localKeys[].harnessId`
- Consumes: existing private local-key secret store and routing persistence

- [ ] **Step 1: Write failing routing migration and validation tests**

```js
test('migrates schema version 2 local keys to the Default Harness', () => {
  const migrated = migrateRouting({
    schemaVersion: 2,
    chains: [{ id: 'default', name: 'Default', links: [{ provider: 'kimi', model: 'k3' }] }],
    localKeys: [{ id: 'default', name: 'Default', secretRef: 'local-key:default', target: { type: 'chain', id: 'default' } }],
  });
  assert.equal(migrated.schemaVersion, 3);
  assert.equal(migrated.localKeys[0].harnessId, 'default');
});
```

- [ ] **Step 2: Run the focused test and confirm it fails because migration and `harnessId` do not exist**

Run: `node --test test/routing.test.js test/admin-routing.test.js`

- [ ] **Step 3: Implement routing version 3 migration and local-key Harness validation**

```js
export function migrateRouting(raw) {
  if (raw?.schemaVersion === 3) return raw;
  if (raw?.schemaVersion !== 2) throw new Error('routing config must use schemaVersion 2 or 3');
  return {
    ...raw,
    schemaVersion: 3,
    localKeys: raw.localKeys.map((key) => ({ ...key, harnessId: key.harnessId || 'default' })),
  };
}
```

`addLocalKey` and `updateLocalKey` accept `harnessId`, while persistence validates that it is a lowercase identifier. Harness existence is checked in the server against the current library before saving the key.

- [ ] **Step 4: Write failing Harness-library tests**

```js
test('migrates the singleton Harness to a named Default Harness', () => {
  const library = loadHarnessLibrary(file);
  assert.equal(library.schemaVersion, 2);
  assert.equal(library.harnesses[0].id, 'default');
  assert.equal(library.harnesses[0].components.operatingInstructions, 'existing instruction');
});

test('composes prompt components in deterministic order', () => {
  const output = applyHarnessConfig(request, harness);
  assert.equal(output.messages[0].content, 'Identity\n\nOperate\n\nSafety\n\nStyle\n\nPersona');
});
```

- [ ] **Step 5: Run the Harness test and confirm the missing-library failure**

Run: `node --test test/harness.test.js`

- [ ] **Step 6: Implement the named Harness library and component merge**

Use atomic private JSON writes. Default components are:

```js
{
  identity: '', operatingInstructions: '', persona: '', behavioralMode: '',
  safetyPolicy: '', toolPolicy: '', reasoningPolicy: '', outputStyle: '',
  generation: {}, infrastructure: {}, aliases: {}, headers: {}
}
```

- [ ] **Step 7: Run focused and full tests**

Run: `node --test test/routing.test.js test/admin-routing.test.js test/harness.test.js && npm test`

- [ ] **Step 8: Commit the migration**

```bash
git add src/routing.js src/harness.js src/admin.js test/routing.test.js test/admin-routing.test.js test/harness.test.js
git commit -m "feat: add named harness persistence"
```

### Task 2: Add account status, models, quota buckets, and pings

**Files:**
- Modify: `src/providers.js`
- Modify: `src/auth.js`
- Replace: `src/quota.js`
- Create: `src/provider-status.js`
- Create: `src/provider-probes.js`
- Modify: `src/admin.js`
- Create: `test/provider-status.test.js`
- Create: `test/provider-probes.test.js`
- Modify: `test/auth.test.js`

**Interfaces:**
- Produces: `createProviderStatusStore({ file, clock })`
- Produces: `listProviderAccounts({ runtime, statusStore })`
- Produces: `pingProviderAccount(providerId, dependencies)`
- Produces: `QuotaTracker.merge(providerId, snapshot)` and `QuotaTracker.recordUsage(providerId, usage)`
- Consumes: `resolveCredential(providerId)` and provider definitions

- [ ] **Step 1: Write failing account-status tests**

```js
test('stores account aliases and multi-bucket quota without secrets', () => {
  const store = createProviderStatusStore({ file, clock: () => 1000 });
  store.rename('openai-codex', 'Codex Pro 1');
  store.recordPing('openai-codex', {
    health: 'ready', plan: 'pro', models: [{ id: 'gpt-example' }],
    quotas: [{ id: 'codex', usedPercent: 18, windowMinutes: 10080 }],
  });
  const account = store.get('openai-codex');
  assert.equal(account.name, 'Codex Pro 1');
  assert.equal(account.quotas[0].usedPercent, 18);
  assert.equal(JSON.stringify(account).includes('token'), false);
});
```

- [ ] **Step 2: Run the test and confirm the module-not-found failure**

Run: `node --test test/provider-status.test.js`

- [ ] **Step 3: Implement the atomic private provider-status store and account inventory**

Only configured numbered slots appear. Managed clients appear when their executable can be resolved. Default HTTP families remain visible even when missing credentials so setup guidance remains discoverable.

- [ ] **Step 4: Write failing probe and quota tests**

```js
test('manual ping refreshes models and records unknown quota honestly', async () => {
  const result = await pingProviderAccount('kimi', { fetchImpl, statusStore, now: () => 2000 });
  assert.deepEqual(result.models.map((model) => model.id), ['k3', 'k3-256k']);
  assert.deepEqual(result.quotas, [{ id: 'provider', status: 'unknown' }]);
});

test('quota tracking is isolated by provider account', () => {
  tracker.merge('anthropic1', { quotas: [{ id: 'plan', usedPercent: 75 }] });
  assert.equal(tracker.get('anthropic1').quotas[0].usedPercent, 75);
  assert.equal(tracker.get('anthropic2'), null);
});
```

- [ ] **Step 5: Run the probe tests and confirm they fail for missing account-level tracking**

Run: `node --test test/provider-probes.test.js`

- [ ] **Step 6: Implement provider definitions, live model normalization, and bounded pings**

Split `openai-codex` from `openai-api`, add `google-antigravity`, attach `fallbackModels`, and normalize provider model records to:

```js
{ id, label, inputModalities, capabilities, quotaFamily }
```

Every ping has a timeout, sanitizes errors, and preserves the last successful model list when a refresh fails.

- [ ] **Step 7: Run focused and full tests**

Run: `node --test test/provider-status.test.js test/provider-probes.test.js test/auth.test.js && npm test`

- [ ] **Step 8: Commit account discovery**

```bash
git add src/providers.js src/auth.js src/quota.js src/provider-status.js src/provider-probes.js src/admin.js test/provider-status.test.js test/provider-probes.test.js test/auth.test.js
git commit -m "feat: track provider accounts and live models"
```

### Task 3: Integrate managed Codex and Antigravity transports

**Files:**
- Create: `src/jsonl-rpc.js`
- Create: `src/codex-app-server.js`
- Create: `src/managed-transports.js`
- Modify: `src/chain.js`
- Modify: `src/routing.js`
- Modify: `src/transforms.js`
- Create: `test/jsonl-rpc.test.js`
- Create: `test/codex-app-server.test.js`
- Create: `test/managed-transports.test.js`
- Modify: `test/server-routing.test.js`

**Interfaces:**
- Produces: `createJsonlRpcProcess({ command, args, cwd, timeoutMs })`
- Produces: `createCodexClient(options).inspect()` and `.complete(request, options)`
- Produces: `managedCompletion({ link, body, signal })`
- Consumes: exact provider link `transport` and private managed-client working directory

- [ ] **Step 1: Write a failing real-subprocess JSONL test**

The test starts a temporary Node script that echoes JSON-RPC responses and proves initialization, request correlation, timeout handling, stderr sanitization, and child termination.

```js
const rpc = await createJsonlRpcProcess({ command: process.execPath, args: [fixture] });
await rpc.initialize({ clientInfo: { name: 'subchain', title: 'SubChain', version: '0.1.0' } });
assert.deepEqual(await rpc.request('model/list', { limit: 20 }), { data: [{ id: 'gpt-example' }] });
await rpc.close();
```

- [ ] **Step 2: Run the JSONL test and confirm the module-not-found failure**

Run: `node --test test/jsonl-rpc.test.js`

- [ ] **Step 3: Implement the minimal JSONL process client**

Use `spawn` without a shell, newline-bounded parsing, monotonically increasing numeric request IDs, one timeout per request, abort propagation, bounded stderr, and deterministic child cleanup.

- [ ] **Step 4: Write failing Codex inspection and completion tests against a fake app-server**

```js
test('Codex inspection drops account email and preserves quota buckets', async () => {
  const result = await client.inspect();
  assert.equal(result.account.plan, 'pro');
  assert.equal('email' in result.account, false);
  assert.deepEqual(result.quotas.map((bucket) => bucket.id), ['codex', 'codex_other']);
});

test('Codex completion returns OpenAI-compatible JSON and never enables write access', async () => {
  const result = await client.complete(request, { model: 'gpt-example' });
  assert.equal(result.choices[0].message.content, 'answer');
  assert.equal(fakeServer.threadStart.sandbox.type, 'readOnly');
});
```

- [ ] **Step 5: Run the Codex tests and confirm they fail for the absent client**

Run: `node --test test/codex-app-server.test.js`

- [ ] **Step 6: Implement Codex discovery and completion through official app-server methods**

Use `account/read`, `model/list`, `account/rateLimits/read`, and `account/usage/read` for Ping. For completion, initialize, start an isolated thread with the selected model and restricted read-only sandbox, start one turn, collect agent-message deltas until `turn/completed`, convert to Chat Completions JSON or SSE, archive/close, and terminate the child.

- [ ] **Step 7: Write and run failing Antigravity transport tests**

The fake command emits a complete `agy models` list and JSON generation result. Assert model quota families are `google-models` or `third-party-models`, command arguments include `--mode plan`, `--sandbox`, `--disable-slash-commands`, and no token argument exists.

Run: `node --test test/managed-transports.test.js`

- [ ] **Step 8: Implement Antigravity discovery and isolated headless completion**

Use the installed `agy` command, a private empty workspace, `--new-project`, `--mode plan`, `--sandbox`, and structured JSON output. If quota totals are not machine-readable, expose the two documented buckets with `status: "unknown"` and update observed usage from each response.

- [ ] **Step 9: Dispatch managed transports and keep HTTP behavior unchanged**

`dispatch` branches only when `link.transport !== 'http'`. It keeps cooldown, threshold, attempt, abort, and account-level usage behavior consistent for both lanes.

- [ ] **Step 10: Run focused and full tests**

Run: `node --test test/jsonl-rpc.test.js test/codex-app-server.test.js test/managed-transports.test.js test/server-routing.test.js && npm test`

- [ ] **Step 11: Commit managed subscription routing**

```bash
git add src/jsonl-rpc.js src/codex-app-server.js src/managed-transports.js src/chain.js src/routing.js src/transforms.js test/jsonl-rpc.test.js test/codex-app-server.test.js test/managed-transports.test.js test/server-routing.test.js
git commit -m "feat: route managed Codex subscriptions"
```

### Task 4: Classify presets and expose named Harness administration

**Files:**
- Modify: `src/presets.js`
- Modify: `src/server.js`
- Modify: `test/presets.test.js`
- Modify: `test/admin-api.test.js`

**Interfaces:**
- Produces: `classifyPreset(entry, contentPreview)`
- Extends: `listPresetEntries({ source, query, functionId, limit })`
- Adds: loopback Harness CRUD routes and explicit component-target preset application
- Consumes: Harness library functions from Task 1

- [ ] **Step 1: Write failing deterministic classification tests**

```js
test('classifies persona, tool policy, and full Harness presets', () => {
  assert.equal(classifyPreset({ title: 'Persona', file: 'persona.md' }, '').functionId, 'persona');
  assert.equal(classifyPreset({ title: 'Tool rules', file: 'tools.md' }, '').functionId, 'tool-policy');
  assert.equal(classifyPreset({ title: 'System prompt', file: 'system.md' }, '').functionId, 'full-harness');
});
```

- [ ] **Step 2: Run the preset test and confirm the missing-classifier failure**

Run: `node --test test/presets.test.js`

- [ ] **Step 3: Implement bounded, deterministic multi-source classification**

Return `{ functionId, functionLabel, confidence, bundle }`. Search and filters use metadata plus classification without returning prompt content. `readPresetEntry` returns content only for the selected identifier.

- [ ] **Step 4: Write failing loopback Harness API tests**

Exercise create, rename/update, duplicate, delete, and apply-preset routes. Assert deleting `default` is rejected and applying a preset changes only the explicitly selected component.

- [ ] **Step 5: Run the API test and confirm the routes are absent**

Run: `node --test test/admin-api.test.js`

- [ ] **Step 6: Implement the routes and local-key Harness validation**

Use `/admin/harnesses`, `/admin/harnesses/:id`, and `/admin/harnesses/:id/preset`. Return secret-free Harness metadata in `/admin/state`.

- [ ] **Step 7: Run focused and full tests**

Run: `node --test test/presets.test.js test/admin-api.test.js && npm test`

- [ ] **Step 8: Commit Harness administration**

```bash
git add src/presets.js src/server.js test/presets.test.js test/admin-api.test.js
git commit -m "feat: classify presets and manage harnesses"
```

### Task 5: Rebuild Providers, Harnesses, chains, and local-key UI

**Files:**
- Modify: `src/webui/index.html`
- Modify: `src/webui/app.js`
- Modify: `src/webui/app.css`
- Modify: `src/webui/ui-state.js`
- Modify: `test/webui-state.test.js`

**Interfaces:**
- Consumes: account-level providers, models, Harness library, and Ping endpoints from Tasks 2 through 4
- Produces: manual Ping controls, account rename, dynamic model menus, named Harness editor, and local-key Harness selectors

- [ ] **Step 1: Write failing state tests for refresh-safe provider pings and Harness selection**

```js
test('tracks one pending ping per provider without collapsing Harness sections', () => {
  const state = createDashboardUiState(storage);
  state.startPing('openai-codex');
  state.setHarnessExpanded('safetyPolicy', true);
  state.finishPing('openai-codex');
  assert.equal(state.isHarnessExpanded('safetyPolicy'), true);
  assert.equal(state.isPinging('openai-codex'), false);
});
```

- [ ] **Step 2: Run the UI-state test and confirm the missing behavior**

Run: `node --test test/webui-state.test.js`

- [ ] **Step 3: Implement UI state and remove hardcoded models**

Model options come from `provider.models`. Preserve a currently saved model if a failed live refresh omits it. Button busy state is local to the selected provider and survives the state refresh.

- [ ] **Step 4: Build expanded account cards and manual Ping controls**

Cards use semantic headings, an editable account-name field, quota-bucket rows, observed usage, last checked time, model count, credential source, health badge, Ping button, and management link. Long names wrap and every header reserves the same action column.

- [ ] **Step 5: Build the named-Harness workspace and local-key selector**

The editor has a Harness list, create/duplicate/delete controls, component cards, explicit save feedback, classified preset filters, preview, and component target. Local-key create/edit forms submit `harnessId` without rotating the key.

- [ ] **Step 6: Remove the Candidates overview card and update status summaries**

Overview shows Endpoint, Links configured, and Requests served only. Provider status cards use account-level health and quota information.

- [ ] **Step 7: Load the Impeccable craft floor, edit, then run its detector once**

Run: `node <impeccable-skill>/scripts/detect.mjs --json src/webui/index.html src/webui/app.js src/webui/app.css`

- [ ] **Step 8: Run focused and full tests**

Run: `node --test test/webui-state.test.js && npm test`

- [ ] **Step 9: Commit the dashboard overhaul**

```bash
git add src/webui/index.html src/webui/app.js src/webui/app.css src/webui/ui-state.js test/webui-state.test.js
git commit -m "feat: overhaul provider and harness controls"
```

### Task 6: Complete operations and maintenance documentation

**Files:**
- Replace: `ISSUES.md`
- Create: `docs/TROUBLESHOOTING.md`
- Modify: `DEPLOYMENT.md`
- Modify: `README.md`
- Modify: `ADDING-PROVIDERS.md`
- Modify: `docs/PRESETS.md`
- Modify: `docs/provider-access/README.md`
- Modify: `docs/provider-access/anthropic.md`
- Replace: `docs/provider-access/openai-codex.md`
- Create: `docs/provider-access/openai-api.md`
- Create: `docs/provider-access/google-antigravity.md`
- Create: `docs/provider-access/google-gemini.md`
- Modify: `docs/provider-access/kimi.md`
- Modify: `docs/provider-access/zhipu.md`
- Modify: `docs/provider-access/sakana.md`
- Modify: `SECURITY.md`

**Interfaces:**
- Documents: source ownership, supported auth lanes, provider Ping semantics, model discovery, quota uncertainty, Harness composition, and release process
- Consumes: verified runtime behavior from Tasks 1 through 5

- [ ] **Step 1: Move troubleshooting and create the ticket ledger**

Each ticket includes ID, status, severity, owner surface, acceptance criteria, implementation files, and verification evidence. Completed tickets cover this plan; remaining provider limitations stay open with an exact next action.

- [ ] **Step 2: Expand the deployment and source modification map**

Map each user-visible behavior to its owning source module, route, browser renderer, persistence file category, focused test, and live verification command.

- [ ] **Step 3: Standardize provider playbooks**

Every provider document uses Purpose, Supported lanes, Credential ownership, Discovery, Ping and quota, Routing, Security boundaries, Troubleshooting, and Verification sections. No private path or credential appears.

- [ ] **Step 4: Update public and security guides**

Document the stable client contract, Codex managed OAuth ownership, Antigravity quota families, manual Ping behavior, named Harness binding, and public-release checks.

- [ ] **Step 5: Run documentation safety checks**

Run: `npm run audit:public` and `git diff --check`

- [ ] **Step 6: Commit documentation**

```bash
git add ISSUES.md docs DEPLOYMENT.md README.md ADDING-PROVIDERS.md SECURITY.md
git commit -m "docs: map subscription operations"
```

### Task 7: Live verification, security review, merge, and push

**Files:**
- Verify: all changed files
- Do not stage: local routing files, credentials, imported presets, logs, `.claude`, `.serena`, or `skill-observations`

**Interfaces:**
- Consumes: every completed task
- Produces: public branch with current runtime evidence and one contributor identity

- [ ] **Step 1: Run complete automated verification**

Run:

```bash
npm test
npm run audit:public
git diff --check
```

- [ ] **Step 2: Run metadata-only provider pings and one bounded live routing probe per supported managed transport**

Confirm account names are sanitized, model lists are populated, numeric quota buckets are exact when supplied, unknown quotas stay labeled unknown, and no credential appears in output.

- [ ] **Step 3: Start SubChain on an unused loopback port and exercise the administrative API**

Verify account Ping, account rename, Harness CRUD, local-key Harness selection, scoped `/v1/models`, and one OpenAI-compatible completion. Shut down the verification server afterward.

- [ ] **Step 4: Inspect the live dashboard at desktop and narrow widths**

Confirm the Candidates card is gone, every provider card aligns, long status text fits, Ping buttons work, model menus use live data, expanded Harness sections remain open, named Harness changes persist, and local keys retain their tokens after Harness assignment.

- [ ] **Step 5: Review staged content and contributor identity**

Inspect `git status --short`, `git diff --cached`, tracked absolute paths, high-entropy secret patterns, commit author names, and third-party provenance. Do not print account emails or credential values.

- [ ] **Step 6: Merge the verified feature branch to `main` and push**

Use a fast-forward merge when the public branch has not moved. Re-run `npm test` and `npm run audit:public` from `main`, then push `main` to the configured public origin.
