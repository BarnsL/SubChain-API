// Privacy-safe operational request journal.
//
// The journal deliberately accepts a small metadata schema instead of
// serializing requests, responses, headers, or errors wholesale. This is the
// security boundary that keeps prompts, completions, credentials, tool bodies,
// and raw provider diagnostics out of memory and JSONL persistence.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { summarizePromptContext } from './operator-prompt-summary.js';

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

const finiteNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : undefined;

const cleanText = (value, maxLength = 160) => {
  if (value === undefined || value === null) return undefined;
  const valueText = String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return valueText ? valueText.slice(0, maxLength) : undefined;
};

const compact = (value) => {
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
};

const contentChars = (content) => {
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  return content.reduce((total, part) => {
    if (typeof part === 'string') return total + part.length;
    if (!part || typeof part !== 'object') return total;
    if (typeof part.text === 'string') return total + part.text.length;
    if (typeof part.content === 'string') return total + part.content.length;
    return total;
  }, 0);
};

const exactUsage = (usage) => {
  if (!usage || typeof usage !== 'object') return null;
  const inputTokens = finiteNumber(usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = finiteNumber(usage.output_tokens ?? usage.completion_tokens);
  const suppliedTotal = finiteNumber(usage.total_tokens);
  if (inputTokens === undefined && outputTokens === undefined && suppliedTotal === undefined) return null;
  return {
    inputTokens: inputTokens ?? Math.max(0, (suppliedTotal ?? 0) - (outputTokens ?? 0)),
    outputTokens: outputTokens ?? Math.max(0, (suppliedTotal ?? 0) - (inputTokens ?? 0)),
    totalTokens: suppliedTotal ?? (inputTokens ?? 0) + (outputTokens ?? 0),
    source: 'exact',
  };
};

const outputText = (choice) => {
  if (!choice || typeof choice !== 'object') return '';
  const content = choice.message?.content ?? choice.delta?.content ?? choice.text;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === 'string' ? part : part?.text ?? '').join('');
  }
  return '';
};

export function estimatedUsage(inputChars = 0, outputChars = 0) {
  const inputTokens = Math.ceil(Math.max(0, finiteNumber(inputChars) ?? 0) / 4);
  const outputTokens = Math.ceil(Math.max(0, finiteNumber(outputChars) ?? 0) / 4);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, source: 'estimated' };
}

// ── Opt-in raw retention ──────────────────────────────────────────────
//
// Everything else in this file is deliberately lossy: it counts, classifies
// and redacts rather than storing what was said. These helpers are the one
// exception, and they exist because a host debugging their own router
// sometimes genuinely needs the exact bytes.
//
// They are inert unless the matching switch is on in the operator's log
// policy (Chat → Settings), every switch defaults to off, and each blob is
// hard-capped so one enormous request cannot consume the journal's rotation
// budget on its own. Capture is a policy decision; the cap is not.

const RAW_DEFAULT_MAX = 20_000;
/** Defensive ceiling applied on persist, whatever the policy asked for. */
export const RAW_HARD_CAP = 64_000;

const rawLimit = (policy = {}) => Math.max(
  1_000,
  Math.min(RAW_HARD_CAP, finiteNumber(policy.maxRawChars) ?? RAW_DEFAULT_MAX),
);

/** Serialise `value`, truncating with a visible marker rather than silently. */
const boundedJson = (value, limit) => {
  let text;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return undefined;
  }
  if (typeof text !== 'string' || !text) return undefined;
  return text.length > limit
    ? `${text.slice(0, limit)}…[truncated ${text.length - limit} chars]`
    : text;
};

/** Verbatim request capture. Returns undefined unless a switch enabled it. */
function rawRequestCapture(body = {}, policy = {}) {
  const wantPrompts = policy.rawPrompts === true;
  const wantTools = policy.rawToolBodies === true;
  if (!wantPrompts && !wantTools) return undefined;
  const limit = rawLimit(policy);
  const out = {};
  if (wantPrompts && Array.isArray(body.messages)) out.messages = boundedJson(body.messages, limit);
  if (wantTools && Array.isArray(body.tools)) out.tools = boundedJson(body.tools, limit);
  if (wantTools && body.tool_choice !== undefined) out.toolChoice = boundedJson(body.tool_choice, 2_000);
  return Object.keys(out).length ? out : undefined;
}

