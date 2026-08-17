# Subscription Control Plane Design

## Goal

Turn SubChain into a local subscription control plane that can route through
separately named provider accounts, discover their current models, refresh
their health and quota state on demand, compose named Harness configurations,
and bind one Harness and one destination to each local API key.

## Security boundary

SubChain must not copy OAuth credentials when a supported local client can own
the sign-in lifecycle. The OpenAI Codex subscription uses `codex app-server`
over its default JSONL standard-input transport. Codex owns and refreshes its
ChatGPT OAuth tokens. SubChain requests only account metadata, models, rate
limits, usage summaries, and isolated ephemeral generations.

The Codex transport uses an empty private working directory and a restricted
read-only sandbox. It instructs the upstream agent not to invoke tools. It does
not read or return account email fields. Direct token extraction and
undocumented consumer endpoints remain unsupported unless the documented
transport stops providing the required capability and a separate security
review approves the fallback.

API-key providers continue to resolve credentials through portable override,
environment, app-specific, configured credential-directory, and platform-store
categories. No diagnostic or dashboard response contains a credential or a
private source path.

## Provider accounts and transports

The existing numbered provider identifiers are retained as account slots. A
provider account record contains:

- stable provider identifier and family
- editable local account name
- transport type and generic credential source
- plan label when reported by the provider
- current health and last-ping result
- live model catalogue and discovery time
- zero or more quota buckets
- request and token usage observed by SubChain
- provider-management URL

OpenAI is split into `openai-codex` for the managed ChatGPT subscription and
`openai-api` for an ordinary metered API key. Google is split into `google` for
the Gemini API and `google-antigravity` for the local Antigravity subscription.
Antigravity reports two quota families: Google models and third-party Claude or
GPT models.

Transport adapters share a small interface:

```js
{
  isAvailable(accountId),
  listModels(accountId, options),
  ping(accountId, options),
  complete(accountId, request, options)
}
```

HTTP API-key providers use the existing fetch pipeline. Codex uses its
documented app-server protocol. Antigravity uses its installed command-line
client and cached sign-in without copying tokens. A provider that cannot
report a numeric limit returns an explicit `unknown` quota instead of an
invented estimate.

## Manual ping and usage tracking

Every provider account card has a Ping button. The loopback-only endpoint
refreshes account status, models, quota buckets, and usage. Duplicate clicks
while a ping is active are rejected, requests have fixed timeouts, and errors
are returned as sanitized messages.

For Codex, the ping calls `account/read`, `model/list`,
`account/rateLimits/read`, and `account/usage/read`. For HTTP providers, it
uses the documented model endpoint and records any quota headers. When the
provider exposes no quota endpoint or headers, SubChain records the successful
health probe and labels quota as unknown. Actual routed responses continuously
update observed request and token totals.

## Dynamic model catalogues

Model choices are read from the provider-account status store instead of a
browser constant. The server caches the last successful live list in private
app data and ships a conservative static fallback per transport. Models retain
capability metadata when the provider supplies it. Google API catalogues are
filtered to models that support text generation before appearing in chain
menus.

## Named Harnesses

The singleton Harness file migrates to a versioned Harness library. Each named
Harness has independently editable components:

- identity
- operating instructions
- persona
- behavioral mode
- safety policy
- tool policy
- reasoning policy
- output style
- generation defaults
- infrastructure defaults
- model aliases and request headers

The Default Harness preserves existing settings. Each local API key stores a
`harnessId`, defaulting to `default` during migration. Request processing is:

1. authenticate the local API key
2. resolve its destination scope
3. resolve its named Harness
4. merge Harness defaults into a cloned request
5. transform for the selected provider transport
6. dispatch and record account-level usage

Harness prompts are ordered as identity, operating instructions, safety, tool
policy, reasoning, output style, behavioral mode, and persona. Provider
transforms may move content to a provider-compatible role but must not drop it.
Anthropic subscription requests retain the required Claude Code identity in
the system block and place additional operating instructions into the first
user message.

## Preset classification

Imported third-party files remain inert and private. A private classification
index gives every catalog entry a function, source, confidence, and bundle
flag. Classification is deterministic and uses source metadata, file names,
prompt identifiers, descriptions, and bounded text signatures. Supported
functions match the Harness components plus `full-harness` and `unclassified`.
Users can filter by function and explicitly choose the target component before
applying a preset. Applying a full bundle never silently overwrites multiple
components.

## Dashboard behavior

The Overview page removes the Candidates card. Provider status cards keep a
stable grid, wrap long account and status text, and put health badges and Ping
buttons in the same position on every card.

The Providers page presents one expanded account card per available
subscription or API-key slot. Each card exposes the editable local name,
transport, plan, generic credential source, health, quota buckets, observed
usage, live model count, last refresh time, Ping control, and management link.

The Harness page becomes a named-Harness editor with create, rename, duplicate,
and delete controls, component navigation, preset filters, and explicit save
status. Expansion state remains user-controlled across background refreshes.

The Local keys page adds a Harness selector to creation and editing forms. A
key change does not rotate its token.

## Persistence and compatibility

Routing metadata moves to schema version 3 and adds only `harnessId` to local
key records. Existing version 2 files migrate in memory and are saved as
version 3. Generated local tokens remain in the private credential store.

Provider status and Harness libraries live in platform app data unless their
existing override options select another location. Imported presets, model
caches, account aliases, quota snapshots, and observed usage remain ignored by
Git.

## Documentation and release evidence

`ISSUES.md` becomes the active implementation ticket ledger. Existing
troubleshooting material moves to `docs/TROUBLESHOOTING.md`. `DEPLOYMENT.md`
gains a source ownership map covering credentials, accounts, transports,
models, quotas, routing, Harnesses, presets, UI surfaces, and verification.
Provider-access playbooks document supported subscription and API-key lanes.

Release requires focused red-green tests, the complete test suite, the public
release audit, an Impeccable detector pass, loopback API exercises, and visual
verification of the live dashboard at desktop and narrow widths. The staged
diff must contain no credentials, private paths, imported prompt bodies, raw
account identifiers, or additional contributor identity.
