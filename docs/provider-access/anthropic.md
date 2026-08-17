# Anthropic

## Access

Use an authorized Anthropic OAuth or developer credential. The explicit
override is `SUBCHAIN_ANTHROPIC_OAUTH_TOKEN`; supported conventional sources
include `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_TOKEN`. An approved provider
application, private credential source, or platform store may supply the same
credential without exposing its location.

Do not scrape a browser session or copy consumer cookies. The account card
reports only its generic source category.

## Ping

Press **Ping** to validate the account and refresh its model list and any
provider-reported quota headers. Provider limits and locally observed request
and token totals remain separate.

## Verify

1. Confirm the card reports a configured source category.
2. Press **Ping** and check the timestamp and model list.
3. Assign Anthropic or a chain containing it to a dedicated local key.
4. Confirm scoped `/v1/models`, then send one minimal completion.

The authentication header and Anthropic request conversion are owned together
by `src/providers.js` and `src/transforms.js`; test both when changing this lane.
