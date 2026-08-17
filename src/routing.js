// Versioned, secret-free routing metadata for local SubChain API keys.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { providerDef } from './providers.js';

export const MAX_LOCAL_KEYS = 10;
export const MAX_CHAINS = 10;
export const MAX_LINKS_PER_NEW_CHAIN = 5;

const DEFAULT_SETTINGS = {
  requestTimeoutMs: 90_000,
  cooldownMs: 60_000,
  maxAttempts: null,
  fallbackThresholdPercent: 90,
  mode: 'chain',
  pinnedProvider: null,
  providerThresholds: {},
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function validateId(value, label) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) {
    throw new Error(`${label} must be a lowercase identifier`);
  }
}

/** Validate only committed routing metadata. Tokens stay in a separate secret store. */
export function validateRouting(routing) {
  if (!routing || routing.schemaVersion !== 2) {
    throw new Error('routing config must use schemaVersion 2');
  }
  if (!Array.isArray(routing.chains) || !Array.isArray(routing.localKeys)) {
    throw new Error('routing config requires chains[] and localKeys[]');
  }
  if (routing.chains.length > MAX_CHAINS) throw new Error(`routing config supports at most ${MAX_CHAINS} chains`);
  if (routing.localKeys.length > MAX_LOCAL_KEYS) throw new Error(`routing config supports at most ${MAX_LOCAL_KEYS} local keys`);

  const chainIds = new Set();
  for (const chain of routing.chains) {
    validateId(chain?.id, 'chain id');
    if (chainIds.has(chain.id)) throw new Error(`duplicate chain id: ${chain.id}`);
    chainIds.add(chain.id);
    if (typeof chain.name !== 'string' || !chain.name.trim()) throw new Error(`chain ${chain.id} needs a name`);
    if (!Array.isArray(chain.links) || !chain.links.length) throw new Error(`chain ${chain.id} needs at least one link`);
    if (!chain.migrated && chain.links.length > MAX_LINKS_PER_NEW_CHAIN) {
      throw new Error(`chain ${chain.id} cannot contain more than five links`);
    }
    for (const link of chain.links) {
      if (typeof link?.provider !== 'string' || typeof link?.model !== 'string' || !link.model) {
        throw new Error(`chain ${chain.id} has an invalid link`);
      }
    }
  }

  const keyIds = new Set();
  for (const key of routing.localKeys) {
    validateId(key?.id, 'local key id');
    if (keyIds.has(key.id)) throw new Error(`duplicate local key id: ${key.id}`);
    keyIds.add(key.id);
    if (typeof key.name !== 'string' || !key.name.trim()) throw new Error(`local key ${key.id} needs a name`);
    if (key.secretRef !== `local-key:${key.id}`) throw new Error(`local key ${key.id} has an invalid secret reference`);
    if (!key.target || (key.target.type !== 'chain' && key.target.type !== 'provider')) {
      throw new Error(`local key ${key.id} needs a chain or provider target`);
    }
    if (key.target.type === 'chain' && !chainIds.has(key.target.id)) {
      throw new Error(`local key ${key.id} references unknown chain ${key.target.id}`);
    }
    if (key.target.type === 'provider') validateId(key.target.id, 'provider target id');
  }

  return routing;
}

