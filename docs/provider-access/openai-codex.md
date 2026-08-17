# OpenAI Codex and OpenAI API

SubChain exposes two separate OpenAI account lanes. Do not merge them because
they have different authentication owners, model catalogs, billing, and quota
semantics.

## Managed Codex lane

### Connect

If the OpenAI Codex card reports a missing account, choose **Connect ChatGPT
subscription**. SubChain starts the documented Codex app-server
`chatgptDeviceCode` flow. Open the displayed official verification URL and enter
the displayed one-time code only on that page. Do not paste the code elsewhere.

Codex owns OAuth storage and refresh. SubChain never reads, copies, persists,
returns, or logs ChatGPT tokens or account identity. It does not use
undocumented consumer endpoints. A pending connection can be cancelled. An
expired, failed, or cancelled connection needs a new start. If Ping reports a
refresh error after connection, retry Ping instead of reconnecting.

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

1. Choose **Connect ChatGPT subscription** if the card reports no account.
2. Complete the official verification flow and wait for the normal Ping refresh.
3. Confirm plan, models, rate-limit buckets, and a current Ping timestamp.
4. Assign a dedicated local key to OpenAI Codex or a chain containing it.
5. Use that local key with `model: auto` or a discovered model from its scoped
   `/v1/models` result, then send one minimal completion.

SubChain authenticates the local key before model listing or request dispatch.
An application never receives the ChatGPT subscription identity or credential.

The protocol is documented in the
[Codex app-server reference](https://developers.openai.com/codex/app-server).

## Direct OpenAI API lane

### Access

Use `SUBCHAIN_OPENAI_API_KEY` as an explicit override or `OPENAI_API_KEY` in the
service environment. This lane calls the supported OpenAI API and consumes API
Platform billing and rate limits. It does not consume a ChatGPT subscription.
Do not copy a ChatGPT token into this lane, and do not expect a ChatGPT
subscription to authorize API Platform requests.

### Ping and verify

1. Press **Ping** on the OpenAI API card to refresh the API-visible model list.
2. Assign it to a dedicated local key or a chain.
3. Confirm scoped `/v1/models`, then send one minimal completion.
4. Treat provider-reported quota headers and locally observed usage as separate
   measurements.
