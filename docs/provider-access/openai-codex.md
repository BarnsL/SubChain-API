# OpenAI Codex and OpenAI API

SubChain exposes two separate OpenAI account lanes. Do not merge them because
they have different authentication owners, model catalogs, billing, and quota
semantics.

## Managed Codex lane

### Access

Sign in through Codex using the ChatGPT account intended for Codex. SubChain
starts the documented local `codex app-server` standard-input transport. Codex
owns and refreshes its OAuth credentials; SubChain never reads or copies them.
No undocumented consumer endpoint is used.

SubChain discovers the installed Codex command through a generic application
location, the executable search path, or an explicit private runtime override.
No personal installation path is embedded in source or documentation.

### Ping

The provider card's **Ping** action calls the documented account, model,
rate-limit, and usage methods. It keeps the plan label, picker-visible models,
quota windows, and aggregate usage fields. It discards account identity and
token fields.

### Completion boundary

Each routed completion creates a transient thread in a private empty workspace,
selects an allowed read-only permission profile, disables additional approval,
collects only the final model response and usage, then deletes the thread. If
the installed Codex version or account policy cannot provide that restricted
profile, the request fails closed.

### Verify

1. Confirm the Codex client is signed in.
2. Press **Ping** on the OpenAI Codex card.
3. Confirm plan, models, rate-limit buckets, and a current Ping timestamp.
4. Assign a dedicated local key to OpenAI Codex or a chain containing it.
5. Send one minimal completion with `model: auto` or a discovered Codex model.

The protocol is documented in the
[Codex app-server reference](https://developers.openai.com/codex/app-server).

## Direct OpenAI API lane

### Access

Use `SUBCHAIN_OPENAI_API_KEY` as an explicit override or `OPENAI_API_KEY` in the
service environment. This lane calls the supported OpenAI API and consumes API
Platform billing and rate limits. It does not consume a ChatGPT subscription.

### Ping and verify

1. Press **Ping** on the OpenAI API card to refresh the API-visible model list.
2. Assign it to a dedicated local key or a chain.
3. Confirm scoped `/v1/models`, then send one minimal completion.
4. Treat provider-reported quota headers and locally observed usage as separate
   measurements.
