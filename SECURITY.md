# Security policy

## Supported boundary

SubChain is a local service. Keep its host on loopback. The dashboard and every
administrative route are loopback-only because they can reveal or rotate a local
API key.

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
