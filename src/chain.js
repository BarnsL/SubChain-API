import { resolveAccounts } from './config.js';
import { resolveCredential } from './auth.js';
import { transformRequest, transformResponse, transformStreamChunk, authHeader } from './transforms.js';

export class ChainError extends Error {
  constructor(message, attempts) {
    super(message);
    this.name = 'ChainError';
    this.attempts = attempts;
  }
}

export class Cooldowns {
  constructor(cooldownMs) {
    this.cooldownMs = cooldownMs;
    this.until = new Map();
    this.lastError = new Map();
  }
  penalise(id, reason, retryAfterMs) {
    this.until.set(id, Date.now() + (retryAfterMs ?? this.cooldownMs));
    this.lastError.set(id, reason);
  }
  clear(id) {
    this.until.delete(id);
    this.lastError.delete(id);
  }
  isCooling(id) {
    const t = this.until.get(id);
    if (t === undefined) return false;
    if (Date.now() >= t) { this.until.delete(id); return false; }
    return true;
  }
  snapshot() {
    const now = Date.now();
    return [...this.until.entries()].map(([id, t]) => ({
      id,
      secondsRemaining: Math.max(0, Math.round((t - now) / 1000)),
      lastError: this.lastError.get(id) || null,
    }));
  }
}

const FATAL_STATUS = new Set([400, 422]);

function retryAfterMs(res) {
  const raw = res.headers.get('retry-after');
  if (!raw) return undefined;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.min(secs * 1000, 300_000);
  const when = Date.parse(raw);
  return Number.isFinite(when) ? Math.max(0, when - Date.now()) : undefined;
}

function isAnthropicFake429(link, status, detail) {
  return link.transform === 'anthropic' && status === 429 &&
    /"Error"/.test(detail) && !detail.includes('retry-after');
}

function isAnthropicQuotaError(link, status, detail) {
  return link.transform === 'anthropic' && status === 400 &&
    /out of extra usage|You're out of/i.test(detail);
}

export function candidatesFor(scope, requestedModel) {
  const settings = scope.settings;
  const wanted = requestedModel && requestedModel !== 'auto' ? requestedModel : null;
  const out = [];

  for (const link of scope.links) {
    if (wanted && link.model !== wanted && `${link.provider}/${link.model}` !== wanted) continue;

    if (settings.mode === 'pinned' && settings.pinnedProvider) {
      const pinFamily = settings.pinnedProvider.replace(/\d+$/, '');
      const linkFamily = link.provider.replace(/\d+$/, '');
      if (linkFamily !== pinFamily) continue;
    }

    const credential = resolveCredential(link.provider);
    if (credential) {
      out.push({
        link,
        provider: link.provider,
        key: credential.token,
        keyIndex: 0,
        credential,
        id: `${link.index}:${link.provider}:0`,
      });
    }
  }
  return out;
}

export async function dispatch(scope, cooldowns, quota, body, { signal, onAttempt } = {}) {
  const settings = scope.settings;
  const candidates = candidatesFor(scope, body.model);
  const attempts = [];

  if (!candidates.length) {
    throw new ChainError(
      body.model && body.model !== 'auto'
        ? `No chain link serves model "${body.model}" with a configured credential.`
        : 'No chain link has a configured credential.',
      attempts
    );
  }

  const ready = candidates.filter((c) => !cooldowns.isCooling(c.id));
  const cooling = candidates.filter((c) => cooldowns.isCooling(c.id));
  const limit = settings.maxAttempts ?? candidates.length;

  const thresholdFiltered = ready.filter((c) => {
    const family = c.link.provider.replace(/\d+$/, '');
    const threshold = settings.providerThresholds[family]
      ?? settings.fallbackThresholdPercent;
    const usage = quota.get(family);
    return !usage || usage.usagePercent < threshold;
  });

  const belowThreshold = thresholdFiltered.length ? thresholdFiltered : ready;
  const order = [...belowThreshold, ...cooling].slice(0, limit);

  for (const cand of order) {
    const { link, credential } = cand;
    const started = Date.now();
    const timeout = AbortSignal.timeout(settings.requestTimeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    const record = (outcome, detail) => {
      const attempt = {
        provider: cand.provider, model: link.model, keyIndex: cand.keyIndex,
        outcome, detail, ms: Date.now() - started,
      };
      attempts.push(attempt);
      onAttempt?.(attempt);
    };

    const { endpoint, body: transformedBody, headers: transformHeaders } = transformRequest(body, link);
    const url = `${link.baseUrl}${endpoint}`;

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        signal: combined,
        headers: {
          'Content-Type': 'application/json',
          ...authHeader(credential, link),
          ...transformHeaders,
          ...link.headers,
        },
        body: JSON.stringify(transformedBody),
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      cooldowns.penalise(cand.id, `network: ${err.message}`);
      record('network-error', err.message);
      continue;
    }

    quota.update(link.provider, res);

    if (res.ok) {
      cooldowns.clear(cand.id);
      record('ok', `${res.status}`);
      return { response: res, link, provider: cand.provider, keyIndex: cand.keyIndex, attempts };
    }

    const detail = (await res.text().catch(() => '')).slice(0, 400);

    if (isAnthropicFake429(link, res.status, detail)) {
      cooldowns.penalise(cand.id, 'anthropic: wrong system block (fake 429)', 600_000);
      record('fatal', `${res.status} fake-429: wrong system block`);
      continue;
    }

    if (isAnthropicQuotaError(link, res.status, detail)) {
      quota.markExhausted(link.provider.replace(/\d+$/, ''));
      cooldowns.penalise(cand.id, 'anthropic: quota exhausted', 600_000);
      record('quota-exhausted', `${res.status} ${detail}`);
      continue;
    }

    if (FATAL_STATUS.has(res.status)) {
      record('fatal', `${res.status} ${detail}`);
      throw new ChainError(`Upstream rejected the request (${res.status}): ${detail}`, attempts);
    }

    cooldowns.penalise(cand.id, `http ${res.status}`, retryAfterMs(res));
    record('http-error', `${res.status} ${detail}`);
  }

  throw new ChainError(
    `All ${order.length} candidate(s) failed. Last: ${attempts.at(-1)?.detail ?? 'unknown'}`,
    attempts
  );
}
