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
- Keep text inside its card. Long model ids, provider names, request ids, base
  URLs and raw upstream error text must wrap or scroll within the card, never
  widen it, spill past its border, or give the page a horizontal scrollbar. This
  is a shared FreeChain-family rule; see the section below.

## Shared FreeChain-family UI rules

SubChain, FreeChain and VisionChain are sister projects sharing one dashboard
grammar. These rules are binding in all three; changing one repo without the
other two is a defect, not a local decision.

Card-text containment is enforced by a single canonical zero-specificity CSS
block at the end of `src/webui/app.css`, byte-identical across the three repos.
Read [docs/CARD-TEXT-CONTAINMENT.md](docs/CARD-TEXT-CONTAINMENT.md) before
touching it, add a new card's class to its container list rather than writing
per-card overflow rules, and verify at 1280 px and 380 px with a deliberately
hostile string using the console geometry check in that doc.

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