export function summarizeInput(body = {}, policy = {}) {
  const raw = rawRequestCapture(body, policy);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const roles = {};
  let inputChars = 0;
  for (const message of messages) {
    const role = cleanText(message?.role, 24) || 'unknown';
    roles[role] = (roles[role] || 0) + 1;
    inputChars += contentChars(message?.content);
  }
  return {
    model: cleanText(body.model, 160) || 'auto',
    stream: body.stream === true,
    messageCount: messages.length,
    roles,
    inputChars,
    toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
    maxTokens: finiteNumber(body.max_tokens ?? body.max_completion_tokens),
    // Limited useful context: newest text only, strongly redacted/bounded.
    // Fail closed, like every other retention switch here: a caller that
    // forgets to pass a policy gets metadata, not content. Only an explicit
    // `true` turns summaries on.
    promptSummary: policy.promptSummary === true ? summarizePromptContext(body, {
      maxChars: policy.maxSummaryChars || 280,
      maxItems: policy.maxContextItems || 3,
    }) : [],
    // Omitted entirely rather than set to undefined, so a metadata-only record
    // has no raw key at all.
    ...(raw ? { raw } : {}),
  };
}

export function summarizeJsonOutput(payload, policy = {}) {
  const outputBytes = Buffer.byteLength(typeof payload === 'string' ? payload : JSON.stringify(payload ?? ''));
  let parsed = payload;
  if (typeof payload === 'string') {
    try {
      parsed = JSON.parse(payload);
    } catch {
      return { outputChars: 0, outputBytes, choiceCount: 0, finishReasons: [], usage: null };
    }
  }
  const choices = Array.isArray(parsed?.choices) ? parsed.choices : [];
  const finishReasons = [...new Set(choices.map((choice) => cleanText(choice?.finish_reason, 64)).filter(Boolean))];
  return {
    outputChars: choices.reduce((total, choice) => total + outputText(choice).length, 0),
    outputBytes,
    choiceCount: choices.length,
    finishReasons,
    usage: exactUsage(parsed?.usage),
    ...(policy.rawResponses === true
      ? { rawOutput: boundedJson(parsed, rawLimit(policy)) }
      : {}),
  };
}

export function createSseMeter(policy = {}) {
  const decoder = new TextDecoder();
  let pending = '';
  let outputBytes = 0;
  let outputChars = 0;
  let usage = null;
  const choiceIndexes = new Set();
  const finishReasons = new Set();
  // Assembled only when the host asked for raw responses. Growth is bounded
  // as we go, so a long stream cannot accumulate without limit in memory.
  const wantRaw = policy.rawResponses === true;
  const rawCap = rawLimit(policy);
  let rawOutput = '';

  const consumeLine = (line) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    try {
      const event = JSON.parse(data);
      const choices = Array.isArray(event?.choices) ? event.choices : [];
      for (let index = 0; index < choices.length; index++) {
        const choice = choices[index];
        choiceIndexes.add(finiteNumber(choice?.index) ?? index);
        const text = outputText(choice);
        outputChars += text.length;
        if (wantRaw && rawOutput.length < rawCap) rawOutput += text;
        const reason = cleanText(choice?.finish_reason, 64);
        if (reason) finishReasons.add(reason);
      }
      usage = exactUsage(event?.usage) ?? usage;
    } catch {
      // The upstream bytes still pass through. A malformed metadata event is
      // simply unavailable for summaries and is never retained.
    }
  };

  return {
    push(chunk) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      outputBytes += bytes.length;
      pending += decoder.decode(bytes, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) consumeLine(line);
    },
    finish(inputChars = 0) {
      pending += decoder.decode();
      if (pending) consumeLine(pending);
      return {
        outputChars,
        outputBytes,
        choiceCount: choiceIndexes.size,
        finishReasons: [...finishReasons],
        usage: usage ?? estimatedUsage(inputChars, outputChars),
        ...(wantRaw ? { rawOutput: boundedJson(rawOutput, rawCap) } : {}),
      };
    },
  };
}

const remoteCategory = (address) => {
  const value = String(address || '').replace(/^::ffff:/, '').toLowerCase();
  if (!value) return 'unknown';
  if (value === '::1' || value === 'localhost' || value.startsWith('127.')) return 'loopback';
  if (
    value.startsWith('10.') ||
    value.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(value) ||
    value.startsWith('fc') ||
    value.startsWith('fd')
  ) return 'private';
  return 'public';
};

