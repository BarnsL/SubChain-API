import { providerDef } from './providers.js';

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function blankUsage() {
  return { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

export function usageFromPayload(payload) {
  try {
    const usage = JSON.parse(payload)?.usage;
    if (!usage || typeof usage !== 'object') return null;
    const prompt = number(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens);
    const completion = number(usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens);
    const total = number(usage.total_tokens ?? usage.totalTokens) || prompt + completion;
    return {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: total,
    };
  } catch {
    return null;
  }
}

function normalizeBucket(bucket) {
  return {
    id: String(bucket?.id || 'provider').slice(0, 120),
    label: String(bucket?.label || bucket?.id || 'Provider quota').slice(0, 120),
    status: ['available', 'exhausted', 'unknown'].includes(bucket?.status) ? bucket.status : 'unknown',
    usedPercent: bucket?.usedPercent === null || bucket?.usedPercent === undefined
      ? null
      : Math.max(0, Math.min(100, number(bucket.usedPercent))),
    limit: bucket?.limit === null || bucket?.limit === undefined ? null : number(bucket.limit),
    remaining: bucket?.remaining === null || bucket?.remaining === undefined ? null : number(bucket.remaining),
    windowMinutes: bucket?.windowMinutes === null || bucket?.windowMinutes === undefined ? null : number(bucket.windowMinutes),
    resetsAt: bucket?.resetsAt === null || bucket?.resetsAt === undefined ? null : number(bucket.resetsAt),
  };
}

export class QuotaTracker {
  constructor() {
    this.providers = new Map();
  }

  get(providerId) {
    return this.providers.get(providerId) || null;
  }

  ensure(providerId) {
    let existing = this.providers.get(providerId);
    if (!existing) {
      const def = providerDef(providerId);
      existing = {
        providerId,
        label: def.label,
        contextWindow: def.contextWindow,
        quotas: [],
        usagePercent: 0,
        observedUsage: blankUsage(),
        lastError: null,
        lastChecked: null,
        isExhausted: false,
      };
      this.providers.set(providerId, existing);
    }
    return existing;
  }

  merge(providerId, snapshot = {}) {
    const existing = this.ensure(providerId);
    if (Array.isArray(snapshot.quotas)) existing.quotas = snapshot.quotas.map(normalizeBucket);
    existing.usagePercent = existing.quotas.reduce((maximum, bucket) => Math.max(maximum, bucket.usedPercent || 0), 0);
    existing.isExhausted = existing.quotas.some((bucket) => bucket.status === 'exhausted' || bucket.usedPercent === 100);
    existing.lastChecked = Date.now();
    if (snapshot.error !== undefined) existing.lastError = snapshot.error ? String(snapshot.error).slice(0, 200) : null;
    return existing;
  }

  update(providerId, res) {
    const remaining = res.headers.get('x-ratelimit-remaining-requests')
      || res.headers.get('x-ratelimit-remaining-tokens');
    const limit = res.headers.get('x-ratelimit-limit-requests')
      || res.headers.get('x-ratelimit-limit-tokens');
    const quotas = [];
    if (remaining !== null && limit !== null && number(limit) > 0) {
      const limitValue = number(limit);
      const remainingValue = number(remaining);
      quotas.push({
        id: 'provider', label: 'Provider quota', status: remainingValue > 0 ? 'available' : 'exhausted',
        limit: limitValue, remaining: remainingValue,
        usedPercent: Math.round(((limitValue - remainingValue) / limitValue) * 100),
      });
    }
    const existing = this.merge(providerId, { quotas: quotas.length ? quotas : this.get(providerId)?.quotas || [] });
    existing.lastError = res.ok ? null : `HTTP ${res.status}`;
    if (res.ok) existing.isExhausted = false;
  }

  recordUsage(providerId, usage = {}) {
    const existing = this.ensure(providerId);
    const prompt = number(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens);
    const completion = number(usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens);
    const total = number(usage.total_tokens ?? usage.totalTokens) || prompt + completion;
    existing.observedUsage.requests += 1;
    existing.observedUsage.promptTokens += prompt;
    existing.observedUsage.completionTokens += completion;
    existing.observedUsage.totalTokens += total;
    return existing;
  }

  markExhausted(providerId) {
    const existing = this.ensure(providerId);
    existing.isExhausted = true;
    existing.usagePercent = 100;
    if (existing.quotas.length) {
      existing.quotas = existing.quotas.map((bucket) => ({ ...bucket, status: 'exhausted', usedPercent: 100 }));
    } else {
      existing.quotas = [normalizeBucket({ id: 'provider', status: 'exhausted', usedPercent: 100 })];
    }
  }

  markBucketExhausted(providerId, bucketId, label = bucketId) {
    const existing = this.ensure(providerId);
    const bucket = normalizeBucket({ id: bucketId, label, status: 'exhausted', usedPercent: 100 });
    const index = existing.quotas.findIndex((candidate) => candidate.id === bucket.id);
    if (index === -1) existing.quotas.push(bucket);
    else existing.quotas[index] = { ...existing.quotas[index], ...bucket };
    existing.usagePercent = existing.quotas.reduce((maximum, candidate) => Math.max(maximum, candidate.usedPercent || 0), 0);
    existing.isExhausted = true;
    existing.lastChecked = Date.now();
    return existing;
  }

  snapshot() {
    const now = Date.now();
    return [...this.providers.values()].map((provider) => ({
      ...provider,
      quotas: provider.quotas.map((bucket) => ({
        ...bucket,
        resetIn: bucket.resetsAt ? Math.max(0, Math.round((bucket.resetsAt - now) / 1000)) : null,
      })),
    }));
  }
}
