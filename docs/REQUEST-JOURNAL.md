# Secure request journal

SubChain keeps a privacy-safe operational journal for API requests and meaningful
dashboard actions. The journal is designed for routing diagnosis and capacity
analysis. It is not a transcript store.

## Surfaces

- The dashboard **Logs** page sits between Chain and Harness. It shows aggregate
  counts, token usage, latency, cooling involvement, filters, pagination, and a
  per-request metadata view. The page reports whether persistence is active,
  keeps expanded records open across refreshes, and offers Pause live plus
  Clear filters controls for incident review.
- `GET /v1/logs` requires a local SubChain bearer key. It returns records owned
  by that key only. Ownership is applied before search, filters, summaries, and
  pagination.
- `GET /admin/logs` is available only through the existing loopback-only admin
  boundary. It can filter across local keys and decorates key IDs with their
  current safe display names.
- Successful and rejected API responses include `X-SubChain-Request-Id` so an
  app can correlate its own event with the journal.

Both APIs send `Cache-Control: no-store`. Reading either log endpoint is passive
and never creates another journal record.

## Data captured

Each record uses a fixed allowlist. Depending on how far a request progressed,
it may contain:

- request ID, timestamps, duration, route, method, status, and outcome;
- authentication result, local-key ID, selected target, Harness ID, and
  transport;
- request shape: requested model, streaming flag, message count, role counts,
  character count, tool count, and maximum token request;
- safe client metadata: loopback/private/public network category, opt-in app and
  session labels, plus recognized SDK name/version fields;
- ordered provider attempts, sanitized outcomes, elapsed time, provider status,
  selected provider/model/key index, and served transport;
- response shape: choice count, finish reasons, character and byte counts;
- input, output, and total token counts, marked `exact` when the upstream usage
  payload supplied them and `estimated` otherwise;
- a sanitized quota-window snapshot when one is available;
- cooling candidate IDs and remaining seconds;
- categorized errors with safe codes, HTTP/provider status, and retryability;
- metadata-only audit events for key reveal/rotation, routing changes, Harness
  changes, provider actions, and other meaningful dashboard mutations.

Invalid bearer keys are recorded before body parsing. These records say
`unavailable-before-auth`, have no local-key owner, and are therefore visible
only through the loopback admin view.

## Data never captured

The journal never stores prompts, assistant text, tool payloads, provider error
bodies, authorization headers, bearer tokens, provider credentials, full IP
addresses, or local-key display names. Display names are resolved at read time
for the admin dashboard. Unknown fields are discarded by the allowlist before
records enter memory or disk.

Do not put secrets, personal data, or prompt text in `X-SubChain-App` or
`X-SubChain-Session-Id`. These labels are optional, sanitized, and length
limited, but they are deliberately retained for correlation.

## Persistence and retention

By default, records are appended as JSON Lines under SubChain's private platform
app-data directory at `logs/requests.jsonl`. The current process keeps the most
recent 500 records in memory. The active file rotates at 5 MiB and keeps one
predecessor named `requests.jsonl.1`. On platforms that support POSIX modes,
directories and files are created with owner-only permissions.

A torn or malformed JSONL line is skipped during startup, so a partial final
write does not prevent later valid records from loading. If persistence fails,
SubChain continues serving requests and reports the local filesystem error to
its console.

Use `--log <path>` to select a private path. Use `--no-log` for memory-only
operation. Memory-only mode does not make the dashboard public or weaken key
scope.

## Query parameters

Both endpoints accept `limit` (maximum 200), `before`, `status`, `provider`,
`app`, `route`, `target`, `harness`, `transport`, and `q`. The admin endpoint
additionally accepts `localKey`. `before` accepts a returned request ID or an
ISO timestamp. `q` searches the sanitized record only.

Example for an application-owned view:

```bash
curl -H "Authorization: Bearer <local SubChain key>" \
  "http://127.0.0.1:4854/v1/logs?status=401&limit=25"
```

Applications can opt into correlation metadata:

```text
X-SubChain-App: nous-man
X-SubChain-Session-Id: 20260817_104721_e100f26c
```

Treat the journal as private operational data. On shared machines, protect the
operating-system account and do not expose either the API or dashboard beyond
loopback.
