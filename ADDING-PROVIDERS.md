# Adding providers to SubChain

Use this procedure for every provider addition. It keeps provider wiring,
credential discovery, chain controls, and release documentation consistent.

## 1. Confirm the supported integration

Use only the provider's documented API and authorized credential type. Record
the endpoint, request format, authentication method, and current official
documentation source. Do not build an integration around browser sessions,
consumer cookies, or an undocumented client backend.

## 2. Register the provider

Add a `BASE_PROVIDERS` entry in `src/providers.js`.

```js
'example-provider': {
  label: 'Example Provider',
  baseUrl: 'https://api.example.invalid/v1',
  authType: 'api-key',
  transform: null,
  contextWindow: 128_000,
  vendorEnv: ['EXAMPLE_API_KEY'],
  subscriptionUrl: 'https://example.invalid',
  jurisdiction: 'Verify with provider documentation',
}
```

Use a source-specific transform only when a request fixture proves the provider
is not OpenAI chat-completions compatible.

## 3. Add portable credential discovery

Update `src/auth.js` with an explicit `SUBCHAIN_*` override and documented
conventional environment variable. Any optional app-location or native-store
probe must be conditional on the actual platform and may report only a generic
source category.

Do not add absolute local paths to source, docs, or UI copy.

## 4. Keep routing boundaries intact

Providers are selected from Chain and Access dropdowns. A direct provider target
must expose only that provider's links through `/v1/models`. Do not bypass
`scopeForLocalKey` or authenticate a request with a global provider key.

## 5. Document and test

Create `docs/provider-access/<provider>.md` using the local playbook. Add:

1. a credential precedence test;
2. a request transform test if needed;
3. scoped model-list coverage when the provider is targetable;
4. a redacted dashboard check.

Run `npm test`, `npm run audit:public`, and `git diff --check` before release.
