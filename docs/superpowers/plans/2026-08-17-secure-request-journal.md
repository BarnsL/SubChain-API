# Secure Request Journal Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Adapt the FreeChain journal into a SubChain-native, local-key-scoped request and admin audit journal with a secure API and operator dashboard.

**Architecture:** Reuse the sanitized journal record and persistence mechanics, then enforce SubChain ownership at the query boundary. Client `/v1/logs` authenticates a local key and can only see records bearing that immutable key ID. Loopback-only `/admin/logs` provides the cross-scope operator view and may resolve safe display names. Existing routing, Harness, quota, and provider status stores remain authoritative.

**Tech Stack:** Node.js 20 standard library, SubChain routing/auth/quota modules, plain HTML/CSS/JavaScript dashboard, Node test runner.

---

### Task 1: Port and specialize the journal core test-first

**Files:**
- Create: `test/request-journal.test.js`
- Create: `src/request-journal.js`

**Step 1: Write failing tests**

Port the FreeChain persistence, rotation, sanitization, query, exact/estimated usage, and SSE tests. Add SubChain tests for `localKeyId`, target type/id, Harness ID, transport, normalized quota metadata, and provider account identifiers while proving local key tokens, private paths, prompt bodies, preset bodies, and provider identities are absent.

**Step 2: Run and confirm RED**

Run: `node --test test/request-journal.test.js`

**Step 3: Implement the adjusted core**

Keep record schema and query semantics structurally aligned with FreeChain. Add a query ownership predicate so a client scope is applied before pagination, filtering, search, or summary calculation.

**Step 4: Run and confirm GREEN**

Run: `node --test test/request-journal.test.js`

### Task 2: Enforce scoped and operator API boundaries

**Files:**
- Modify: `test/server-routing.test.js`
- Modify: `test/admin-api.test.js`
- Modify: `src/server.js`

**Step 1: Write failing API tests**

Create two local keys and prove:

- each `GET /v1/logs` sees only its own records;
- filters, search, and cursors cannot cross the key boundary;
- invalid credentials receive 401 and do not parse bodies;
- `/admin/logs` works from loopback and rejects a simulated non-loopback peer;
- admin results expose safe local key names while client results do not;
- managed and HTTP transports journal compatible attempts, target, Harness, usage, quota, cooling, and sanitized failures;
- log reads never recursively journal themselves.

**Step 2: Run focused tests and confirm RED**

Run: `node --test test/server-routing.test.js test/admin-api.test.js`

**Step 3: Integrate request lifecycle records**

Extend `createServer` with a journal dependency. Authenticate before request summarization, attach the immutable local key ID returned by `authenticateLocalKey`, record the selected routing target and Harness ID, consume `usageFromPayload()` for exact response usage, and read provider/quota/cooling snapshots without changing their cumulative accounting.

**Step 4: Add scoped APIs**

Implement authenticated `/v1/logs` with a fixed local-key ownership predicate and loopback-only `/admin/logs` with safe display-name decoration. Apply `Cache-Control: no-store` and the existing admin origin/content-type protections.

**Step 5: Run focused tests and confirm GREEN**

Run: `node --test test/request-journal.test.js test/server-routing.test.js test/admin-api.test.js`

### Task 3: Persist privately and expose CLI controls

**Files:**
- Modify: `test/storage.test.js` or add a focused CLI source test
- Modify: `bin/subchain.mjs`

**Step 1: Write failing tests**

Assert the default journal path is `path.join(resolveDataDir(), 'logs', 'requests.jsonl')`, `--log <path>` overrides it, and `--no-log` disables disk persistence without disabling the in-memory operator view.

**Step 2: Run and confirm RED**

Run the focused storage or CLI test.

**Step 3: Inject the journal**

Create one journal per worker beside the private secret/routing stores and pass it to `createServer`. Do not place journal files in the repository or expose the resolved private pathname through any API.

**Step 4: Run and confirm GREEN**

Run the focused test plus `test/request-journal.test.js`.

### Task 4: Add the scoped Logs dashboard

**Files:**
- Modify: `test/webui-state.test.js`
- Modify: `src/webui/index.html`
- Modify: `src/webui/app.js`
- Modify: `src/webui/app.css`

**Step 1: Write failing UI contract tests**

Assert Logs appears between Chain and Harness and includes operator-scope filters, local-key labels, target/Harness/transport fields, exact/estimated usage labels, privacy copy, and complete loading/empty/error states.

**Step 2: Run and confirm RED**

Run: `node --test test/webui-state.test.js`

**Step 3: Implement the operator view**

Use loopback `/admin/logs`, visible ten-second refresh while active, filters for outcome/provider/app/route/local key/target/transport/search, compact rows, expandable attempts and quota/cooling details, and responsive stacked rows. Preserve the incumbent dashboard vocabulary and do not expose tokens or private paths.

**Step 4: Run and confirm GREEN**

Run: `node --test test/webui-state.test.js`

### Task 5: Journal meaningful admin audit events

**Files:**
- Modify: `test/admin-api.test.js`
- Modify: `src/server.js`
- Modify: `README.md`
- Modify: `docs/TROUBLESHOOTING.md`

**Step 1: Write failing audit tests**

Cover local-key reveal/rotate/create/update/delete, chain create/link add/link delete/reorder, Harness create/update/delete/assignment/preset application, provider rename/Ping, and subscription connect/cancel lifecycle. Assert records contain metadata IDs and operation outcomes only.

**Step 2: Implement the admin audit wrapper**

Finalize one sanitized record around each meaningful mutation or credential reveal. Exclude passive state, inventory, preset search/read, connection status polls, static assets, and log polling.

**Step 3: Document scope and recovery**

Document client versus operator boundaries, private storage and rotation, safe metadata, token estimation, usage/quota authority, flags, and shared-device risk.

### Task 6: Verify SubChain end to end

**Files:** all changed SubChain files

**Step 1: Run focused and full tests**

Run: `npm test`

Expected: all tests pass.

**Step 2: Run the public security audit**

Run: `npm run audit:public`

Confirm no private runtime paths, credentials, local tokens, or imported Harness content enter the publishable scope.

**Step 3: Run an isolated live server**

Use a temporary data directory, two scoped local keys, one HTTP upstream, and one managed-transport fixture. Prove per-key API isolation, loopback operator access, JSONL reload, and sentinel absence.

**Step 4: Inspect the dashboard**

Capture desktop and mobile populated Logs views, run the Impeccable detector once, batch-fix mechanical findings, and complete the finish review.

