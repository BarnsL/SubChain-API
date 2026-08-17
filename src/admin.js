import path from 'node:path';
import { FAMILIES, familyMembers, providerDef } from './providers.js';
import { ROOT } from './config.js';
import { resolveCredential } from './auth.js';
import {
  MAX_CHAINS,
  MAX_LINKS_PER_NEW_CHAIN,
  MAX_LOCAL_KEYS,
  rotateLocalKey,
  saveRouting,
  tokenForLocalKey,
  validateRouting,
} from './routing.js';

export const ENV_FILE = process.env.SUBCHAIN_ENV_FILE || path.join(ROOT, '.env');

export function bearerFrom(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : h.trim() || null;
}

function routingId(value, fallback) {
  const normalized = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  if (!normalized || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(normalized)) {
    throw new Error('name must contain letters or numbers');
  }
  return normalized;
}

function uniqueId(entries, requested, fallback) {
  const base = routingId(requested, fallback);
  const ids = new Set(entries.map((entry) => entry.id));
  if (!ids.has(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix++) {
    const id = `${base.slice(0, 64 - String(suffix).length - 1)}-${suffix}`;
    if (!ids.has(id)) return id;
  }
  throw new Error('could not allocate a unique identifier');
}

function assertTarget(runtime, target) {
  if (!target || (target.type !== 'chain' && target.type !== 'provider')) {
    throw new Error('target must be a chain or provider');
  }
  if (target.type === 'chain') {
    if (!runtime.routing.chains.some((chain) => chain.id === target.id)) {
      throw new Error(`unknown chain target: ${target.id}`);
    }
  } else {
    try { providerDef(target.id); }
    catch { throw new Error(`unknown provider target: ${target.id}`); }
  }
}

function assertLink(link) {
  if (!link || typeof link.model !== 'string' || !link.model.trim()) {
    throw new Error('link model is required');
  }
  providerDef(link.provider);
}

function persistRouting(runtime) {
  validateRouting(runtime.routing);
  if (runtime.routingFile) saveRouting(runtime.routing, runtime.routingFile);
}

/** Return secret-free dashboard data for the routing runtime. */
export function routingInventory(runtime, quota, {
  statusStore = null,
  providerProbeService = null,
  managedProviderAvailable = () => false,
  credentialResolver = resolveCredential,
} = {}) {
  const chains = runtime.routing.chains.map((chain) => ({
    ...chain,
    links: chain.links.map((link, index) => ({ ...link, index })),
  }));
  const linkedProviderIds = new Set(chains.flatMap((chain) => chain.links.map((link) => link.provider)));
  const storedProviderIds = new Set(statusStore?.list?.().map((account) => account.providerId) || []);
  const explicitSlotIds = new Set();
  for (const family of FAMILIES) {
    for (const providerId of familyMembers(family).slice(1)) {
      const def = providerDef(providerId);
      if (def.keyEnv.some((name) => typeof runtime.env?.[name] === 'string' && runtime.env[name].trim())) explicitSlotIds.add(providerId);
    }
  }
  const providerIds = [...FAMILIES, ...linkedProviderIds, ...storedProviderIds, ...explicitSlotIds];
  const providers = [...new Set(providerIds)].map((providerId) => {
    const def = providerDef(providerId);
    const credential = def.transport === 'http' ? credentialResolver(providerId) : null;
    const status = statusStore?.get(providerId) || null;
    const managedRuntimeAvailable = def.transport !== 'http' && Boolean(managedProviderAvailable(providerId));
    const managedAuthenticated = def.transport !== 'http' && status?.health === 'ready';
    const hasCredential = Boolean(credential) || managedAuthenticated;
    const trackedQuota = quota?.get(providerId) || null;
    const storedQuotas = Array.isArray(status?.quotas) ? status.quotas : [];
    const statusQuota = storedQuotas.length ? {
      providerId,
      quotas: storedQuotas,
      usagePercent: storedQuotas.reduce((maximum, bucket) => Math.max(maximum, Number(bucket.usedPercent) || 0), 0),
      observedUsage: status?.observedUsage || null,
      lastChecked: status?.lastPingAt || null,
      isExhausted: storedQuotas.some((bucket) => bucket.status === 'exhausted'),
    } : null;
    return {
      id: providerId,
      family: def.family,
      name: status?.name || def.label,
      label: status?.name || def.label,
      baseUrl: def.baseUrl,
      authType: def.authType,
      transport: def.transport,
      transform: def.transform,
      contextWindow: def.contextWindow,
      subscriptionUrl: def.subscriptionUrl,
      jurisdiction: def.jurisdiction,
      plan: status?.plan || null,
      health: status?.health || (hasCredential ? 'unknown' : 'missing'),
      statusMessage: status?.message || null,
      hasCredential,
      canConnectSubscription: providerId === 'openai-codex'
        && managedRuntimeAvailable
        && status?.health === 'missing',
      credentialSource: credential?.source || (managedAuthenticated ? 'provider-application' : null),
      models: status?.models?.length
        ? status.models
        : def.fallbackModels.map((id) => ({ id, label: id, inputModalities: [], capabilities: {}, quotaFamily: null })),
      quota: trackedQuota || statusQuota,
      quotas: trackedQuota?.quotas || storedQuotas,
      usage: status?.usage || {},
      observedUsage: status?.observedUsage || trackedQuota?.observedUsage || null,
      lastPingAt: status?.lastPingAt || null,
      lastSuccessAt: status?.lastSuccessAt || null,
      isPinging: providerProbeService?.isPinging?.(providerId) || false,
      linkCount: chains.reduce((count, chain) => count + chain.links.filter((link) => link.provider === providerId).length, 0),
    };
  });
  const localKeys = runtime.routing.localKeys.map((key) => ({
    id: key.id,
    name: key.name,
    target: key.target,
    harnessId: key.harnessId,
    hasToken: Boolean(tokenForLocalKey(runtime, key)),
  }));
  const links = chains.flatMap((chain) => chain.links);
  return {
    providers,
    chains,
    localKeys,
    settings: runtime.settings,
    totals: {
      chains: chains.length,
      links: links.length,
      localKeys: localKeys.length,
      ready: providers.filter((provider) => provider.hasCredential).length,
      candidates: links.reduce((count, link) => count + Number(Boolean(resolveCredential(link.provider))), 0),
    },
  };
}

/** Add a distinct inbound API key and save only its reference in routing metadata. */
export function addLocalKey(runtime, { id, name, target, harnessId = 'default' }) {
  if (runtime.routing.localKeys.length >= MAX_LOCAL_KEYS) {
    throw new Error(`routing supports at most ${MAX_LOCAL_KEYS} local keys`);
  }
  assertTarget(runtime, target);
  routingId(harnessId, 'default');
  const keyId = uniqueId(runtime.routing.localKeys, id || name, 'key');
  const key = {
    id: keyId,
    name: typeof name === 'string' && name.trim() ? name.trim() : keyId,
    secretRef: `local-key:${keyId}`,
    target: { type: target.type, id: target.id },
    harnessId,
  };
  runtime.routing.localKeys.push(key);
  const token = rotateLocalKey(runtime, keyId);
  try {
    persistRouting(runtime);
  } catch (error) {
    runtime.routing.localKeys.pop();
    runtime.secretStore.delete(key.secretRef);
    throw error;
  }
  return { key, token };
}

/** Update a local key's display name or destination without rotating its token. */
export function updateLocalKey(runtime, keyId, { name, target, harnessId }) {
  const key = runtime.routing.localKeys.find((candidate) => candidate.id === keyId);
  if (!key) throw new Error(`unknown local key: ${keyId}`);
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) throw new Error('local key name is required');
    key.name = name.trim();
  }
  if (target !== undefined) {
    assertTarget(runtime, target);
    key.target = { type: target.type, id: target.id };
  }
  if (harnessId !== undefined) key.harnessId = routingId(harnessId, 'default');
  persistRouting(runtime);
  return key;
}

