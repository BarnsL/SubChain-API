# Deploying and modifying SubChain

## Supported deployment

Run SubChain on the same machine as the applications that use its local keys.
Leave the host on loopback unless a separately reviewed network access layer is
in place. A non-loopback `--host` is rejected unless the launch also includes
the explicit `--allow-network` acknowledgement. The dashboard and every admin
route remain loopback-only.

```bash
npm test
npm start
```

The launcher prints the dashboard URL. Create or select a local key, assign one
provider or chain, then assign one named Harness. The stable client contract is:

```text
base URL: http://127.0.0.1:4854/v1
API key: <one scoped SubChain local key>
model: auto
```

The port may be overridden. The `/v1` suffix and local-key authentication are
part of the contract. `auto` walks the key's selected chain; an explicit model
must be inside that key's scope.

## Request flow

```text
OpenAI-compatible client
  -> server.js authenticates one scoped local key
  -> routing.js resolves that key's provider or chain and named Harness
  -> harness.js merges the selected components and safe metadata
  -> chain.js selects an eligible account and exact model
     -> HTTP provider: transforms.js + provider endpoint
     -> managed provider: managed-transports.js + provider-owned client
  -> quota.js and provider-status.js record sanitized local observations
  -> server.js returns the OpenAI-compatible response
```

Model listing follows the same local-key boundary. `/v1/models` never exposes a
model outside the authenticated key's destination. Dashboard mutations are
loopback-only, require JSON for POST requests, and reject cross-site browser
requests before parsing their bodies.

## Configuration and private state

- `.env` is an ignored override file. Start from `.env.example`.
- `routing.config.json` is ignored secret-free metadata because it still
  discloses private routing choices.
- Generated local keys, account status, named Harnesses, managed transport
  workspaces, and imported presets live in platform application data.
- `SUBCHAIN_DATA_DIR` can select a managed private application-data directory.
- Existing `SUBCHAIN_ACCESS_KEY` migrates into the Default local key without
  changing its value.

## Source ownership map

| Change needed | Primary source | Required companion checks |
|---|---|---|
| Launcher, host, port, worker lifecycle | `bin/subchain.mjs`, `src/supervisor.js`, `src/runtime.js` | health check, worker restart behavior |
| Environment parsing | `src/envfile.js`, `src/config.js` | configuration tests and public audit |
| Portable credential discovery | `src/auth.js` | `test/auth.test.js`, provider access guide |
| Provider labels, endpoints, fallback models | `src/providers.js` | provider tests, dynamic Chain menus |
| Provider request transforms | `src/transforms.js` | request fixture for the affected provider |
| HTTP model and quota Ping | `src/provider-probes.js` | bounded timeout, sanitized result tests |
| Managed Codex and Antigravity transports | `src/managed-transports.js`, `src/jsonl-rpc.js` | fake-client tests plus approved live probe |
| Account labels, health, models, quotas, observed usage | `src/provider-status.js`, `src/quota.js` | allowlist tests, atomic private persistence |
| Chain dispatch and usage accounting | `src/chain.js` | fallback, cooldown, quota, response-shape tests |
| Local keys, scopes, chain limits | `src/routing.js`, `src/admin.js` | routing and admin tests, no key rotation on metadata edit |
| Named Harness persistence and request merge | `src/harness.js` | migration and component-order tests |
| Preset import, provenance, classification | `bin/import-presets.mjs`, `src/presets.js` | manifest, path, filter, preview tests |
| HTTP routes and loopback admin boundary | `src/server.js` | auth-before-model-listing and loopback API tests |
| Dashboard structure and behavior | `src/webui/index.html`, `src/webui/app.js`, `src/webui/ui-state.js` | browser QA, syntax check, state tests |
| Dashboard layout and responsive behavior | `src/webui/app.css` | wide and narrow viewport inspection |
| Private file locations and permissions | `src/storage.js` | storage tests on supported platforms |
| Public-release scan | `scripts/audit-public-release.mjs` | run against the exact staged commit |
| Provider operating instructions | `docs/provider-access/` | update with every auth or Ping change |
| Known work and verification evidence | `ISSUES.md` | update status in the same change |

## Provider operations

The Providers page has one card per configured account. **Ping** performs a
read-only model, quota, and account-health refresh. An automatic initial Ping
runs for configured accounts. Provider-reported limits are shown separately
from locally observed request and token totals. Absence of a quota API must be
shown as unknown, never as unlimited.

Managed Codex uses the documented local app-server and the Codex-owned ChatGPT
sign-in. It does not need a copied OAuth token. Managed Antigravity keeps its
authentication inside that client and reports separate Google-model and
Claude/GPT quota families when the client exposes them.

## Release checklist

```bash
npm test
npm run audit:public
git diff --cached --check
```

Then inspect `git status --short`, the staged diff, and the user-visible local
dashboard. Verify account Ping, named Harness persistence, local-key Harness
assignment, scoped `/v1/models`, and one OpenAI-compatible completion. Confirm
the staged history uses the intended single contributor name. A public release
must not include credentials, generated presets, routing files, private logs,
absolute user paths, account identities, or personal contributor details.
