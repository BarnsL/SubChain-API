# Provider access playbook

These guides are the source-adjacent operating standard for SubChain provider
access. They contain portable procedures, not machine-specific credential
folklore.

## Agent contract

1. Prefer a documented API or documented managed-client protocol.
2. Let a managed client own its sign-in, tokens, refresh, and logout. Do not
   copy OAuth tokens when a supported local integration exists.
3. Keep credentials outside the repository. Report only a generic source
   category, never a value, account identity, or absolute pathname.
4. Probe models, health, and quotas with a bounded read-only operation. Store
   only normalized allowlisted fields.
5. Treat an unavailable quota as unknown, not unlimited.
6. Verify provider routing through a scoped local key before declaring the lane
   working. A live provider request must not print secrets or response content.

## Portable source configuration

Direct API credentials can come from an explicit `SUBCHAIN_*` override, a
conventional provider environment variable, an approved private credential
directory, an approved private environment file, a supported provider
application, or a platform-native store. `.env` is an ignored override layer.
The UI reports only `override`, `environment`, `credential file`, `credential
directory`, `provider application`, `platform store`, or `managed client`.

Numbered direct-credential accounts are independent. Each additional account
requires its own numbered `SUBCHAIN_<PROVIDER><N>_API_KEY` or provider-specific
OAuth override. The resolver never duplicates one family credential into ten
accounts.

| Provider lane | Access source | Guide |
|---|---|---|
| Anthropic | authorized OAuth or direct environment source | [anthropic.md](anthropic.md) |
| OpenAI Codex | Codex-owned managed ChatGPT sign-in | [openai-codex.md](openai-codex.md) |
| OpenAI API | `SUBCHAIN_OPENAI_API_KEY` or `OPENAI_API_KEY` | [openai-codex.md](openai-codex.md) |
| Kimi | `SUBCHAIN_KIMI_API_KEY`, `KIMI_API_KEY`, or supported provider app | [kimi.md](kimi.md) |
| Google Gemini API | `SUBCHAIN_GOOGLE_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_KEY`, or `GEMINI_PAID_API_KEY` | [google.md](google.md) |
| Google Antigravity | installed client-managed sign-in | [google.md](google.md) |
| Zhipu AI GLM | `SUBCHAIN_ZHIPU_API_KEY`, `ZHIPUAI_API_KEY`, or `GLM_API_KEY` | [zhipu.md](zhipu.md) |
| Sakana AI | `SUBCHAIN_SAKANA_API_KEY` or `SAKANA_API_KEY` | [sakana.md](sakana.md) |

## Standard verification

1. Start SubChain on loopback.
2. Open Providers and press **Ping** for the account.
3. Confirm sanitized health, model list, quota windows when available, and Ping
   timestamp.
4. Assign the account or a chain to a dedicated local key.
5. Confirm `/v1/models` returns only that key's allowed models. A direct
   provider key lists its last successful Ping catalog, independently of chain
   membership. If no successful catalog exists yet, it uses the provider's
   safe fallback catalog.
6. Send one minimal completion and confirm observed usage increments.