export function requestMetadata(req) {
  const headers = req?.headers || {};
  const sdk = compact({
    language: cleanText(headers['x-stainless-lang'], 40),
    packageVersion: cleanText(headers['x-stainless-package-version'], 40),
    os: cleanText(headers['x-stainless-os'], 40),
    architecture: cleanText(headers['x-stainless-arch'], 40),
    runtime: cleanText(headers['x-stainless-runtime'], 40),
    runtimeVersion: cleanText(headers['x-stainless-runtime-version'], 40),
    helperMethod: cleanText(headers['x-stainless-helper-method'], 80),
  });
  return compact({
    remoteCategory: remoteCategory(req?.socket?.remoteAddress),
    reportedApp: cleanText(headers['x-subchain-app'] ?? headers['x-freechain-app'], 80),
    sessionId: cleanText(headers['x-subchain-session-id'] ?? headers['x-freechain-session-id'], 120),
    sdk: Object.keys(sdk).length ? sdk : undefined,
  });
}

const safeUsage = (usage) => {
  if (!usage || typeof usage !== 'object') return undefined;
  const source = usage.source === 'exact' ? 'exact' : 'estimated';
  return compact({
    inputTokens: finiteNumber(usage.inputTokens),
    outputTokens: finiteNumber(usage.outputTokens),
    totalTokens: finiteNumber(usage.totalTokens),
    source,
  });
};

/**
 * Pass a verbatim opt-in field through unchanged apart from a length ceiling.
 *
 * Deliberately not cleanText: these fields exist precisely because the host
 * asked for the exact bytes, so stripping control characters would defeat
 * them. The cap is unconditional — policy decides whether a field is captured
 * at all, never how large it may grow once it is.
 */
const rawField = (value, limit = RAW_HARD_CAP) =>
  (typeof value === 'string' && value ? value.slice(0, limit) : undefined);

