# Provider Accounts, Harness Guidance, and Usage Probes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve Harness search focus, discover and group multiple provider accounts, explain every Harness field, and report provider usage without false zero values.

**Architecture:** Add a secret-free credential discovery pass to the existing provider inventory, derive family and account presentation metadata in the admin DTO, and keep routing explicit. Share provider-specific quota parsing between Ping and normal responses, render provider-reported and locally observed usage separately, and keep the preset toolbar mounted while only its dynamic regions update.

**Tech Stack:** Node.js ESM, `node:test`, zero-dependency browser JavaScript and CSS, loopback HTTP admin API.

## Global Constraints

- Never expose credential values, account identities, private paths, or browser session data.
- Never add discovered accounts to a routing chain automatically.
- Keep admin and key-reveal routes loopback-only.
- Treat imported presets as inert text.
- Render unknown provider quota as `Not published`, never `0%`.
- Use no new runtime or test dependency.
- Use test-first red, green, refactor cycles for every behavior change.

---

### Task 1: Correct quota persistence and provider header parsing

**Files:**
- Modify: `test/provider-status.test.js`
- Modify: `test/provider-probes.test.js`
- Modify: `test/routing.test.js`
- Modify: `src/provider-status.js`
- Modify: `src/quota.js`
- Modify: `src/provider-probes.js`

**Interfaces:**
- Produces: `quotaBucketsFromHeaders(providerId, headers, now) -> QuotaBucket[]` in `src/quota.js`.
- `QuotaBucket.usedPercent`, `limit`, `remaining`, `windowMinutes`, and `resetsAt` preserve `null` when unavailable.
- Consumes: `providerDef(providerId).family` to select Anthropic or generic header names.

- [ ] **Step 1: Write failing null and Anthropic tests**

Add a provider-status round-trip whose quota contains null numeric fields and
assert every field remains null after write and read. Add an Anthropic header
fixture containing request, token, input-token, and output-token limits,
remaining counts, and RFC 3339 resets. Assert four exact buckets and percentages.

- [ ] **Step 2: Run focused tests and verify red**

Run:

```powershell
node --test test/provider-status.test.js test/provider-probes.test.js
```

Expected: null fields become zero and Anthropic headers return an unknown
bucket.

- [ ] **Step 3: Implement the shared parser and null-safe normalization**

Move header parsing to `src/quota.js`. Parse `anthropic-ratelimit-requests-*`,
`anthropic-ratelimit-tokens-*`, `anthropic-ratelimit-input-tokens-*`, and
`anthropic-ratelimit-output-tokens-*`. Keep the existing generic
`x-ratelimit-*` behavior. Update `QuotaTracker.update` and HTTP Ping to use the
same function. Replace coercive null conversion in `safeQuota` with an explicit
null, undefined, and blank check.

- [ ] **Step 4: Run focused tests and verify green**

Run:

```powershell
node --test test/provider-status.test.js test/provider-probes.test.js test/routing.test.js
```

Expected: all focused tests pass and no unknown quota becomes zero.

- [ ] **Step 5: Record a commit checkpoint**

```powershell
git add src/provider-status.js src/quota.js src/provider-probes.js test/provider-status.test.js test/provider-probes.test.js test/routing.test.js
git commit -m "fix: report provider quota accurately"
```

### Task 2: Discover configured account slots and expose account metadata

**Files:**
- Modify: `test/auth.test.js`
- Modify: `test/admin-routing.test.js`
- Modify: `src/auth.js`
- Modify: `src/admin.js`

**Interfaces:**
- Produces: `configuredCredentialProviderIds(providerIds, options) -> string[]`.
- Produces provider DTO fields: `providerLabel`, `accountLabel`, and `displayName`.
- Consumes: every documented id from `FAMILIES.flatMap(familyMembers)`.

- [ ] **Step 1: Write failing discovery and inventory tests**

Create isolated credential-directory and credential-environment fixtures with
two numbered Anthropic slots and one numbered Google slot. Assert discovery
returns only their provider ids, never token values. In inventory tests inject
a discovery function and assert both configured slots appear while the ordinary
credential resolver is called only for ids included in the final inventory.

- [ ] **Step 2: Run focused tests and verify red**

Run:

```powershell
node --test test/auth.test.js test/admin-routing.test.js
```

Expected: the discovery export and account presentation fields are absent.

- [ ] **Step 3: Implement secret-free discovery and presentation metadata**

Refactor credential resolution to reuse one private context during a discovery
pass. Add discovered ids to inventory alongside family, linked, and stored ids.
Derive `Primary account` for an unnumbered id and `Account N` for numbered slots,
then combine the editable alias and provider family label without exposing raw
identity fields.

- [ ] **Step 4: Run focused tests and verify green**

Run:

```powershell
node --test test/auth.test.js test/admin-routing.test.js
```

Expected: all account discovery and inventory tests pass.

- [ ] **Step 5: Record a commit checkpoint**

```powershell
git add src/auth.js src/admin.js test/auth.test.js test/admin-routing.test.js
git commit -m "feat: discover provider account slots"
```

### Task 3: Stabilize preset search and define complete Harness guidance

**Files:**
- Create: `src/webui/harness-schema.js`
- Modify: `src/webui/ui-state.js`
- Modify: `src/webui/app.js`
- Modify: `test/webui-state.test.js`
- Create: `test/harness-schema.test.js`

