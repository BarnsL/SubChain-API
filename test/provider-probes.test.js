import test from 'node:test';
import assert from 'node:assert/strict';

const probesModule = await import('../src/provider-probes.js').catch(() => ({}));
const { createProviderProbeService, normalizeModels, quotaBucketsFromHeaders } = probesModule;

test('HTTP provider Ping refreshes models and reports unavailable quota honestly', async () => {
  assert.equal(typeof createProviderProbeService, 'function', 'provider probe service must exist');
  if (!createProviderProbeService) return;
  const writes = [];
  const service = createProviderProbeService({
    credentialResolver: () => ({ token: '<redacted>', type: 'api-key', source: 'environment' }),
    fetchImpl: async () => new Response(JSON.stringify({ data: [{ id: 'k3' }, { id: 'k3-256k' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
    statusStore: { recordPing: (id, value) => writes.push({ id, value }) },
    timeoutMs: 1_000,
  });

  const result = await service.ping('kimi');
  assert.deepEqual(result.models.map((model) => model.id), ['k3', 'k3-256k']);
  assert.deepEqual(result.quotas, [{ id: 'provider', label: 'Provider quota', status: 'unknown' }]);
  assert.equal(writes[0].id, 'kimi');
});

test('provider Ping rejects a duplicate in-flight request for the same account', async () => {
  let release;
  const fetchImpl = () => new Promise((resolve) => { release = resolve; });
  const service = createProviderProbeService({
    credentialResolver: () => ({ token: '<redacted>', type: 'api-key', source: 'environment' }),
    fetchImpl,
    statusStore: { recordPing() {} },
    timeoutMs: 5_000,
  });
  const first = service.ping('kimi');
  await assert.rejects(() => service.ping('kimi'), /already in progress/i);
  release(new Response(JSON.stringify({ data: [{ id: 'k3' }] }), { status: 200 }));
  await first;
});

test('Google model normalization excludes catalog entries that cannot generate text', () => {
  assert.equal(typeof normalizeModels, 'function', 'model normalization must exist');
  if (!normalizeModels) return;
  const models = normalizeModels('google', {
    models: [
      { name: 'models/gemini-example', displayName: 'Gemini Example', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-example', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
    ],
  });
  assert.deepEqual(models.map((model) => model.id), ['gemini-example']);
});

test('quota headers become an exact account bucket when limits are present', () => {
  assert.equal(typeof quotaBucketsFromHeaders, 'function', 'quota header parser must exist');
  if (!quotaBucketsFromHeaders) return;
  const headers = new Headers({
    'x-ratelimit-limit-requests': '100',
    'x-ratelimit-remaining-requests': '25',
    'x-ratelimit-reset-requests': '60',
  });
  const buckets = quotaBucketsFromHeaders(headers, 10_000);
  assert.equal(buckets[0].usedPercent, 75);
  assert.equal(buckets[0].limit, 100);
  assert.equal(buckets[0].remaining, 25);
  assert.equal(buckets[0].resetsAt, 70_000);
});
