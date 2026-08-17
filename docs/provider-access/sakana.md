# Sakana AI

## Access

Use `SUBCHAIN_SAKANA_API_KEY` or `SAKANA_API_KEY` from the service environment,
an ignored override, or another approved private source. Never put the value in
routing metadata, logs, screenshots, or documentation.

## Ping

Press **Ping** to validate the account, discover current models, and capture any
provider quota headers. Missing quota data means unknown.

## Verify

1. Press **Ping** and inspect only the sanitized account result.
2. Assign Sakana or a chain containing it to a dedicated local key.
3. Confirm scoped `/v1/models`, then send one minimal completion.
4. Recheck current official model availability and terms before relying on a
   fallback model entry.