export function removeLocalKey(runtime, keyId) {
  if (keyId === 'default') throw new Error('the default local key cannot be deleted');
  const index = runtime.routing.localKeys.findIndex((candidate) => candidate.id === keyId);
  if (index === -1) throw new Error(`unknown local key: ${keyId}`);
  const [key] = runtime.routing.localKeys.splice(index, 1);
  try {
    persistRouting(runtime);
    runtime.secretStore.delete(key.secretRef);
  } catch (error) {
    runtime.routing.localKeys.splice(index, 0, key);
    throw error;
  }
}

/** Add a new chain with its first dropdown-selected provider/model link. */
export function addChain(runtime, { id, name, link }) {
  if (runtime.routing.chains.length >= MAX_CHAINS) {
    throw new Error(`routing supports at most ${MAX_CHAINS} chains`);
  }
  assertLink(link);
  const chainId = uniqueId(runtime.routing.chains, id || name, 'chain');
  const chain = {
    id: chainId,
    name: typeof name === 'string' && name.trim() ? name.trim() : chainId,
    links: [{ provider: link.provider, model: link.model.trim(), ...(link.baseUrl ? { baseUrl: link.baseUrl } : {}) }],
  };
  runtime.routing.chains.push(chain);
  try {
    persistRouting(runtime);
  } catch (error) {
    runtime.routing.chains.pop();
    throw error;
  }
  return chain;
}

export function addChainLink(runtime, chainId, link) {
  const chain = runtime.routing.chains.find((candidate) => candidate.id === chainId);
  if (!chain) throw new Error(`unknown chain: ${chainId}`);
  assertLink(link);
  if (chain.links.length >= MAX_LINKS_PER_NEW_CHAIN) {
    throw new Error(`chain ${chainId} cannot contain more than five links`);
  }
  const next = { provider: link.provider, model: link.model.trim(), ...(link.baseUrl ? { baseUrl: link.baseUrl } : {}) };
  chain.links.push(next);
  try {
    persistRouting(runtime);
  } catch (error) {
    chain.links.pop();
    throw error;
  }
  return next;
}

export function removeChainLink(runtime, chainId, index) {
  const chain = runtime.routing.chains.find((candidate) => candidate.id === chainId);
  if (!chain) throw new Error(`unknown chain: ${chainId}`);
  if (!Number.isInteger(index) || index < 0 || index >= chain.links.length) throw new Error('invalid chain link index');
  if (chain.links.length === 1) throw new Error('a chain must retain at least one link');
  const [link] = chain.links.splice(index, 1);
  try {
    persistRouting(runtime);
  } catch (error) {
    chain.links.splice(index, 0, link);
    throw error;
  }
}

export function reorderRoutingChain(runtime, chainId, order) {
  const chain = runtime.routing.chains.find((candidate) => candidate.id === chainId);
  if (!chain) throw new Error(`unknown chain: ${chainId}`);
  if (!Array.isArray(order) || order.length !== chain.links.length) throw new Error(`order must contain ${chain.links.length} entries`);
  const used = new Set(order);
  if (used.size !== chain.links.length || [...used].some((index) => !Number.isInteger(index) || index < 0 || index >= chain.links.length)) {
    throw new Error('order contains an invalid link index');
  }
  const previous = chain.links;
  chain.links = order.map((index) => previous[index]);
  try {
    persistRouting(runtime);
  } catch (error) {
    chain.links = previous;
    throw error;
  }
}
