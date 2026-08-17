# OpenAI Subscription Enrollment Design

## Goal

Let a SubChain user connect and route a ChatGPT-backed OpenAI Codex
subscription without copying OAuth tokens, calling undocumented consumer
endpoints, or confusing that entitlement with an OpenAI API key.

## Decision

SubChain will add a first-class **Connect ChatGPT subscription** action to the
OpenAI Codex provider card. It will use the documented Codex app-server
`account/login/start` method with `type: "chatgptDeviceCode"`. Codex owns the
OAuth flow, persistence, and refresh. SubChain receives only the temporary
verification URL, one-time user code, completion status, plan, model catalog,
rate-limit buckets, and usage summary required by its local control plane.

The existing OpenAI API provider remains a separate lane. A ChatGPT
subscription does not become an OpenAI API key, and SubChain will never copy a
Codex token into the API provider.

## Considered approaches

1. **Managed device-code login, selected.** Cross-platform, documented, and
   robust when a localhost browser callback is unavailable. The user explicitly
   authorizes the account and Codex retains the credentials.
2. **Managed browser callback.** Also documented, but the temporary app-server
   process must own a callback listener and browser handoff. It is more brittle
   across browsers and firewalls without improving the security boundary.
3. **Externally managed ChatGPT tokens.** Rejected. The documented mode is
   experimental, requires the host to own token refresh, and would expand
   SubChain's secret-handling responsibilities.

## Architecture

### Managed login lifecycle

`src/managed-transports.js` owns one in-memory Codex login session. Starting a
login performs these steps:

1. Spawn and initialize the official Codex app-server over local JSONL stdio.
2. Read the active account. If it is already ChatGPT-managed, return `ready`
   without changing authentication.
3. Start `chatgptDeviceCode` login and return an allowlisted pending snapshot:
   status, HTTPS verification URL, one-time user code, and expiry time.
4. Listen for the matching `account/login/completed` notification.
5. Close the app-server process on success, sanitized failure, cancellation, or
   expiry. Never persist the device code or login identifier.

Duplicate start requests reuse the active pending session. The public status
method returns only the allowlisted snapshot. A completed session remains
visible briefly so the dashboard can observe it and trigger a normal provider
Ping.

### Admin boundary

`src/server.js` exposes loopback-only endpoints for the OpenAI Codex lane:

- `POST /admin/providers/openai-codex/connect` starts or resumes enrollment.
- `GET /admin/providers/openai-codex/connect` reads the sanitized in-memory
  status.
- `POST /admin/providers/openai-codex/connect/cancel` cancels a pending login.

Existing JSON content-type and Fetch Metadata protections cover the POST
routes. No provider token, account identifier, or account email crosses these
endpoints.

### Dashboard behavior

When the managed Codex account is missing, the provider card shows **Connect
ChatGPT subscription**. Starting enrollment displays the one-time code and a
link to the official verification page. The UI polls only the loopback status
route. On completion it runs the existing Ping, refreshes models, plan, quota,
usage, and status, then hides the enrollment panel.

When a ChatGPT-managed account is already connected, the card reports it as
authorized through the provider application. It does not offer logout or account
switching because those operations would affect the user's global Codex session.

## Routing contract

The subscription remains provider id `openai-codex` and transport
`codex-app-server`. A local key can target it directly or reach it through a
chain. Client applications continue to use the stable OpenAI-compatible
contract:

```text
base URL: http://127.0.0.1:4854/v1
API key: one scoped SubChain local key
model: auto or one model returned for that key
```

SubChain authenticates the local key before model listing or completion
dispatch. The provider account never appears in client configuration.

## Error handling

- Missing or unsupported Codex runtime returns a sanitized local error.
- A non-ChatGPT Codex auth mode is reported as requiring subscription login.
- Malformed device instructions fail closed and close the child process.
- Expired or cancelled enrollment closes the process and clears the one-time
  code.
- Provider errors never include app-server stderr, token material, account
  identifiers, or identity fields in the dashboard response.

## Verification

Automated tests cover ready accounts, device-code start, duplicate starts,
completion, cancellation, expiry cleanup, allowlisted status, non-ChatGPT auth,
admin route restrictions, and provider inventory credential state. Live release
verification covers an already authenticated subscription, provider Ping, model
and quota refresh, one direct scoped local-key completion, dashboard response,
public sanitization, and the single-contributor Git history.
