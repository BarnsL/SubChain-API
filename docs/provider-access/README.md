# Provider access playbook

This folder is the concise, source-adjacent standard for adding or operating a
SubChain provider. It replaces machine-specific recipes with portable rules.

## Agent contract

1. Prefer the provider's documented API or authorized developer credential.
2. Never extract browser sessions, consumer-app cookies, or undocumented client
   tokens for a proxy.
3. Add an explicit `SUBCHAIN_*` override and the provider's conventional
   environment variable only when the provider supports that credential.
4. Keep the token outside the repository. Report only its source category, not
   its value or pathname.
5. Verify with a local request fixture before documenting the provider as
   working. Live provider calls require the owner's approval and must not print
   secrets.
6. State the provider's prompt-processing jurisdiction when it is known from an
   authoritative provider source. Do not infer it.

| Provider | SubChain override | Conventional variable | Route |
|---|---|---|---|
| Anthropic | `SUBCHAIN_ANTHROPIC_OAUTH_TOKEN` | `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_TOKEN` | [anthropic.md](anthropic.md) |
| OpenAI API | `SUBCHAIN_OPENAI_API_KEY` | `OPENAI_API_KEY` | [openai-codex.md](openai-codex.md) |
| Kimi | `SUBCHAIN_KIMI_API_KEY` | `KIMI_API_KEY` | [kimi.md](kimi.md) |
| Zhipu AI GLM | `SUBCHAIN_ZHIPU_API_KEY` | `ZHIPUAI_API_KEY` or `GLM_API_KEY` | [zhipu.md](zhipu.md) |
| Sakana AI | `SUBCHAIN_SAKANA_API_KEY` | `SAKANA_API_KEY` | [sakana.md](sakana.md) |

The resolver also handles Google through `SUBCHAIN_GOOGLE_API_KEY`,
`GOOGLE_API_KEY`, or `GEMINI_API_KEY`.
