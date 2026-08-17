# Security policy

## Supported boundary

SubChain is a local service. Keep its host on loopback. The dashboard and every
administrative route are loopback-only because they can reveal or rotate a local
API key.

State-changing admin requests also reject cross-site Fetch Metadata, and POST
requests require `application/json`. This blocks blind form submissions from an
unrelated browser origin while keeping approved local scripts usable.

Do not place the dashboard behind an unauthenticated reverse proxy. Do not bind
the service to a network interface unless you add a separate, reviewed access
control layer.

## Secret handling

- Never commit `.env`, runtime configs, generated preset data, credentials, or
  local API keys.
- Provider credentials remain in their provider-specific stores or the process
  environment. `.env` is an explicit override only.
- Generated local API keys are stored in platform app data with restricted file
  permissions on platforms that support them.
- Routing metadata contains `secretRef` values only. A token must never appear
  in `routing.config.json`, tests, documentation, logs, screenshots, or issues.
- Rotate a key if it is copied into an unsafe place. Rotation affects only that
  key and does not invalidate other local keys.

## Managed subscription transports

Managed transports delegate authentication to an installed provider client.
SubChain reads only the minimum account health, model, quota, and usage fields
needed for routing and removes account identity, tokens, session identifiers,
and unrecognized fields before persistence or dashboard output.

The Codex lane uses the documented `codex app-server` standard-input protocol.
Codex owns ChatGPT OAuth storage and refresh. SubChain does not read or copy its
token files. Each completion uses a transient Codex thread in a private empty
working directory, an allowed read-only permission profile, and no approval for
additional access. The transient thread is deleted after the response.

OpenAI Codex enrollment is exposed by the loopback admin API used by the
Providers card. Its status route is loopback-only, and its start and cancel
requests require JSON and reject cross-site Fetch Metadata before any login
operation runs. The only enrollment fields returned are a sanitized state, an
official HTTPS verification URL, a one-time code, and expiry when supplied.
Never copy the code into an issue, log, or third-party page.

The Codex app-server `account/read` response enters the process. SubChain
allowlists only the account type, authentication status, plan, and required
rate-limit data for routing and provider status. It does not access identity
fields for use, retain, persist, log, or return them. SubChain never copies
ChatGPT tokens, and does not use undocumented consumer endpoints.

The direct OpenAI API lane is separate. It uses an API key and API Platform
billing, while the Codex lane uses a ChatGPT subscription managed by Codex.
Neither credential type authorizes the other lane.

The Antigravity lane invokes the installed client in its restricted planning
mode. Provider authentication and refresh remain inside that client. A failed
authentication or exhausted quota is returned as a sanitized provider error.

## Imported data

Imported presets are untrusted inert text. The importer accepts only declared
text or JSON paths, skips symlinks and executable source, records provenance and
checksums, and stores the content outside the repository. Selecting a preset
never executes it.

## Public-release gate

Before any public push, run:

```bash
npm test
npm run audit:public
git diff --cached --check
```

Review every staged file. Do not stage ignored runtime configuration merely
because it contains no obvious token: it can still disclose private model,
provider, or machine information.

## Reporting

Use a private maintainer channel for a suspected secret exposure. Do not open a
public issue containing tokens, session files, raw request headers, or absolute
home-directory paths.
