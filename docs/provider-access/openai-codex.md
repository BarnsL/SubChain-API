# OpenAI API and Codex

## Decision

Use `OPENAI_API_KEY` or `SUBCHAIN_OPENAI_API_KEY` for SubChain's OpenAI route.
The route targets the supported OpenAI API endpoint and uses OpenAI-compatible
chat completions.

Do not use a ChatGPT browser session, a Codex desktop login file, or an
undocumented consumer backend as a generic proxy credential. ChatGPT/Codex
sign-in belongs to the official Codex clients. ChatGPT subscriptions and API
Platform billing are separate products.

## Setup

1. Create or select an API Platform project with the required billing and
   permissions.
2. Supply `SUBCHAIN_OPENAI_API_KEY` as an explicit override, or supply
   `OPENAI_API_KEY` in the process environment.
3. Add an `openai-codex` link to a chain and select it from the chain dropdown.
4. Run the local model-scope test. Do not print the key.

## References

- OpenAI Help: [Codex access with eligible ChatGPT plans](https://help.openai.com/en/articles/11369540)
- OpenAI Help: [ChatGPT and API Platform billing are separate](https://help.openai.com/en/articles/9039756)
- OpenAI Help: [API billing is usage based](https://help.openai.com/en/articles/8156019-how-can-i-set-up-prepaid-billing)
