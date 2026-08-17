# OpenAI Subscription Enrollment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add supported ChatGPT-managed enrollment and prove a scoped SubChain local key can use the connected OpenAI Codex subscription.

**Architecture:** Keep OAuth ownership inside the official Codex app-server. Add one in-memory device-code lifecycle to the managed transport, expose allowlisted loopback admin routes, and render a provider-card connection panel that hands the user to the official verification page before refreshing the existing Ping data.

**Tech Stack:** Node.js ESM, `node:test`, Codex app-server JSONL RPC, zero-dependency browser JavaScript and CSS.

## Global Constraints

- Never read, copy, persist, return, or log ChatGPT OAuth tokens or account identity fields.
- Do not use undocumented consumer endpoints or experimental external-token authentication.
- Keep connect and status routes loopback-only; POST routes require JSON and reject cross-site requests.
- Preserve the separate `openai-api` API-key provider.
- Keep all UI copy platform-neutral and free of personal paths.
- Use test-first red, green, refactor cycles for every behavior change.

---

### Task 1: Managed ChatGPT device-code lifecycle

**Files:**
- Modify: `test/managed-transports.test.js`
- Modify: `src/managed-transports.js`

**Interfaces:**
- Produces: `managed.startLogin('codex-app-server') -> Promise<LoginSnapshot>`
- Produces: `managed.loginStatus('codex-app-server') -> LoginSnapshot`
- Produces: `managed.cancelLogin('codex-app-server') -> Promise<LoginSnapshot>`
- `LoginSnapshot` is an allowlisted object with `status`, optional `verificationUrl`, optional `userCode`, optional `expiresAt`, and optional sanitized `message`.

- [ ] **Step 1: Write failing lifecycle tests**

Add tests whose fake RPC implements the documented account surface and assert
real transport outcomes:

```js
const pending = await managed.startLogin('codex-app-server');
assert.deepEqual(pending, {
  status: 'pending',
  verificationUrl: 'https://auth.openai.com/codex/device',
  userCode: 'ABCD-1234',
  expiresAt: 901_000,
});
assert.equal(JSON.stringify(pending).includes('accessToken'), false);
```

Cover an existing ChatGPT account returning `ready`, duplicate start reuse,
matching completion notification, cancellation, and a Codex API-key account
being rejected by Ping as not subscription-backed.

- [ ] **Step 2: Run the focused test and verify red**

Run: `node --test test/managed-transports.test.js`

Expected: FAIL because `startLogin`, `loginStatus`, and `cancelLogin` do not
exist and Ping currently accepts an API-key account.

- [ ] **Step 3: Implement the minimal lifecycle**

In `src/managed-transports.js`, keep one private login state and RPC connection
inside `createManagedTransports`. Start `chatgptDeviceCode`, validate the HTTPS
URL and one-time code, subscribe to `account/login/completed`, close on terminal
states, and expose only the allowlisted snapshot. Update `pingCodex` to require
`account.type === 'chatgpt'`.

- [ ] **Step 4: Run the focused test and verify green**

Run: `node --test test/managed-transports.test.js`

Expected: every managed transport test passes with no child-process or timer
leak.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/managed-transports.js test/managed-transports.test.js
git commit -m "feat: enroll managed ChatGPT subscriptions"
```

### Task 2: Protected enrollment admin API

**Files:**
- Modify: `test/admin-api.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Consumes: the three managed login methods from Task 1.
- Produces: `GET|POST /admin/providers/openai-codex/connect` and
  `POST /admin/providers/openai-codex/connect/cancel`.

- [ ] **Step 1: Write failing route tests**

Use a real loopback `createServer` instance with a narrow managed transport
fixture. Assert POST returns the allowlisted pending snapshot, GET returns the
same snapshot, cancel returns `cancelled`, another provider id returns 404, and
a cross-site POST returns 403 before invoking the managed transport.

