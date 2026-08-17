# SubChain Secure Request Journal Design

**Date:** 2026-08-17
**Status:** Approved adjustment of the FreeChain observability design, pending implementation
**Scope:** A SubChain-native clone of the secure request journal, API, and Logs page

## Goal

Bring the FreeChain request-journal capability into SubChain without copying FreeChain's single-key assumptions. SubChain must preserve per-local-key routing isolation, managed-provider privacy, existing quota accounting, loopback-only administration, and private platform app-data storage.

## Why this is an adjusted clone

The visible Logs experience and the privacy contract must remain recognizable across both routers, but SubChain has different trust boundaries:

- Up to ten local API keys may select different providers or chains.
- A local key may not inspect another key's routing or request history.
- The dashboard's administrative view is allowed only from a loopback peer.
- Provider account labels and managed-client identity fields are private operator metadata.
- Usage is already normalized by `usageFromPayload()`, `QuotaTracker`, and the provider status store.
- Managed transports may return normalized OpenAI payloads without exposing their underlying tokens.

The implementation therefore shares the journal record vocabulary, retention limits, redaction policy, and UI patterns, but integrates through SubChain's routing and storage abstractions.

## Journal and storage

Add a SubChain `RequestJournal` module with the same schema version and privacy invariants as FreeChain. Store production logs at `logs/requests.jsonl` under `resolveDataDir()`, never in the repository or beside public routing metadata.

- 500-record in-memory limit
- 5 MiB active JSONL file
- One 5 MiB rotated predecessor
- Best-effort owner-only file mode
- Malformed-line recovery at startup
- `--log <path>` override
- `--no-log` in-memory-only mode

The journal file contains local-key IDs, provider IDs, chain IDs, and Harness IDs only. It never contains local-key tokens, provider credentials, provider account identity fields, private credential paths, prompt bodies, response bodies, tool arguments, or managed-client tokens.

## Record additions for SubChain

In addition to the common request metadata, a SubChain record may include:

- Authenticated local-key ID and configured display name
- Target type and target ID, such as provider or chain
- Harness ID
- Serving account slot ID, never provider account identity
- Transport category, such as HTTP or managed client
- Existing normalized quota family and usage fields
- Threshold or cooling reason that affected candidate order

The display name is operator-authored local metadata. It is returned only on the loopback administrative surface. The scoped API view returns the stable local-key ID but not other keys or private account labels.

## API boundaries

### Scoped client API

Add `GET /v1/logs`. It authenticates through `authenticateLocalKey()` and returns only records whose local-key ID matches the caller. A valid key can never infer another key's existence, name, target, Harness, providers, errors, or activity.

The scoped response supports the common `limit`, `before`, `status`, `provider`, `app`, `route`, and sanitized `q` filters. It sends `Cache-Control: no-store` and excludes itself from recording.

### Loopback operator API

Add `GET /admin/logs`. It is available only when the UI is enabled and `isLoopbackAddress()` accepts the peer, matching the existing key-reveal and routing-administration boundary. It returns the cross-scope operator view used by the dashboard.

No network-bound administrative logs endpoint is introduced. If SubChain runs with `--allow-network`, `/admin/logs` remains unavailable to non-loopback peers.

## Lifecycle integration

Instrument `/v1/models` and `/v1/chat/completions` before local-key authentication so rejected calls produce terminal records without storing the presented token. Do not parse the body of a rejected request; record its input summary as unavailable before authentication. After authentication, attach only the matched local-key ID and its allowed routing target.

For chat completions:

1. Summarize the input shape before Harness application.
2. Record the selected Harness ID and the post-Harness requested model and generation metadata without retaining Harness text or custom header values.
3. Consume existing `dispatch()` attempt callbacks for provider and managed-transport attempts.
4. Reuse `usageFromPayload()` for exact non-streaming usage.
5. Reuse `QuotaTracker` and the provider status store as the authoritative cumulative usage owners.
6. Observe streaming SSE only for allowlisted finish and usage metadata while returning transformed or untransformed bytes unchanged.
7. Record the post-request cooling and quota snapshots relevant to the serving or failed providers.

