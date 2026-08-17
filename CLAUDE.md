# SubChain instructions for Claude-compatible agents

Follow [AGENTS.md](AGENTS.md). The implementation contract is shared by every
agent working in this repository.

For credential, routing, or preset work, read:

1. [SECURITY.md](SECURITY.md)
2. [docs/provider-access/README.md](docs/provider-access/README.md)
3. [docs/PRESETS.md](docs/PRESETS.md), when presets are involved

Do not use client-session tokens as a generic provider API. Do not commit local
runtime configuration or imported prompt bodies. Verify visible dashboard
behavior before claiming UI work complete.
