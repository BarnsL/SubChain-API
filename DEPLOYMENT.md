# Deploying SubChain

## Supported deployment

SubChain is designed to run on the same machine as the applications using its
local API keys. Leave the host on loopback unless a separately reviewed network
access layer is in place. A non-loopback `--host` is rejected unless the launch
also includes the explicit `--allow-network` acknowledgement. The dashboard
remains loopback-only.

## Source run

```bash
npm test
npm start
```

The dashboard is available at the local URL printed by the launcher. Create
local keys there, copy a key only into the intended application, and select a
provider or chain for each key.

## Configuration

- `.env` is an ignored override file. Start from `.env.example`.
- `routing.config.json` is generated local metadata and contains no local key
  token, but it is still ignored because it can disclose private routing choices.
- Generated local keys and imported presets live in platform app data. Override
  the location with `SUBCHAIN_DATA_DIR` when a managed storage location is
  required.
- Existing `SUBCHAIN_ACCESS_KEY` migrates into the Default local key without
  changing that key's value.

## Release checklist

```bash
npm test
npm run audit:public
git diff --cached --check
```

Then inspect `git status --short` and the staged diff. A public release must not
include local routing files, provider credentials, generated preset content,
private logs, absolute user paths, or personal contributor identity data.

## Operations

- `/healthz` reports non-secret router health.
- `/v1/models` requires a valid local key and is scoped to that key's target.
- Admin routes and the dashboard are local-only.
- Rotate a compromised local key from the Access page. Other local keys remain
  valid.
- Re-run `npm run import-presets` when updating public prompt sources.
