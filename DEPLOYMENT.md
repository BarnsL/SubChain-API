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
| ChatGPT subscription enrollment | `src/managed-transports.js`, `src/server.js`, `src/admin.js`, `src/webui/app.js`, `src/webui/subscription-login-state.js`, `src/webui/subscription-card-dom.js`, `src/webui/app.css` | `test/managed-transports.test.js`, `test/admin-api.test.js`, `test/admin-routing.test.js`, `test/subscription-login-state.test.js` |
| Account labels, health, models, quotas, observed usage | `src/provider-status.js`, `src/quota.js` | allowlist tests, atomic private persistence |
| Chain dispatch and usage accounting | `src/chain.js` | fallback, cooldown, quota, response-shape tests |
| Local keys, scopes, chain limits | `src/routing.js`, `src/admin.js` | routing and admin tests, no key rotation on metadata edit |
| Named Harness persistence and request merge | `src/harness.js` | migration and component-order tests |
| Preset import, provenance, classification | `bin/import-presets.mjs`, `src/presets.js` | manifest, path, filter, preview tests |
| HTTP routes and loopback admin boundary | `src/server.js` | auth-before-model-listing and loopback API tests |
| Dashboard structure and behavior | `src/webui/index.html`, `src/webui/app.js`, `src/webui/ui-state.js` | browser QA, syntax check, state tests |
| Harness component guidance, tooltips and preset relevance | `src/webui/app.js`, `src/webui/app.css`, `docs/HARNESS.md` | `test/harness-guidance.test.js`, browser QA |
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

When the OpenAI Codex card reports no ChatGPT login, choose **Connect ChatGPT
subscription**. Open the official verification URL shown by the card and enter
the one-time code on that page. Codex owns OAuth storage and refresh. SubChain
keeps only an in-memory, sanitized enrollment state and never copies tokens or
identity. This is not the direct OpenAI API lane: API keys, billing, rate
limits, and model availability remain separate.

The enrollment status endpoint is loopback-only. Start and cancel requests are
JSON-only and reject cross-site Fetch Metadata. After connection, Ping refreshes
models and account health. Route an application with a scoped local key that
targets `openai-codex` directly, or a chain containing it. Use `model: auto` or
a model returned by that key's scoped `/v1/models` result.

For a pending enrollment, finish at the official page or cancel it. For an
expired, failed, or cancelled enrollment, start a new connection. For a
refresh-error, the ChatGPT sign-in remains connected: retry **Ping** rather
than enrolling again.

### Parity with dario

Checked against `askalf/dario` on 2026-08-18. dario is not a multi-provider
catalog: `src/provider-adapter.ts` declares `type ProviderId = 'claude' |
'openai'`, where `claude` is the OAuth subscription transport and `openai` is
any OpenAI-compatible base URL added with `dario backend add <name> --key
--base-url`. Groq, OpenRouter and Ollama appear in its README as example base
URLs for that generic backend, not as separate providers.

Every one of those is already covered here, so **no provider was missing** and
none was added. What was missing were models, not providers: dario derives a
`[1m]` long-context variant for every family except haiku, and the `dario`
entry in `src/providers.js` advertised `contextWindow: 1_000_000` while listing
no model id that could reach it. The three `[1m]` ids are now listed there.

Re-run this comparison against `src/provider-adapter.ts` and
`src/model-catalog.ts`, not the README, which describes example configurations
rather than a catalog.

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

## Dashboard layout contract

### Text containment

Shared rule with the other two chain dashboards: no string may overflow its card, and the page
itself never scrolls sideways. `src/webui/app.css` ends with a zero-specificity `:where()` block
that gives every card-like container `min-width: 0` and `overflow-wrap: anywhere`, and pushes
anything genuinely unwrappable (`<pre>`, tables) into its own horizontal scroll box.

It is structural rather than per-component on purpose. Provider ids, model names, base URLs, request
ids, key chips and raw upstream error text are all lengths this project does not control, so fixing
one card only moves the bug to the next card someone adds. Writing the block with `:where()` keeps
its specificity at zero, so deliberate widths set elsewhere still win.

Change it in FreeChain, SubChain and VisionChain together, and verify at 1280px and at 380px.

### Grids size on the container, not the viewport

A card grid must be `repeat(auto-fit, minmax(<real minimum>, 1fr))`, never a fixed column count
with a media query as its escape hatch.

The failure this prevents is not hypothetical. The Logs summary was `repeat(4, minmax(0, 1fr))`
relaxed to two columns below an 880px viewport. At a 960px window the 248px sidebar is still
present, so the content column is only ~620px: above the breakpoint, but four tiles wide. Each
tile got 105px of usable width for a 95px label, and the filter row — a fixed five columns —
clipped its placeholders to "chain or provide". The viewport was never the constraint; the
container was, and a viewport media query cannot see it.

`minmax(0, ...)` is the specific trap. It permits a track to shrink to nothing, which is right for
a scroll container and wrong for anything holding text. Give every text-bearing track a minimum it
can actually be read at.

Verify by narrowing the window with the sidebar visible, not by narrowing past the breakpoint —
the bug lives between those two states.


