import { providerDef } from './providers.js';

export class QuotaTracker {
  constructor() {
    this.providers = new Map();
  }

  get(family) {
    return this.providers.get(family) || null;
  }

  update(providerId, res) {
    const family = providerId.replace(/\d+$/, '');
    const def = providerDef(family);
    const existing = this.providers.get(family) || {
      providerId: family,
      label: def.label,
      usagePercent: 0,
      contextWindow: def.contextWindow,
      resetAt: null,
      billingLane: 'unknown',
      lastError: null,
      lastChecked: Date.now(),
      isExhausted: false,
    };

    existing.lastChecked = Date.now();

    const remaining = res.headers.get('x-ratelimit-remaining-requests')
      || res.headers.get('x-ratelimit-remaining-tokens');
    const limit = res.headers.get('x-ratelimit-limit-requests')
      || res.headers.get('x-ratelimit-limit-tokens');

    if (remaining !== null && limit !== null) {
      const rem = Number(remaining);
      const lim = Number(limit);
      if (lim > 0) {
        existing.usagePercent = Math.round(((lim - rem) / lim) * 100);
      }
    }

    const resetHeader = res.headers.get('x-ratelimit-reset-requests')
      || res.headers.get('x-ratelimit-reset-tokens')
      || res.headers.get('x-ratelimit-reset');

    if (resetHeader) {
      const parsed = Date.parse(resetHeader);
      if (Number.isFinite(parsed)) {
        existing.resetAt = parsed;
      } else {
        const secs = Number(resetHeader);
        if (Number.isFinite(secs)) {
          existing.resetAt = Date.now() + secs * 1000;
        }
      }
    }

    if (!res.ok) {
      existing.lastError = `HTTP ${res.status}`;
    } else {
      existing.lastError = null;
      existing.isExhausted = false;
    }

    if (family === 'anthropic') {
      existing.billingLane = 'plan';
    }

    this.providers.set(family, existing);
  }

  markExhausted(family) {
    const existing = this.providers.get(family);
    if (existing) {
      existing.isExhausted = true;
      existing.usagePercent = 100;
    }
  }

  snapshot() {
    return [...this.providers.values()].map((p) => ({
      ...p,
      resetIn: p.resetAt ? Math.max(0, Math.round((p.resetAt - Date.now()) / 1000)) : null,
    }));
  }
}
