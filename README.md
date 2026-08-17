# SubChain API

SubChain provides one local OpenAI-compatible endpoint in front of scoped
provider chains. A local API key reaches exactly one provider or one ordered
chain, so separate apps can receive separate routing boundaries.

```
app ──► http://127.0.0.1:4854/v1 ──► local key ──► provider or chain
```

It runs on Windows, macOS, and Linux with Node 20 or newer. It has no runtime
package dependencies.

## Start

```bash
cp .env.example .env
npm test
npm start
```

Open the loopback dashboard printed by the launcher. The first start migrates a
legacy `chain.config.json` into secret-free `routing.config.json` metadata and
keeps an existing `SUBCHAIN_ACCESS_KEY` valid. Generated local API keys live in
private platform app data, not in the repository or routing manifest.

For a fresh clone, the launcher creates an ignored `chain.config.json` from the
public `chain.config.example.json` starter. It is a new, editable five-link
chain rather than a migrated compatibility chain.

Use the dashboard to create up to ten local keys, then assign each key to one
provider or one chain and one named Harness. You can create up to ten chains
and add up to five provider subscriptions to each new chain. The migrated
Default chain is a compatibility exception: it keeps its existing links but
cannot grow past five.

## Connect an app

Set the app's base URL to the local endpoint and use one of your local keys.

```text
base URL: http://127.0.0.1:4854/v1
API key: <local SubChain key>
model: auto
```

`auto` walks the selected chain. A direct-provider key instead uses that
provider's last successful Ping catalog, choosing its first model for `auto`.
A named model is accepted only if it is inside that key's selected provider or
chain. Before a provider has a successful Ping catalog, SubChain uses its safe
provider fallback catalog without changing routing metadata.

## Credentials and providers

Credentials resolve from explicit SubChain overrides, conventional environment
variables, conventional provider-app locations, configured private sources, and
platform-native stores when available. Set `SUBCHAIN_CREDENTIALS_DIR` or
`SUBCHAIN_CREDENTIAL_ENV_FILE` only in ignored local configuration when a shared
credential source is deliberately approved. `.env` is an override layer. The
dashboard reports only a generic source category and never returns provider
credentials to the browser.

The base provider credential serves that provider family once. Additional
numbered provider slots require an explicit `SUBCHAIN_<PROVIDER><N>_API_KEY`
override, so a single credential is never misreported as several accounts.

The dashboard represents each configured provider subscription as an account.
Each account has an editable local label, a manual **Ping** action, discovered
models, provider-reported quota windows when available, and locally observed
request and token totals. A Ping is read-only and never returns credentials or
account identity fields to the browser.

Supported lanes are Anthropic, managed OpenAI Codex, direct OpenAI API, Kimi,
Google Gemini API, managed Google Antigravity, Zhipu AI GLM, and Sakana AI.
Managed Codex uses the documented local `codex app-server` interface and lets
Codex own the ChatGPT sign-in and token refresh lifecycle. SubChain never copies
Codex OAuth tokens or calls an undocumented consumer endpoint. Direct OpenAI
API keys remain a separate account because API Platform billing and ChatGPT
subscription limits are different. Read the standardized provider instructions
in [docs/provider-access](docs/provider-access/README.md).

To enroll a missing OpenAI Codex account, select **Connect ChatGPT
subscription** on its Providers card. Open the official verification page shown
by the card and enter its one-time code there. Codex stores and refreshes the
sign-in. The app-server `account/read` response enters SubChain and supplies
account and authentication state plus plan. Identity properties in that
response are ignored and are not persisted, logged, or returned. A separate
`account/rateLimits/read` call supplies quota and rate-limit buckets. SubChain
never copies Codex tokens. After completion, the card refreshes its normal Ping
data. Assign a local key directly to OpenAI Codex, or to a chain containing it,
then use `model: auto` or a model discovered for that key.

## Harnesses

A named Harness is the request policy assigned to a local key. It can combine
identity, operating instructions, safety policy, tool policy, reasoning policy,
output style, behavioral mode, persona, generation defaults, infrastructure
settings, model aliases, and safe metadata. Background dashboard refreshes do
not close expanded Harness sections, and the browser remembers each section's
state per Harness.

## Presets

Import the three requested public prompt collections into private local app data:

```bash
npm run import-presets
```

The importer accepts only declared text or JSON prompt paths, writes a manifest
with source URL, revision, licence copy, and checksums, and does not execute
imported content. Prompt bodies are intentionally never vendored into this
public repository. The Harness page classifies every imported entry by likely
function so a preset can be previewed and applied to the appropriate Harness
component in replace or append mode. See [docs/PRESETS.md](docs/PRESETS.md).

## Safety model

- Provider credentials and generated local keys are excluded from version control.
- Local key comparisons use constant-time equality.
- Admin and key-reveal routes accept loopback peers only.
- Each local key is scoped before model listing or dispatch.
- `npm run audit:public` scans the staged release for known credential and
  machine-path indicators before publishing.

Read [SECURITY.md](SECURITY.md) before exposing the endpoint outside the local
machine. The default host is loopback and is the supported configuration.

## Contributor guide

Use [ADDING-PROVIDERS.md](ADDING-PROVIDERS.md) for provider work,
[DEPLOYMENT.md](DEPLOYMENT.md) for releases, and [AGENTS.md](AGENTS.md) for the
required implementation and verification contract.
