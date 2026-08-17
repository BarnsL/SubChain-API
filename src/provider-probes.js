// Bounded provider health, model, usage, and quota refresh operations.

import { resolveCredential } from './auth.js';
import { providerDef } from './providers.js';

const UNKNOWN_QUOTA = () => ({ id: 'provider', label: 'Provider quota', status: 'unknown' });

function familyOf(providerId) {
  return providerDef(providerId).family;
}

export function normalizeModels(providerId, payload) {
  const family = familyOf(providerId);
  const source = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
  return source
    .filter((model) => {
      if (family !== 'google' || !Array.isArray(model?.supportedGenerationMethods)) return true;
      return model.supportedGenerationMethods.includes('generateContent');
    })
    .map((model) => {
      const rawId = String(model?.id || model?.name || '').replace(/^models\//, '').trim();
      if (!rawId) return null;
      const quotaFamily = family === 'google-antigravity'
        ? (/^(?:claude-|gpt-)/.test(rawId) ? 'third-party-models' : 'google-models')
        : null;
      return {
        id: rawId,
        label: String(model?.displayName || model?.label || rawId),
        inputModalities: Array.isArray(model?.inputModalities) ? model.inputModalities : [],
        capabilities: Array.isArray(model?.supportedGenerationMethods)
          ? { generationMethods: model.supportedGenerationMethods.join(',') }
          : {},
        quotaFamily,
      };
    })
    .filter(Boolean);
}

function parseReset(value, now) {
  if (!value) return null;
  if (/^\d+(?:\.\d+)?$/.test(String(value).trim())) return now + Number(value) * 1_000;
  const timestamp = Date.parse(value);
  if (Number.isFinite(timestamp)) return timestamp;
  return null;
}

export function quotaBucketsFromHeaders(headers, now = Date.now()) {
  const limitRaw = headers.get('x-ratelimit-limit-requests') || headers.get('x-ratelimit-limit-tokens');
  const remainingRaw = headers.get('x-ratelimit-remaining-requests') || headers.get('x-ratelimit-remaining-tokens');
  const limit = Number(limitRaw);
  const remaining = Number(remainingRaw);
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(remaining)) return [UNKNOWN_QUOTA()];
  return [{
    id: 'provider',
    label: 'Provider quota',
    status: remaining > 0 ? 'available' : 'exhausted',
    usedPercent: Math.max(0, Math.min(100, Math.round(((limit - remaining) / limit) * 100))),
    limit,
    remaining,
    resetsAt: parseReset(
      headers.get('x-ratelimit-reset-requests') || headers.get('x-ratelimit-reset-tokens') || headers.get('x-ratelimit-reset'),
      now,
    ),
  }];
}

function authorizationHeaders(credential, def) {
  if (def.family === 'anthropic') {
    return { Authorization: `Bearer ${credential.token}`, 'anthropic-version': '2023-06-01' };
  }
  return { Authorization: `Bearer ${credential.token}` };
}

async function pingHttp(providerId, dependencies) {
  const def = providerDef(providerId);
  const credential = dependencies.credentialResolver(providerId);
  if (!credential) throw Object.assign(new Error('No authorized credential source is available'), { statusCode: 409 });
  const timeout = AbortSignal.timeout(dependencies.timeoutMs);
  const response = await dependencies.fetchImpl(`${def.baseUrl.replace(/\/+$/, '')}/models`, {
    method: 'GET',
    signal: timeout,
    headers: { Accept: 'application/json', ...authorizationHeaders(credential, def) },
  });
  if (!response.ok) throw Object.assign(new Error(`Provider ping failed with HTTP ${response.status}`), { statusCode: 502 });
  const payload = await response.json();
  const models = normalizeModels(providerId, payload);
  return {
    health: 'ready',
    message: `${models.length} models available`,
    models: models.length ? models : def.fallbackModels.map((id) => ({ id, label: id })),
    quotas: quotaBucketsFromHeaders(response.headers),
  };
}

export function createProviderProbeService({
  statusStore,
  credentialResolver = resolveCredential,
  fetchImpl = fetch,
  managedProbes = {},
  timeoutMs = 15_000,
} = {}) {
  if (!statusStore || typeof statusStore.recordPing !== 'function') throw new Error('Provider probe service needs a status store');
  const inFlight = new Set();
  const dependencies = { statusStore, credentialResolver, fetchImpl, managedProbes, timeoutMs };

  return {
    isPinging(providerId) { return inFlight.has(providerId); },
    async ping(providerId) {
      const def = providerDef(providerId);
      if (inFlight.has(providerId)) throw Object.assign(new Error('Provider ping is already in progress'), { statusCode: 409 });
      inFlight.add(providerId);
      try {
        const probe = def.transport === 'http' ? pingHttp : managedProbes[def.transport];
        if (typeof probe !== 'function') throw Object.assign(new Error('Managed provider client is unavailable'), { statusCode: 409 });
        const result = await probe(providerId, dependencies);
        statusStore.recordPing(providerId, result);
        return result;
      } catch (error) {
        const message = error?.statusCode === 409 ? error.message : 'Provider ping failed';
        statusStore.recordPing(providerId, { health: error?.statusCode === 409 ? 'missing' : 'error', error: message });
        throw Object.assign(new Error(message), { statusCode: error?.statusCode || 502 });
      } finally {
        inFlight.delete(providerId);
      }
    },
  };
}
