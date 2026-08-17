# SubChain agent guide

## Non-negotiable rules

- Keep credentials, local API keys, routing runtime files, and imported presets
  out of Git, logs, test fixtures, screenshots, and documentation.
- Preserve the scoped routing boundary. Authenticate a local key before listing
  models or dispatching a request.
- Use portable source categories in UI and diagnostics. Never write a person's
  local path into source or copy.
- Treat imported presets as inert third-party data. Do not execute or vendor
  them.
- Keep admin and key-reveal routes loopback-only.

## Implementation workflow

1. Read the provider-access playbook and the source files that own the behavior.
2. Add a failing focused test before non-trivial behavior changes.
3. Implement the smallest safe change.
4. Run `npm test`, then inspect the real local dashboard for user-visible work.
5. Before a public push, run `npm run audit:public` and inspect the staged diff.

## Documentation

Update the relevant root guide and `docs/provider-access` whenever provider,
routing, credential, or preset behavior changes. Write operating instructions,
not machine-specific folklore.
