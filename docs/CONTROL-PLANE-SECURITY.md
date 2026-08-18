# Security Model

## Trust boundaries

**Trusted local server code** is the authority. The chat model is advisory and may be wrong or malicious. The browser UI is a human interaction surface. Provider APIs and external control models are untrusted external systems.

The server therefore enforces:
- operator routes on loopback only;
- same-origin checks for browser mutations;
- JSON-only mutation bodies;
- strict tool allowlists;
- one-time pending action ids with expiration;
- validation again at confirmation time;
- secret-free model context;
- official provider-link allowlisting;
- repair file/size/content allowlists;
- rollback after failed validation.

## Credential discovery

Discovery may inspect only approved locations: environment variables, the app's ignored `.env`, an explicitly configured private credential directory, supported provider-owned application state, and platform-native stores already supported by the host app. UI/model output contains generic source categories, never credential values or absolute paths.

SubChain retains its existing provider-specific discovery layer and managed-client ownership model. Managed subscription providers stay owned by their provider client; the operator can start the supported Codex sign-in but never ingests the resulting token.

## Logs

Logs are operational records, not conversation archives. SubChain's journal
accepts a fixed metadata schema, so it retains only:
- request/model/route metadata and message/role counts;
- coarse client network category and optional reported app/SDK metadata;
- the provider attempt trail;
- HTTP and error classification;
- timing, usage and quota metadata;
- local-key id, target chain/provider and Harness id.

It does not retain prompts, completions, request/response bodies, tool bodies,
image data, provider keys, OAuth tokens, authorization headers or cookies.
Unlike the other apps in this family, SubChain retains no prompt summaries at
all, so there is no operator setting that could widen retention.

See [CONTROL-PLANE-LOGS.md](CONTROL-PLANE-LOGS.md) and
[REQUEST-JOURNAL.md](REQUEST-JOURNAL.md).

## External control models

An external OpenAI-compatible control model receives the same sanitized context the built-in/self route receives. Remote non-loopback control-model URLs must use HTTPS. Its API key is stored locally and is never included in prompts or logs.
