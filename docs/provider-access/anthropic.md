# Anthropic

## Decision

SubChain accepts an explicitly authorized Anthropic OAuth token through
`SUBCHAIN_ANTHROPIC_OAUTH_TOKEN`, or a conventional authorized environment
value. Do not scrape a browser session or copy consumer cookies.

## Setup

1. Obtain the credential through the provider's supported sign-in or developer
   flow and confirm that the intended use is authorized by the provider.
2. Set the explicit SubChain override or the documented conventional variable.
3. Choose Anthropic from the chain dropdown and use a supported model identifier.
4. Verify only with redacted diagnostics. A missing credential must show as a
   generic source state, never an absolute path.

The Anthropic request transform and authentication type are defined together in
`src/providers.js` and `src/transforms.js`. Change and test both as one unit.