- [ ] **Step 2: Run the focused test and verify red**

Run: `node --test test/admin-api.test.js`

Expected: FAIL with 404 on the new route.

- [ ] **Step 3: Implement minimal route dispatch**

Add exact OpenAI Codex connect routes ahead of the generic provider matcher.
Return no RPC object, token, login id, identity field, or stderr. Reuse the
existing loopback, content-type, Fetch Metadata, and error response boundaries.

- [ ] **Step 4: Run the focused test and verify green**

Run: `node --test test/admin-api.test.js`

Expected: all admin API tests pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/server.js test/admin-api.test.js
git commit -m "feat: expose protected ChatGPT enrollment"
```

### Task 3: Provider-card connection workflow

**Files:**
- Modify: `src/webui/app.js`
- Modify: `src/webui/app.css`
- Modify: `test/admin-routing.test.js`
- Modify: `src/admin.js`

**Interfaces:**
- Consumes: Task 2 routes.
- Produces: provider inventory fields `canConnectSubscription` and accurate
  `hasCredential` after managed authentication is reported missing.

- [ ] **Step 1: Write the failing provider inventory test**

Add a literal inventory fixture proving a managed provider with stored
`health: 'missing'` reports `hasCredential: false` and
`canConnectSubscription: true` while a ready managed provider remains
credentialed.

- [ ] **Step 2: Run the focused test and verify red**

Run: `node --test test/admin-routing.test.js`

Expected: FAIL because runtime availability currently makes a missing managed
account look credentialed and the connection capability is absent.

- [ ] **Step 3: Implement inventory and browser behavior**

Fix the managed runtime versus managed authentication distinction in
`src/admin.js`. In `src/webui/app.js`, render **Connect ChatGPT subscription**
only for the eligible missing account, call the start route, show the one-time
code and official verification link, poll status, run Ping on completion, and
support cancellation. Keep the panel compact inside the existing provider
card. Add only the CSS required for the code panel and narrow viewport wrapping.

- [ ] **Step 4: Run focused checks**

Run:

```bash
node --test test/admin-routing.test.js
node --check src/webui/app.js
```

Expected: inventory tests and JavaScript syntax pass.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/admin.js src/webui/app.js src/webui/app.css test/admin-routing.test.js
git commit -m "feat: connect ChatGPT from provider cards"
```

### Task 4: Operations documentation and release proof

**Files:**
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `DEPLOYMENT.md`
- Modify: `ISSUES.md`
- Modify: `docs/TROUBLESHOOTING.md`
- Modify: `docs/provider-access/openai-codex.md`

**Interfaces:**
- Documents: the device-code lifecycle, separate API-key lane, exact source map,
  failure recovery, and scoped local-key client contract.

- [ ] **Step 1: Update operating documentation**

Document Connect, one-time code handling, automatic refresh ownership, direct
local-key routing, failure states, and the rule that a ChatGPT subscription is
not an OpenAI API key. Add the closed implementation ticket to `ISSUES.md`.

- [ ] **Step 2: Run full automated verification**

Run:

```bash
npm test
node --check src/webui/app.js
npm run audit:public
git diff --check
```

Expected: zero failures, syntax errors, sensitive-data findings, or diff errors.

- [ ] **Step 3: Run live verification**

Restart the exact SubChain worker, verify the dashboard and connect status route,
Ping the authenticated OpenAI subscription, ensure a dedicated local key targets
`openai-codex`, and send one minimal OpenAI-compatible completion through that
key without printing it.

- [ ] **Step 4: Commit and publish**

```bash
git add README.md SECURITY.md DEPLOYMENT.md ISSUES.md docs/TROUBLESHOOTING.md docs/provider-access/openai-codex.md
git commit -m "docs: operate OpenAI subscription access"
git push origin main
```

Expected: remote `main` matches local `HEAD`, the repository is publicly
reachable, and the remote contributor API reports only BarnsL.
