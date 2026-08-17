# Provider Accounts, Harness Guidance, and Usage Probe Design

## Goal

Keep the imported-preset search focused while a user types, represent multiple
credentialed accounts beneath each provider, explain every Harness field, and
report provider usage without presenting unknown values as zero.

## Decisions

SubChain will discover accounts from supported private credential sources and
numbered provider slots. It will never inspect browser cookies, infer account
ownership with a model, or add a discovered account to a routing chain. A user
must explicitly select an account when adding a chain link or direct local-key
target.

Providers and Overview will group account records by provider family. Each
account uses a private editable alias plus the provider name, for example
`Primary account · Anthropic Claude`. Raw account identities and local paths do
not cross the admin API.

Usage has two explicit origins:

1. Provider-reported quota and summary data gathered by Ping.
2. Request and token totals observed locally by SubChain.

Unknown or unpublished provider quota remains unknown. It is never converted
to zero.

## Search behavior

The imported-preset toolbar is a stable DOM shell. Loading, filtering,
selection, and preview updates replace only their own result regions. The
search input node, value, focus, and selection therefore survive the debounce
and asynchronous request lifecycle.

## Account discovery

The credential layer exposes a secret-free list of provider ids that resolve
from supported sources. It creates one resolver context per discovery pass and
checks only the documented base and numbered ids. Inventory merges these ids
with provider families, configured chain links, and persisted status records.

The default account is labelled `Primary account`. Numbered slots use
`Account 2`, `Account 3`, and so on because the unnumbered provider is the first
account. Editable aliases are stored in the existing private provider-status
file.

Managed providers remain single-account until their official application
surface supports independently addressable sessions. Multiple browser tabs or
browser identities are not treated as reusable provider credentials.

## Dashboard structure

The Providers page renders one family section per provider with an `Accounts`
subsection containing account cards. Each card keeps Ping, subscription
management, quota, provider-reported usage, local observations, model catalog,
and routing-count controls scoped to its exact provider id.

Overview renders the same family grouping in a compact form. Every discovered
or configured account is present, including accounts that are not yet linked
to a chain. Readiness and routing state remain separate.

Chain selectors use the combined account and provider label so two accounts
from one family cannot be confused.

## Harness guidance

Harness section metadata owns all inline guidance. Every section has a short
purpose statement. Every field has a valid-value statement and a safe typical
example. JSON sections include valid object examples, and custom metadata
continues to state that credential, cookie, host, and connection headers are
blocked.

The guide copy is operating documentation. It does not contain credentials,
personal identifiers, or machine-specific locations.

## Usage probes

HTTP provider Ping continues to use read-only model discovery. A Ping never
sends a billable completion solely to obtain quota.

- Anthropic parses its documented request, token, input-token, and
  output-token rate-limit headers when present.
- Generic OpenAI-compatible providers parse request and token headers when
  present.
- Codex continues to use documented app-server rate-limit and usage methods,
  and the dashboard renders the returned summary.
- Gemini, Kimi, Zhipu, and Sakana remain `Not published` when their current
  Ping credential does not expose account-wide quota. Normal SubChain traffic
  still accumulates local request and token totals.
- Documented exhaustion errors remain available to routing and cooling logic,
  but do not create invented remaining percentages.

Quota header parsing is shared between Ping and normal response tracking so an
Anthropic response updates the same account bucket consistently.

## Privacy and security

- Credential values never enter provider inventory, status JSON, logs, tests,
  screenshots, or documentation.
- Account aliases are private local metadata and are bounded to 120 characters.
- Admin operations remain loopback-only.
- Imported presets remain inert text.
- Discovered accounts never change routing without an explicit user action.

## Verification

Focused tests cover stable preset-search mounting, complete Harness guidance,
credential-slot discovery, account grouping, combined labels, null quota round
trips, Anthropic quota buckets, and provider-reported usage rendering helpers.

Full verification runs `npm test`, JavaScript syntax checks, the public audit,
and diff validation. Live verification restarts the local worker, confirms
continuous typing after the debounce and response, inspects Providers and
Overview account sections, and Pings available accounts without exposing
credential or identity data.
