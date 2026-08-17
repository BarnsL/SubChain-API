# Kimi

## Decision

Kimi's supported SubChain path is a Kimi API key. Supply it as
`SUBCHAIN_KIMI_API_KEY` or `KIMI_API_KEY`. Provider app discovery is optional
and must be treated as a convenience, not a source to disclose in logs.

## Setup

1. Obtain an API key through Kimi's authorized account flow.
2. Set one environment variable in the service environment or an ignored local
   `.env` override.
3. Select Kimi and a model from the Chain page dropdowns.
4. Confirm the provider reports a generic credential state, then make a
   redacted local test request.

If a provider app rotates its key, update the authorized source and restart the
service when the environment was changed.
