import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerDef, familyMembers } from './providers.js';
import { resolveCredential } from './auth.js';
import { IS_SEA, EXE_DIR } from './runtime.js';

export const ROOT = IS_SEA
  ? EXE_DIR
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_CHAIN = path.join(ROOT, 'chain.config.json');

export function loadDotEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return 0;
  let loaded = 0;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
      loaded++;
    }
  }
  return loaded;
}

export function resolveKeys(providerId) {
  const cred = resolveCredential(providerId);
  return cred ? [cred.token] : [];
}

export function resolveAccounts(providerId) {
  const out = [];
  for (const member of familyMembers(providerId)) {
    for (const key of resolveKeys(member)) out.push({ provider: member, key });
  }
  return out;
}

export function resolveKey(providerId) {
  return resolveKeys(providerId)[0] ?? null;
}

export function saveChainConfig(chain, file = DEFAULT_CHAIN) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.chain = chain.links.map((l) => {
    const entry = { provider: l.provider, model: l.model };
    if (l.note) entry.note = l.note;
    return entry;
  });
  raw.mode = chain.settings.mode;
  raw.pinnedProvider = chain.settings.pinnedProvider;
  raw.fallbackThresholdPercent = chain.settings.fallbackThresholdPercent;
  raw.providerThresholds = chain.settings.providerThresholds;
  fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n', 'utf8');
}

export function loadChain(file = DEFAULT_CHAIN) {
  if (!fs.existsSync(file)) throw new Error(`Chain config not found: ${file}`);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const links = (parsed.chain || []).map((entry, i) => {
    const def = providerDef(entry.provider);
    if (!entry.model) throw new Error(`chain[${i}] (${entry.provider}) is missing "model"`);
    return {
      index: i,
      provider: entry.provider,
      label: def.label,
      model: entry.model,
      baseUrl: (entry.baseUrl || def.baseUrl).replace(/\/+$/, ''),
      headers: {},
      authType: def.authType,
      transport: def.transport,
      transform: def.transform,
      contextWindow: def.contextWindow,
    };
  });
  if (!links.length) throw new Error(`Chain config has no entries: ${file}`);
  return {
    links,
    settings: {
      requestTimeoutMs: parsed.requestTimeoutMs ?? 90_000,
      cooldownMs: parsed.cooldownMs ?? 60_000,
      maxAttempts: parsed.maxAttempts ?? null,
      fallbackThresholdPercent: parsed.fallbackThresholdPercent ?? 90,
      mode: parsed.mode ?? 'chain',
      pinnedProvider: parsed.pinnedProvider ?? null,
      providerThresholds: parsed.providerThresholds ?? {},
      ...parsed.settings,
    },
  };
}

export function chainStatus(chain) {
  return chain.links.map((l) => {
    const managed = l.transport && l.transport !== 'http';
    const accounts = resolveAccounts(l.provider);
    const slots = [...new Set(accounts.map((a) => a.provider))];
    return {
      index: l.index,
      provider: l.provider,
      model: l.model,
      slots,
      accountCount: slots.length,
      keyCount: accounts.length,
      hasKey: managed || accounts.length > 0,
      managed,
    };
  });
}