const safeRecord = (record = {}) => {
  const input = record.request?.inputSummary;
  const request = compact({
    model: cleanText(record.request?.model ?? input?.model, 160),
    stream: typeof record.request?.stream === 'boolean' ? record.request.stream : input?.stream,
    inputSummary: typeof input === 'string'
      ? cleanText(input, 80)
      : input && typeof input === 'object'
        ? compact({
            messageCount: finiteNumber(input.messageCount),
            roles: input.roles && typeof input.roles === 'object'
              ? Object.fromEntries(Object.entries(input.roles).slice(0, 16).map(([role, count]) => [cleanText(role, 24), finiteNumber(count)]).filter(([role, count]) => role && count !== undefined))
              : undefined,
            inputChars: finiteNumber(input.inputChars),
            toolCount: finiteNumber(input.toolCount),
            maxTokens: finiteNumber(input.maxTokens),
            promptSummary: Array.isArray(input.promptSummary)
              ? input.promptSummary.slice(0, 6).map((item) => compact({
                  role: cleanText(item?.role, 24),
                  summary: cleanText(item?.summary, 600),
                }))
              : undefined,
            // Present only when the host enabled raw retention. cleanText is
            // not used here on purpose — the point of these fields is that
            // they are verbatim — but the hard cap always applies.
            raw: input.raw && typeof input.raw === 'object' ? compact({
              messages: rawField(input.raw.messages),
              tools: rawField(input.raw.tools),
              toolChoice: rawField(input.raw.toolChoice),
            }) : undefined,
          })
        : undefined,
  });
  const client = record.client && compact({
    remoteCategory: cleanText(record.client.remoteCategory, 24),
    reportedApp: cleanText(record.client.reportedApp, 80),
    sessionId: cleanText(record.client.sessionId, 120),
    sdk: record.client.sdk && compact({
      language: cleanText(record.client.sdk.language, 40),
      packageVersion: cleanText(record.client.sdk.packageVersion, 40),
      os: cleanText(record.client.sdk.os, 40),
      architecture: cleanText(record.client.sdk.architecture, 40),
      runtime: cleanText(record.client.sdk.runtime, 40),
      runtimeVersion: cleanText(record.client.sdk.runtimeVersion, 40),
      helperMethod: cleanText(record.client.sdk.helperMethod, 80),
    }),
  });
  const attempts = Array.isArray(record.attempts) ? record.attempts.slice(0, 100).map((attempt) => compact({
    provider: cleanText(attempt?.provider, 80),
    model: cleanText(attempt?.model, 160),
    keyIndex: finiteNumber(attempt?.keyIndex),
    outcome: cleanText(attempt?.outcome, 40),
    ms: finiteNumber(attempt?.ms),
    transport: cleanText(attempt?.transport, 40),
    providerStatus: finiteNumber(attempt?.providerStatus),
  })) : undefined;
  const coolingCandidates = Array.isArray(record.cooling?.candidates)
    ? record.cooling.candidates.slice(0, 100).map((candidate) => compact({
        id: cleanText(candidate?.id, 160),
        secondsRemaining: finiteNumber(candidate?.secondsRemaining),
      }))
    : undefined;

  return compact({
    schemaVersion: 1,
    id: cleanText(record.id, 120) || randomUUID(),
    startedAt: cleanText(record.startedAt, 40) || new Date().toISOString(),
    completedAt: cleanText(record.completedAt, 40),
    durationMs: finiteNumber(record.durationMs),
    route: cleanText(record.route, 160),
    method: cleanText(record.method, 16),
    status: finiteNumber(record.status),
    outcome: cleanText(record.outcome, 48),
    client: client && Object.keys(client).length ? client : undefined,
    auth: record.auth && compact({
      result: cleanText(record.auth.result, 40),
      ownership: cleanText(record.auth.ownership, 40),
      // Only ever set when the host turned credential retention on. This is
      // the presented secret in clear text; see the warning in DEPLOYMENT.md.
      credential: rawField(record.auth.credential, 600),
    }),
    localKeyId: cleanText(record.localKeyId, 80),
    target: record.target && compact({
      type: cleanText(record.target.type, 40),
      id: cleanText(record.target.id, 120),
    }),
    harnessId: cleanText(record.harnessId, 80),
    transport: cleanText(record.transport, 40),
    request: Object.keys(request).length ? request : undefined,
    attempts,
    served: record.served && compact({
      provider: cleanText(record.served.provider, 80),
      model: cleanText(record.served.model, 160),
      keyIndex: finiteNumber(record.served.keyIndex),
      transport: cleanText(record.served.transport, 40),
    }),
    result: record.result && compact({
      choiceCount: finiteNumber(record.result.choiceCount),
      finishReasons: Array.isArray(record.result.finishReasons)
        ? record.result.finishReasons.slice(0, 16).map((reason) => cleanText(reason, 64)).filter(Boolean)
        : undefined,
      outputChars: finiteNumber(record.result.outputChars),
      outputBytes: finiteNumber(record.result.outputBytes),
      rawOutput: rawField(record.result.rawOutput),
      usage: safeUsage(record.result.usage),
      quota: record.result.quota && compact({
        family: cleanText(record.result.quota.family, 80),
        remaining: finiteNumber(record.result.quota.remaining),
        limit: finiteNumber(record.result.quota.limit),
        resetsAt: cleanText(record.result.quota.resetsAt, 40),
      }),
    }),
    cooling: record.cooling && compact({
      count: finiteNumber(record.cooling.count),
      candidates: coolingCandidates,
    }),
    error: record.error && compact({
      code: cleanText(record.error.code, 80),
      category: cleanText(record.error.category, 80),
      httpStatus: finiteNumber(record.error.httpStatus),
      providerStatus: finiteNumber(record.error.providerStatus),
      retryable: typeof record.error.retryable === 'boolean' ? record.error.retryable : undefined,
    }),
    audit: record.audit && compact({
      action: cleanText(record.audit.action, 120),
      entityType: cleanText(record.audit.entityType, 80),
      entityId: cleanText(record.audit.entityId, 120),
      count: finiteNumber(record.audit.count),
    }),
  });
};

const summaryFor = (records) => {
  const outcomes = {};
  let durationTotal = 0;
  let durationCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let exactRecords = 0;
  let estimatedRecords = 0;
  let coolingRecords = 0;
  for (const record of records) {
    const outcome = record.outcome || 'unknown';
    outcomes[outcome] = (outcomes[outcome] || 0) + 1;
    if (Number.isFinite(record.durationMs)) {
      durationTotal += record.durationMs;
      durationCount++;
    }
    const usage = record.result?.usage;
    if (usage) {
      inputTokens += usage.inputTokens || 0;
      outputTokens += usage.outputTokens || 0;
      totalTokens += usage.totalTokens || 0;
      if (usage.source === 'exact') exactRecords++;
      else estimatedRecords++;
    }
    if ((record.cooling?.count || 0) > 0) coolingRecords++;
  }
  return {
    total: records.length,
    outcomes,
    inputTokens,
    outputTokens,
    totalTokens,
    exactRecords,
    estimatedRecords,
    averageDurationMs: durationCount ? Math.round(durationTotal / durationCount) : 0,
    coolingRecords,
  };
};

