# Dario Integration for SubChain

Source inspiration: [`askalf/dario`](https://github.com/askalf/dario), MIT licensed.
Attribution is retained here and in the design documentation.

## What SubChain adopts

- **Dario as a local provider lane** at `http://127.0.0.1:3456/v1`;
- the conventional local Dario token `dario`, overridable with
  `DARIO_API_KEY` / `SUBCHAIN_DARIO_API_KEY`;
- Dario `/v1/models` discovery through SubChain's existing Provider Ping;
- the architectural ideas of a provider-adapter seam, redaction, Doctor-style
  diagnostics, live model catalog awareness, queue and overage awareness, and
  explicit health distinctions.

## What SubChain deliberately does not copy

Dario's Claude Code wire-template capture, OAuth token lifecycle, account pool
and session machinery, pacing and stealth behaviour, and overage guard stay
inside Dario. Those are high-drift subscription-client details. SubChain treats
a running Dario instance as an OpenAI-compatible local upstream and never
scrapes or copies its OAuth or session material.

This keeps responsibilities clear:

```text
client -> SubChain local key/routing/quota policy -> Dario local provider -> Claude subscription
```

Use Dario's own `doctor`, `/health`, queue and overage controls when diagnosing
that lane. SubChain's Doctor can report that the lane is configured or erroring
and Provider Ping can test its model surface, but neither should pretend to own
Dario's internal session pool.

## Backend coverage audit

Dario routes through exactly two internal adapters, `claude` and `openai`
(see its `src/provider-adapter.ts`). Everything else is that OpenAI-compatible
adapter pointed at a different base URL, which is why its documented
provider prefixes are `claude:`, `openai:`, `groq:` and `local:`, and why
`dario backend add <name> --key=<key> [--base-url=<url>]` is a single generic
command rather than one per vendor.

Every Dario backend therefore maps onto a SubChain lane that already exists:

| Dario backend | Dario prefix | SubChain provider | Notes |
| --- | --- | --- | --- |
| Claude / Anthropic | `claude:` | `anthropic`, or `dario` itself | Direct API, or through Dario to use a Pro/Max subscription |
| OpenAI | `openai:` | `openai-api`, `openai-codex` | Direct API key, or the managed Codex subscription |
| Groq | `groq:` | `groq` | `https://api.groq.com/openai/v1` |
| OpenRouter | *(openai-compat backend)* | `openrouter` | `https://openrouter.ai/api/v1` |
| Ollama and other local servers | `local:` | `local` | `http://127.0.0.1:11434/v1`, key optional |

**Result: no Dario backend is missing from SubChain.** The audit was run against
the repository's `master` branch, its `docs/commands.md` provider-prefix table
and `docs/usage.md`; no vendor beyond the five above is named in either.

The one clarification worth making is the `local` lane. Dario's `local:` prefix
means "an OpenAI-compatible server on this machine", which in practice is Ollama
— hence the `11434` default port SubChain already carries. llama.cpp, LM Studio
and vLLM expose the same shape, so the lane is labelled for Ollama and similar
rather than being duplicated per runtime.

## Additional providers added alongside Dario

- OpenRouter (`OPENROUTER_API_KEY`)
- Groq (`GROQ_API_KEY`)
- generic local OpenAI-compatible server (default `127.0.0.1:11434/v1`, key optional)

These are ordinary SubChain HTTP lanes and participate in the same chain, quota,
cooldown and local-key scoping machinery as every other provider.

## Provider coverage verification (2026-08-18)

Dario's provider surface is fully covered; nothing is missing. Verified against
`askalf/dario` at `master` rather than from its README prose:

`src/provider-adapter.ts` declares the complete set as

```ts
export type ProviderId = 'claude' | 'openai';
```

Everything else Dario documents — Groq, OpenRouter, a local Ollama-compatible
server — is not a distinct provider. Each is an OpenAI-compatible **base URL**
registered through `dario backend add <name> --base-url=...`, routed by the
`openai` adapter. So Dario's real surface is: Anthropic Claude, plus arbitrary
OpenAI-compatible endpoints.

SubChain covers both, and more, in `src/providers.js`:

| Dario capability | SubChain lane |
| --- | --- |
| `claude` | `anthropic` |
| `openai` | `openai` |
| `backend add groq` | `groq` |
| `backend add openrouter` | `openrouter` |
| `backend add local` | `local` (Ollama and similar) |
| arbitrary `--base-url` | any lane, via the per-entry `baseUrl` override in `src/config.js` |

SubChain additionally carries `codex`, `kimi`, `gemini`, `antigravity`, `glm`,
`sakana`, and the `dario` lane itself. The per-entry `baseUrl` override is what
makes the arbitrary-backend case work without a new provider definition, so a
new OpenAI-compatible upstream is a config entry rather than a code change.
