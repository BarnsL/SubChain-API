# Zhipu AI GLM

## Access

Use `SUBCHAIN_ZHIPU_API_KEY`, `ZHIPUAI_API_KEY`, or `GLM_API_KEY`. Keep the key
in the service environment, an ignored override, or another approved private
source. Do not put it in routing metadata or documentation.

## Ping

Press **Ping** to validate the account, refresh current models, and capture any
provider quota headers. Missing quota data means unknown.

## Verify

1. Press **Ping** and inspect only the sanitized account result.
2. Assign Zhipu or a chain containing it to a dedicated local key.
3. Confirm scoped `/v1/models`, then send one minimal completion.
4. Recheck current official model availability before relying on fallback
   catalog entries.
