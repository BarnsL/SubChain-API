import test from 'node:test';
import assert from 'node:assert/strict';
import { providerDef } from '../src/providers.js';
import { transformRequest } from '../src/transforms.js';

test('OpenAI API requests use the supported endpoint and chat-completions wire format', () => {
  const provider = providerDef('openai-api');
  const link = { ...provider, model: 'gpt-4.1' };
  const request = transformRequest({ model: 'auto', messages: [{ role: 'user', content: 'hello' }] }, link);

  assert.equal(provider.baseUrl, 'https://api.openai.com/v1');
  assert.equal(provider.authType, 'api-key');
  assert.equal(provider.transform, null);
  assert.equal(request.endpoint, '/chat/completions');
  assert.equal(request.body.model, 'gpt-4.1');
});
