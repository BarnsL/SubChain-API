# Google Gemini API and Antigravity

SubChain exposes a direct Gemini API lane and a managed Antigravity lane. Keep
them separate because their credentials, catalogs, and quota families differ.

## Gemini API lane

### Access

Use `SUBCHAIN_GOOGLE_API_KEY` as an explicit override or one supported provider
variable: `GOOGLE_API_KEY`, `GEMINI_API_KEY`, or `GEMINI_PAID_API_KEY`. An
approved private credential directory, environment file, or platform store may
also supply the same value without exposing a pathname in the UI.

### Verify

Press **Ping**, confirm the Gemini model list and any quota headers, assign the
account to a scoped local key, and send one minimal completion.

## Antigravity managed lane

### Access

Sign in with the installed Antigravity client. SubChain invokes that client in
its restricted planning mode and does not copy its OAuth tokens, browser state,
or account identity.

### Quota families

Antigravity can expose two independently limited model families:

- **Google models** for Gemini-family models.
- **Claude/GPT models** for third-party Anthropic and OpenAI models.

SubChain maps each discovered model to its family and records quota failures
against that family only. One exhausted family must not mark the other as
exhausted. If the client does not provide a percentage, SubChain shows unknown
or the sanitized reset information instead of inventing a limit.

### Verify

Press **Ping**, confirm both model families and available quota buckets, assign
the managed account to a local key or chain, then send one minimal completion.
Authentication and quota failures remain sanitized and never cause a token
fallback.
