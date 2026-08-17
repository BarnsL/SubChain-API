# Kimi

## Access

Use a Kimi API key through `SUBCHAIN_KIMI_API_KEY` or `KIMI_API_KEY`. SubChain
can also read the supported Kimi provider application's local key on the
platform where that application exposes it. The dashboard reports only
`provider application`, never the file location or value.

## Ping

Press **Ping** to validate the key, discover current models, and capture any
provider quota headers. If the provider application rotates its key, Ping will
report the sanitized failure until the authorized source is refreshed.

## Verify

1. Press **Ping** and confirm the current model list.
2. Assign Kimi or a chain containing it to a dedicated local key.
3. Confirm scoped `/v1/models`, then send one minimal completion.
4. Confirm observed usage increments without logging response content.
