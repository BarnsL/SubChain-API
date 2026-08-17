// Private account aliases, provider health, live models, and observed usage.

import fs from 'node:fs';
import path from 'node:path';
import { providerDef } from './providers.js';
import { resolveDataDir } from './storage.js';

const EMPTY_USAGE = () => ({ requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 });

function read(file) {
  if (!fs.existsSync(file)) return { schemaVersion: 1, accounts: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed?.schemaVersion === 1 && parsed.accounts && typeof parsed.accounts === 'object' && !Array.isArray(parsed.accounts)) return parsed;
  } catch {}
  return { schemaVersion: 1, accounts: {} };
}

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  if (process.platform !== 'win32') fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, file);
  if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
}

function text(value, maximum = 160) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maximum) : null;
}

function safeModel(model) {
  if (!model || typeof model.id !== 'string' || !model.id.trim()) return null;
  return {
    id: model.id.trim().slice(0, 200),
    label: text(model.label, 200) || model.id.trim().slice(0, 200),
    inputModalities: Array.isArray(model.inputModalities)
      ? model.inputModalities.filter((item) => typeof item === 'string').slice(0, 10)
      : [],
    capabilities: model.capabilities && typeof model.capabilities === 'object' && !Array.isArray(model.capabilities)
      ? Object.fromEntries(Object.entries(model.capabilities).filter(([, value]) => ['string', 'boolean', 'number'].includes(typeof value)).slice(0, 20))
      : {},
    quotaFamily: text(model.quotaFamily, 120),
  };
}

function safeQuota(bucket) {
  if (!bucket || typeof bucket.id !== 'string') return null;
  const numberOrNull = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
  return {
    id: bucket.id.slice(0, 120),
    label: text(bucket.label, 120) || bucket.id.slice(0, 120),
    status: ['available', 'exhausted', 'unknown'].includes(bucket.status) ? bucket.status : 'unknown',
    usedPercent: numberOrNull(bucket.usedPercent),
    limit: numberOrNull(bucket.limit),
    remaining: numberOrNull(bucket.remaining),
    windowMinutes: numberOrNull(bucket.windowMinutes),
    resetsAt: numberOrNull(bucket.resetsAt),
  };
}

function safeUsage(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return {};
  return Object.fromEntries(
    ['lifetimeTokens', 'peakDailyTokens', 'longestRunningTurnSec', 'currentStreakDays', 'longestStreakDays']
      .filter((key) => Number.isFinite(Number(usage[key])))
      .map((key) => [key, Number(usage[key])]),
  );
}

function base(providerId, existing = {}) {
  const def = providerDef(providerId);
  return {
    providerId,
    name: text(existing.name, 120) || def.label,
    plan: text(existing.plan, 80),
    health: ['ready', 'missing', 'error', 'unknown'].includes(existing.health) ? existing.health : 'unknown',
    message: text(existing.message, 240),
    models: Array.isArray(existing.models) ? existing.models.map(safeModel).filter(Boolean) : [],
    quotas: Array.isArray(existing.quotas) ? existing.quotas.map(safeQuota).filter(Boolean) : [],
    usage: safeUsage(existing.usage),
    observedUsage: { ...EMPTY_USAGE(), ...(existing.observedUsage || {}) },
    lastPingAt: Number.isFinite(Number(existing.lastPingAt)) ? Number(existing.lastPingAt) : null,
    lastSuccessAt: Number.isFinite(Number(existing.lastSuccessAt)) ? Number(existing.lastSuccessAt) : null,
  };
}

export function createProviderStatusStore({ file = path.join(resolveDataDir(), 'provider-status.json'), clock = Date.now } = {}) {
  const change = (providerId, mutator) => {
    providerDef(providerId);
    const data = read(file);
    const account = base(providerId, data.accounts[providerId]);
    mutator(account);
    data.accounts[providerId] = base(providerId, account);
    write(file, data);
    return data.accounts[providerId];
  };

  return {
    file,
    get(providerId) {
      const value = read(file).accounts[providerId];
      return value ? base(providerId, value) : null;
    },
    list() {
      return Object.entries(read(file).accounts).map(([providerId, value]) => base(providerId, value));
    },
    rename(providerId, name) {
      if (typeof name !== 'string' || !name.trim()) throw new Error('Account name is required');
      return change(providerId, (account) => { account.name = name.trim().slice(0, 120); });
    },
    recordPing(providerId, snapshot = {}) {
      return change(providerId, (account) => {
        const now = Number(clock());
        account.lastPingAt = now;
        account.health = ['ready', 'missing', 'error', 'unknown'].includes(snapshot.health) ? snapshot.health : 'unknown';
        account.message = text(snapshot.message || snapshot.error, 240);
        account.plan = text(snapshot.plan, 80) ?? account.plan;
        if (Array.isArray(snapshot.models) && snapshot.models.length) account.models = snapshot.models.map(safeModel).filter(Boolean);
        if (Array.isArray(snapshot.quotas)) account.quotas = snapshot.quotas.map(safeQuota).filter(Boolean);
        if (snapshot.usage) account.usage = safeUsage(snapshot.usage);
        if (account.health === 'ready') account.lastSuccessAt = now;
      });
    },
    recordUsage(providerId, usage = {}) {
      return change(providerId, (account) => {
        const prompt = Number(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens) || 0;
        const completion = Number(usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens) || 0;
        const total = Number(usage.total_tokens ?? usage.totalTokens) || prompt + completion;
        account.observedUsage.requests += 1;
        account.observedUsage.promptTokens += Math.max(0, prompt);
        account.observedUsage.completionTokens += Math.max(0, completion);
        account.observedUsage.totalTokens += Math.max(0, total);
      });
    },
  };
}