/** Persist validated metadata without putting secrets in the routing file. */
export function saveRouting(routing, file) {
  validateRouting(routing);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(routing, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

/**
 * Load v2 routing or migrate the legacy chain once. A caller may pass a secret
 * store to preserve the legacy token outside the committed routing manifest.
 */
export function loadRouting({ routingFile, legacyFile, legacyAccessKey = null, secretStore = null }) {
  if (fs.existsSync(routingFile)) return validateRouting(readJson(routingFile));

  const legacy = readJson(legacyFile);
  if (!Array.isArray(legacy.chain) || !legacy.chain.length) {
    throw new Error('legacy chain config needs at least one link');
  }
  const routing = {
    schemaVersion: 2,
    chains: [{
      id: 'default',
      name: 'Default chain',
      migrated: legacy.migrated !== false,
      links: legacy.chain.map(({ provider, model, note, baseUrl }) => ({ provider, model, ...(note ? { note } : {}), ...(baseUrl ? { baseUrl } : {}) })),
    }],
    localKeys: [{
      id: 'default',
      name: 'Default',
      secretRef: 'local-key:default',
      target: { type: 'chain', id: 'default' },
    }],
  };
  validateRouting(routing);
  if (legacyAccessKey && secretStore?.get('local-key:default') === null) {
    secretStore.set('local-key:default', legacyAccessKey);
  }
  saveRouting(routing, routingFile);
  return routing;
}

/** Build the only links a successfully authenticated local key may reach. */
export function scopeForLocalKey(routing, key) {
  if (key.target.type === 'chain') {
    const chain = routing.chains.find((candidate) => candidate.id === key.target.id);
    if (!chain) throw new Error(`local key ${key.id} has no chain target`);
    return { kind: 'chain', chain, links: materializeLinks(chain.links) };
  }
  const links = routing.chains
    .flatMap((chain) => chain.links)
    .filter((link) => link.provider.replace(/\d+$/, '') === key.target.id);
  return { kind: 'provider', provider: key.target.id, links: materializeLinks(links) };
}

function materializeLinks(links) {
  return links.map((link, index) => {
    const provider = providerDef(link.provider);
    return {
      ...link,
      index,
      label: provider.label,
      baseUrl: (link.baseUrl || provider.baseUrl).replace(/\/+$/, ''),
      headers: {},
      authType: provider.authType,
      transform: provider.transform,
      contextWindow: provider.contextWindow,
    };
  });
}

function localKeyEnvName(keyId) {
  if (keyId === 'default') return 'SUBCHAIN_ACCESS_KEY';
  return `SUBCHAIN_LOCAL_KEY_${keyId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

function secureEquals(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

/** Create the runtime boundary between public routing metadata and private local key material. */
export function createRoutingRuntime({ routing, secretStore, env = process.env, settings = {}, routingFile = null }) {
  if (!secretStore || typeof secretStore.get !== 'function' || typeof secretStore.set !== 'function') {
    throw new Error('routing runtime needs a private secret store');
  }
  return {
    routing: validateRouting(routing),
    secretStore,
    env,
    routingFile,
    settings: { ...DEFAULT_SETTINGS, ...settings },
  };
}

/** Return a token for a configured local key. Environment values bootstrap only an absent private token. */
export function tokenForLocalKey(runtime, key) {
  const stored = runtime.secretStore.get(key.secretRef);
  if (stored) return stored;
  const override = runtime.env?.[localKeyEnvName(key.id)];
  return typeof override === 'string' && override.trim()
    ? override.trim()
    : null;
}

/** Authenticate an inbound token without leaking which configured key matched. */
export function authenticateLocalKey(runtime, presentedToken) {
  let match = null;
  for (const key of runtime.routing.localKeys) {
    const token = tokenForLocalKey(runtime, key);
    if (token && secureEquals(token, presentedToken) && !match) match = key;
  }
  return match;
}

/** Rotate one independent local key without affecting the other configured keys. */
export function rotateLocalKey(runtime, keyId) {
  const key = runtime.routing.localKeys.find((candidate) => candidate.id === keyId);
  if (!key) throw new Error(`unknown local key: ${keyId}`);
  const token = `sc-${crypto.randomBytes(24).toString('base64url')}`;
  runtime.secretStore.set(key.secretRef, token);
  return token;
}

/** Ensure an initial local token exists without storing it in project configuration. */
export function ensureLocalKey(runtime, keyId = 'default') {
  const key = runtime.routing.localKeys.find((candidate) => candidate.id === keyId);
  if (!key) throw new Error(`unknown local key: ${keyId}`);
  return tokenForLocalKey(runtime, key) || rotateLocalKey(runtime, keyId);
}