Do not add a parallel usage counter with different normalization. Journal entries are per-request evidence; existing quota and provider-status objects remain the cumulative totals.

## Administrative audit events

Record sanitized metadata for actions that explain routing or credential drift:

- Local-key reveal, rotation, creation, update, and deletion
- Chain creation, link changes, and reorder
- Harness assignment and update
- Provider Ping and managed subscription lifecycle actions

The event records action class, affected stable ID, terminal status, and request ID. They never retain request bodies, newly returned tokens, verification codes, provider identities, preset bodies, or Harness text. Passive state polling, static assets, quota polling, and log polling are excluded.

## Dashboard Logs page

Place Logs immediately after Chain and before Harness in the left sidebar. The dashboard loads the loopback operator view from `/admin/logs`.

The page mirrors FreeChain's summary tiles, filters, request table, expandable lifecycle detail, exact-versus-estimated token labels, retention state, and privacy notice. Authenticated records show local-key, routing target, Harness, and transport columns. Pre-authentication failures leave those fields explicitly unavailable.

All local-key names, Harness names, provider labels, client-reported app labels, errors, and filter values are escaped. The UI never receives provider credentials, local-key tokens, managed account identity, raw prompt or output content, or custom Harness header values.

## Shared and separate code

The two repositories remain independently buildable. Do not add a runtime package or cross-repository import.

Keep the journal modules structurally aligned where their behavior is identical:

- Schema version
- Redaction and normalization rules
- Input/output summary functions
- Token estimate labeling
- Rotation and malformed-line recovery
- Query filter semantics
- Browser record rendering vocabulary

Keep router-specific code separate:

- Authentication and log visibility
- Storage root
- Local-key and Harness fields
- Managed-transport handling
- Quota and provider-status integration
- Header names and UI copy

## Files and ownership

- `src/request-journal.js`: sanitized schema, retention, persistence, and scoped filtering
- `src/server.js`: local-key-aware lifecycle integration and both log APIs
- `bin/subchain.mjs`: private data-dir journal creation and CLI flags
- `src/webui/index.html`: Logs navigation and page shell
- `src/webui/app.js`: operator log loading and rendering
- `src/webui/app.css`: compact responsive presentation
- `test/request-journal.test.js`: shared behavior plus scoped filtering
- `test/server-routing.test.js`: per-key isolation and chat lifecycle
- `test/admin-api.test.js`: loopback operator access and non-loopback rejection
- `test/webui-state.test.js`: page placement, safe rendering, and UI state
- `README.md`, `SECURITY.md`, `DEPLOYMENT.md`, and `ISSUES.md`: retention, trust boundaries, operations, and acceptance evidence

## Testing and verification

Implementation uses red-green TDD.

1. Unit tests prove no secret or content field can enter a record, rotation stays within the private data directory, and scoped queries never cross local-key IDs.
2. Server tests use two local keys with different targets and prove each `/v1/logs` caller sees only its own records.
3. Admin tests prove loopback `/admin/logs` sees both scopes while a non-loopback peer receives no administrative surface.
4. Chat tests prove exact usage reuses `usageFromPayload()`, cumulative quota totals remain unchanged, managed transports record only normalized metadata, and failed authentication creates no provider attempt.
5. Browser tests prove Logs is between Chain and Harness, filters remain stable, dynamic values are escaped, and no credential or provider account identity reaches the DOM.
6. Run `npm test`, `npm run audit:public`, syntax checks, and `git diff --check`.
7. Start an isolated SubChain instance with private temporary storage. Exercise two scoped keys, a failure and cooldown, restart persistence, scoped API retrieval, loopback operator retrieval, and the real dashboard with a clean console.

## Non-goals

- Sharing a journal file between FreeChain and SubChain
- Allowing one SubChain local key to inspect another key's activity
- Storing provider or managed-client identity
- Replacing the existing quota tracker or provider status store
- Retaining prompt, output, tool, Harness, or preset content
- Adding remote log export, replay, deletion, or mutation APIs