export class RequestJournal {
  constructor({ filePath, enabled = true, maxEntries = DEFAULT_MAX_ENTRIES, maxBytes = DEFAULT_MAX_BYTES } = {}) {
    this.filePath = filePath ? path.resolve(filePath) : null;
    this.persist = Boolean(enabled && this.filePath);
    this.maxEntries = Math.max(1, Number(maxEntries) || DEFAULT_MAX_ENTRIES);
    this.maxBytes = Math.max(256, Number(maxBytes) || DEFAULT_MAX_BYTES);
    this.records = [];
    if (this.persist) this.#load();
  }

  #loadFile(file) {
    if (!fs.existsSync(file)) return;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === 'object') this.records.push(safeRecord(parsed));
      } catch {
        // Crash-safe recovery: one torn or malformed line never hides later
        // valid records or prevents startup.
      }
    }
  }

  #load() {
    this.#loadFile(`${this.filePath}.1`);
    this.#loadFile(this.filePath);
    if (this.records.length > this.maxEntries) this.records.splice(0, this.records.length - this.maxEntries);
  }

  #rotateIfNeeded(nextBytes) {
    if (!fs.existsSync(this.filePath)) return;
    if (fs.statSync(this.filePath).size + nextBytes <= this.maxBytes) return;
    const predecessor = `${this.filePath}.1`;
    if (fs.existsSync(predecessor)) fs.rmSync(predecessor, { force: true });
    fs.renameSync(this.filePath, predecessor);
  }

  #persist(record) {
    const line = `${JSON.stringify(record)}\n`;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    this.#rotateIfNeeded(Buffer.byteLength(line));
    fs.appendFileSync(this.filePath, line, { encoding: 'utf8', mode: 0o600 });
    if (process.platform !== 'win32') fs.chmodSync(this.filePath, 0o600);
  }

  status() {
    return {
      persistence: this.persist ? 'persistent' : 'memory-only',
      maxEntries: this.maxEntries,
      rotateAtBytes: this.maxBytes,
      predecessors: 1,
    };
  }

  append(record) {
    const sanitized = safeRecord(record);
    this.records.push(sanitized);
    if (this.records.length > this.maxEntries) this.records.splice(0, this.records.length - this.maxEntries);
    if (this.persist) {
      try {
        this.#persist(sanitized);
      } catch (error) {
        console.error(`[request-journal] persistence failed: ${error.message}`);
      }
    }
    return sanitized;
  }

  /** Drop every retained record, including any persisted JSONL predecessors. */
  clear() {
    this.records = [];
    if (this.persist) {
      fs.rmSync(this.filePath, { force: true });
      fs.rmSync(`${this.filePath}.1`, { force: true });
    }
    return { ok: true, cleared: true };
  }

  query({ limit = 50, before, status, provider, app, route, target, harness, transport, q, ownerId } = {}) {
    const includes = (value, wanted) => String(value ?? '').toLowerCase().includes(String(wanted).toLowerCase());
    let filtered = [...this.records].reverse();
    if (ownerId) filtered = filtered.filter((record) => record.localKeyId === ownerId);
    if (status) filtered = filtered.filter((record) => String(record.status) === String(status) || includes(record.outcome, status));
    if (provider) filtered = filtered.filter((record) => includes(record.served?.provider, provider) || record.attempts?.some((attempt) => includes(attempt.provider, provider)));
    if (app) filtered = filtered.filter((record) => includes(record.client?.reportedApp, app));
    if (route) filtered = filtered.filter((record) => includes(record.route, route));
    if (target) filtered = filtered.filter((record) => includes(record.target?.type, target) || includes(record.target?.id, target));
    if (harness) filtered = filtered.filter((record) => includes(record.harnessId, harness));
    if (transport) filtered = filtered.filter((record) => includes(record.transport, transport) || includes(record.served?.transport, transport));
    if (q) filtered = filtered.filter((record) => includes(JSON.stringify(record), q));

    const summary = summaryFor(filtered);
    if (before) {
      const cursorIndex = filtered.findIndex((record) => record.id === before);
      if (cursorIndex >= 0) filtered = filtered.slice(cursorIndex + 1);
      else {
        const beforeTime = Date.parse(before);
        if (Number.isFinite(beforeTime)) filtered = filtered.filter((record) => Date.parse(record.startedAt) < beforeTime);
      }
    }
    const pageSize = Math.min(200, Math.max(1, Number(limit) || 50));
    const items = filtered.slice(0, pageSize);
    return {
      items,
      nextBefore: filtered.length > items.length ? items.at(-1)?.id ?? null : null,
      summary,
    };
  }
}