**Interfaces:**
- Produces: `ensureStableShell(root, selector, markup) -> Element` in `src/webui/ui-state.js`.
- Produces: exported `HARNESS_COMPONENTS` and `HARNESS_SECTIONS` metadata.
- Every section has `guide`; every field has `valid` and `typical` strings.

- [ ] **Step 1: Write failing stable-shell and schema tests**

Use a minimal fake root whose `innerHTML` setter creates one stable search
object. Call `ensureStableShell` twice and assert the setter ran once and the
same search object remains. Iterate Harness metadata and assert all guide,
valid, and typical strings are non-empty, including both JSON sections.

- [ ] **Step 2: Run focused tests and verify red**

Run:

```powershell
node --test test/webui-state.test.js test/harness-schema.test.js
```

Expected: the helper and schema module do not exist.

- [ ] **Step 3: Implement the stable shell and inline guides**

Mount the preset heading, explanation, toolbar, count, results, and preview
containers only once. Update option lists, count, results, and preview without
replacing the search input. Synchronize its value only when it is not the active
element. Move Harness metadata into `harness-schema.js` and render section
purpose, valid values, and typical examples beneath each field.

- [ ] **Step 4: Run focused tests and syntax checks**

Run:

```powershell
node --test test/webui-state.test.js test/harness-schema.test.js
node --check src/webui/app.js
node --check src/webui/harness-schema.js
```

Expected: focused tests and syntax checks pass.

- [ ] **Step 5: Record a commit checkpoint**

```powershell
git add src/webui/app.js src/webui/ui-state.js src/webui/harness-schema.js test/webui-state.test.js test/harness-schema.test.js
git commit -m "fix: preserve Harness search focus"
```

### Task 4: Group provider accounts in Providers and Overview

**Files:**
- Modify: `src/webui/ui-state.js`
- Modify: `src/webui/app.js`
- Modify: `src/webui/app.css`
- Modify: `test/webui-state.test.js`

**Interfaces:**
- Produces: `groupProvidersByFamily(providers) -> Array<{ family, providerLabel, accounts }>`.
- Consumes: `providerLabel`, `accountLabel`, and `displayName` from Task 2.

- [ ] **Step 1: Write a failing grouping test**

Provide two Anthropic accounts and one Gemini account in mixed order. Assert
two stable family groups, both Anthropic accounts in their original order, and
no mutation of the source array.

- [ ] **Step 2: Run the focused test and verify red**

Run: `node --test test/webui-state.test.js`

Expected: `groupProvidersByFamily` is missing.

- [ ] **Step 3: Implement grouped dashboard rendering**

Render one provider-family section with an `Accounts` heading and exact account
cards on Providers. Render compact family cards with every discovered or
configured account on Overview, including unlinked accounts. Use `displayName`
in chain selectors. Add only the CSS needed for nesting, compact account rows,
responsive wrapping, and provider-reported usage summaries.

- [ ] **Step 4: Run focused tests and syntax checks**

Run:

```powershell
node --test test/webui-state.test.js
node --check src/webui/app.js
```

Expected: grouping tests and syntax checks pass.

- [ ] **Step 5: Record a commit checkpoint**

```powershell
git add src/webui/ui-state.js src/webui/app.js src/webui/app.css test/webui-state.test.js
git commit -m "feat: group provider accounts"
```

### Task 5: Operating documentation and end-to-end verification

**Files:**
- Modify: `README.md`
- Modify: `docs/provider-access/README.md`
- Modify: `docs/provider-access/anthropic.md`
- Modify: `docs/provider-access/openai-codex.md`
- Modify: `docs/provider-access/google.md`
- Modify: `docs/provider-access/kimi.md`
- Modify: `docs/provider-access/zhipu.md`
- Modify: `docs/provider-access/sakana.md`

**Interfaces:**
- Documents: numbered account registration, account naming, explicit routing,
  Harness guides, metric provenance, and provider-specific Ping limits.

- [ ] **Step 1: Update source-adjacent operating documentation**

Document the supported numbered credential forms, why browser identities are
not imported, how account aliases and routing interact, every provider's Ping
capability, and the distinction between provider-reported and locally observed
usage. Do not include credentials, personal identifiers, or local paths.

- [ ] **Step 2: Run full automated verification**

Run:

```powershell
npm test
node --check src/webui/app.js
node --check src/webui/harness-schema.js
npm run audit:public
git diff --check
```

Expected: zero failures, syntax errors, sensitive-data findings, or diff
errors.

- [ ] **Step 3: Restart and verify the live dashboard**

Restart the exact local SubChain worker without printing environment values.
Type multiple characters through the preset-search debounce and response, then
assert focus and caret remain in the search input. Inspect Providers and
Overview for provider-family `Accounts` sections, combined account and provider
labels, unlinked discovered accounts, Harness field guides, provider-reported
usage, and honest `Not published` quota states.

- [ ] **Step 4: Record the final commit checkpoint**

```powershell
git add README.md docs/provider-access src/webui src/auth.js src/admin.js src/provider-status.js src/provider-probes.js src/quota.js test docs/superpowers
git commit -m "feat: add provider account control plane"
```
