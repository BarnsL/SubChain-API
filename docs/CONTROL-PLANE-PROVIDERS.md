# Provider Setup Behavior

The operator distinguishes provider access modes before doing anything:

## Managed subscription/OAuth

Use the provider-owned managed login flow. The operator can propose starting the already-supported OpenAI Codex managed sign-in in SubChain, then return the verification URL/code to the human. It never reads the resulting token into model context.

## Direct API key

The Providers tab shows an official setup URL and a password input. Pasting there posts directly to the loopback server; it does not go through chat. Alternatively, if a supported credential source is already detected, the chat can propose a confirmation-gated import that rereads it server-side.

## Local service

Local providers are treated as services, not credential stores. The operator should verify the process/model endpoint and only use an API key when the local service actually requires one.

## Lanes added by this change

- OpenRouter: `openrouter.ai/settings/keys`
- Groq: `console.groq.com/keys`
- DeepSeek: `platform.deepseek.com/api_keys`
- Dario: its GitHub project and local service, see [DARIO-INTEGRATION.md](DARIO-INTEGRATION.md)
- generic local OpenAI-compatible server: no setup URL, key optional, defaults to
  Ollama's `127.0.0.1:11434/v1`

These five lanes (with the existing Anthropic and OpenAI ones) cover every backend
Dario can route to; see the coverage audit in
[DARIO-INTEGRATION.md](DARIO-INTEGRATION.md#backend-coverage-audit).

Existing lanes (Anthropic, OpenAI API, OpenAI Codex, Kimi, Google, Google
Antigravity, Zhipu, Sakana) keep the setup destinations already defined in
[`src/providers.js`](../src/providers.js).

Provider URLs are server-allowlisted. The model cannot invent an arbitrary credential-harvesting link and have the UI render it as a setup action.
