# Control-Plane Log Access

The operator does not carry a journal of its own. It reads the existing
privacy-safe request journal described in [REQUEST-JOURNAL.md](REQUEST-JOURNAL.md),
through `GET /admin/operator/logs`, and nothing else.

## What a record contains

- identity: request id and timestamps;
- request: route, method, model, streaming flag, message/role counts, character
  counts and tool counts;
- client: coarse network category (`loopback`, `private`, `public`) and optional
  reported app, session id and SDK metadata;
- attempts: provider, model, key ordinal, outcome, provider HTTP status, latency
  and transport;
- served result: provider, model, key ordinal and transport, never the key;
- usage: exact provider usage where available, otherwise an explicit estimate;
- terminal status, outcome and error category;
- SubChain specifics: local-key id, target chain or provider, Harness id, quota
  data and cooldown candidates.

## What a record never contains

Prompts, completions, message bodies, tool bodies, image data, request or
response headers, provider keys, OAuth tokens and cookies are never written.
The journal accepts a fixed metadata schema rather than serializing requests,
so there is no operator setting that can turn raw retention on.

This matters for the control plane specifically: the model reasons from
metadata, so a compromised or simply wrong control model cannot exfiltrate
conversation content that was never recorded in the first place.

## Analysis

`analyzeSanitizedRecords` in [`src/operator-security.js`](../src/operator-security.js)
runs deterministically over this same schema. It classifies auth failures, rate
and quota pressure, upstream 5xx, timeouts, overall failure rate, provider
concentration and public-network clients without needing secrets or content.
Its findings are computed on the server and handed to the model as evidence,
not derived by the model itself.

## Clearing

The `clear_logs` action drops every retained record and removes the persisted
JSONL file and its rotated predecessor. It is destructive, confirmation-gated
like every other mutation, and there is no undo.
