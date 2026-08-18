// OpenAI-compatible HTTP surface with subscription-provider transforms,
// quota tracking, and harness configuration injection.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolveKeys } from './config.js';
import { Cooldowns, dispatch, ChainError } from './chain.js';
import { IS_SEA, EXE_DIR } from './runtime.js';
import { transformResponse, transformStreamChunk } from './transforms.js';
import {
  TEXT_COMPONENTS,
  applyHarnessConfig,
  createHarness,
  harnessById,
  loadHarness,
  loadHarnessLibrary,
  removeHarness,
  saveHarness,
  saveHarnessLibrary,
  updateHarness,
} from './harness.js';
import { listPresetEntries, readPresetEntry } from './presets.js';
import {
  bearerFrom,
  addChain,
  addChainLink,
  addLocalKey,
  removeChainLink,
  removeLocalKey,
  reorderRoutingChain,
  routingInventory,
  updateLocalKey,
} from './admin.js';
import { shortcutStatus, createShortcut, dismissShortcut } from './shortcut.js';
import { authenticateLocalKey, rotateLocalKey, scopeForLocalKey, tokenForLocalKey } from './routing.js';
import { usageFromPayload } from './quota.js';
import { providerDef } from './providers.js';
import {
  RequestJournal,
  createSseMeter,
  estimatedUsage,
  requestMetadata,
  summarizeInput,
  summarizeJsonOutput,
} from './request-journal.js';
import { createSubChainOperator } from './operator-subchain.js';
import { createOperatorHttp } from './operator-http.js';

const WEBUI_DIR = IS_SEA
  ? path.join(EXE_DIR, 'webui')
  : path.join(path.dirname(fileURLToPath(import.meta.url)), 'webui');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const PASSIVE_JOURNAL_ROUTES = new Set(['/v1/logs', '/v1/status', '/admin/logs']);

function adminAuditFor(method, pathname) {
  const exact = new Map([
    ['GET /admin/access-key', ['local-key-revealed', 'local-key', 'default']],
    ['POST /admin/access-key/rotate', ['local-key-rotated', 'local-key', 'default']],
    ['POST /admin/local-keys', ['local-key-created', 'local-key']],
    ['POST /admin/chains', ['chain-created', 'chain']],
    ['POST /admin/chain/reorder', ['chain-reordered', 'chain']],
    ['POST /admin/mode', ['routing-mode-updated', 'routing']],
    ['POST /admin/threshold', ['quota-threshold-updated', 'quota']],
    ['POST /admin/harnesses', ['harness-created', 'harness']],
    ['POST /admin/harness/preset', ['harness-preset-applied', 'harness']],
    ['POST /admin/harness', ['default-harness-updated', 'harness', 'default']],
    ['POST /admin/providers/openai-codex/connect', ['subscription-connect-started', 'provider', 'openai-codex']],
    ['POST /admin/providers/openai-codex/connect/cancel', ['subscription-connect-cancelled', 'provider', 'openai-codex']],
    ['POST /admin/shortcut/create', ['shortcut-created', 'shortcut']],
    ['POST /admin/shortcut/dismiss', ['shortcut-dismissed', 'shortcut']],
  ]).get(`${method} ${pathname}`);
  if (exact) return { action: exact[0], entityType: exact[1], entityId: exact[2] };
  const patterns = [
    [/^GET \/admin\/local-keys\/([a-z0-9-]+)$/, 'local-key-revealed', 'local-key'],
    [/^POST \/admin\/local-keys\/([a-z0-9-]+)$/, 'local-key-updated', 'local-key'],
    [/^DELETE \/admin\/local-keys\/([a-z0-9-]+)$/, 'local-key-deleted', 'local-key'],
    [/^POST \/admin\/local-keys\/([a-z0-9-]+)\/rotate$/, 'local-key-rotated', 'local-key'],
    [/^POST \/admin\/chains\/([a-z0-9-]+)\/links$/, 'chain-link-added', 'chain'],
    [/^DELETE \/admin\/chains\/([a-z0-9-]+)\/links\/\d+$/, 'chain-link-deleted', 'chain'],
    [/^POST \/admin\/harnesses\/([a-z0-9-]+)$/, 'harness-updated', 'harness'],
    [/^DELETE \/admin\/harnesses\/([a-z0-9-]+)$/, 'harness-deleted', 'harness'],
    [/^POST \/admin\/providers\/([a-z0-9-]+)\/ping$/, 'provider-pinged', 'provider'],
    [/^POST \/admin\/providers\/([a-z0-9-]+)$/, 'provider-renamed', 'provider'],
  ];
  const route = `${method} ${pathname}`;
  for (const [pattern, action, entityType] of patterns) {
    const match = pattern.exec(route);
    if (match) return { action, entityType, entityId: match[1] };
  }
  return null;
}

const queryOptions = (url, ownerId) => ({
  limit: url.searchParams.get('limit') || undefined,
  before: url.searchParams.get('before') || undefined,
  status: url.searchParams.get('status') || undefined,
  provider: url.searchParams.get('provider') || undefined,
  app: url.searchParams.get('app') || undefined,
  route: url.searchParams.get('route') || undefined,
  target: url.searchParams.get('target') || undefined,
  harness: url.searchParams.get('harness') || undefined,
  transport: url.searchParams.get('transport') || undefined,
  q: url.searchParams.get('q') || undefined,
  ownerId,
});

const json = (res, code, obj, { cors = false } = {}) => {
  const body = JSON.stringify(obj);
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  };
  if (cors) headers['Access-Control-Allow-Origin'] = '*';
  res.writeHead(code, headers);
  res.end(body);
};

const fail = (res, code, message, extra = {}, { cors = false } = {}) =>
  json(res, code, { error: { message, type: 'subchain_error', ...extra } }, { cors });

const managedLoginSnapshot = ({ status, verificationUrl, userCode, expiresAt, message } = {}) => {
  const snapshot = { status: String(status || 'idle') };
  if (typeof verificationUrl === 'string') snapshot.verificationUrl = verificationUrl;
  if (typeof userCode === 'string') snapshot.userCode = userCode;
  if (Number.isFinite(expiresAt)) snapshot.expiresAt = expiresAt;
  if (typeof message === 'string') snapshot.message = message;
  return snapshot;
};

function readJson(req, limitBytes = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(Object.assign(new Error('request body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(Object.assign(new Error(`invalid JSON body: ${err.message}`), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

const WEBUI_DIR_PREFIX = WEBUI_DIR + path.sep;

/** Administrative endpoints may expose or rotate a local token, so they are never network-facing. */
export function isLoopbackAddress(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function serveStatic(res, pathname) {
  const rel = pathname === '/' || pathname === '' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(WEBUI_DIR, rel);
  if (
    (file !== WEBUI_DIR && !file.startsWith(WEBUI_DIR_PREFIX)) ||
    !fs.existsSync(file) ||
    !fs.statSync(file).isFile()
  ) {
    return false;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
  });
  res.end(fs.readFileSync(file));
  return true;
}

export function createServer(runtime, quota, {
  verbose = false,
  ui = true,
  harnessFile,
  providerStatusStore = null,
  providerProbeService = null,
  managedTransports = null,
  managedProviderAvailable = () => false,
  journal = new RequestJournal({ enabled: false }),
} = {}) {
  const cooldowns = new Cooldowns(runtime.settings.cooldownMs);
  const stats = { served: 0, failed: 0, startedAt: Date.now() };
  const managedAvailable = (providerId) => managedProviderAvailable(providerId)
    || Boolean(managedTransports?.has(providerDef(providerId).transport));
  const inventory = () => routingInventory(runtime, quota, {
    statusStore: providerStatusStore,
    providerProbeService,
    managedProviderAvailable: managedAvailable,
  });
  const scopeFor = (localKey) => {
    const providerModels = localKey.target.type === 'provider'
      ? providerStatusStore?.get(localKey.target.id)?.models
      : null;
    return { ...scopeForLocalKey(runtime.routing, localKey, providerModels), settings: runtime.settings };
  };

  // The operator's own reasoning runs through SubChain's default local key, so
  // control-plane traffic obeys the same routing, quota and cooldown rules as
  // any other client instead of holding a privileged provider path.
  const selfComplete = async (messages, signal) => {
    const localKey = runtime.routing.localKeys.find((key) => key.id === 'default') || runtime.routing.localKeys[0];
    if (!localKey) {
      throw Object.assign(new Error('No local routing key is available for self intelligence.'), { statusCode: 409 });
    }
    const scope = { ...scopeFor(localKey), harnessHeaders: {} };
    const result = await dispatch(scope, cooldowns, quota, {
      model: 'auto',
      messages,
      stream: false,
      max_tokens: 2200,
    }, { signal, managedTransports });
    const raw = await result.response.text();
    const payloadText = result.link.transform ? transformResponse(raw, result.link) : raw;
    const payload = JSON.parse(payloadText);
    return payload?.choices?.[0]?.message?.content || JSON.stringify(payload);
  };
  const operator = createSubChainOperator({
    runtime,
    quota,
    journal,
    statusStore: providerStatusStore,
    probeService: providerProbeService,
    managedTransports,
    managedAvailable,
    selfComplete,
  });
  const handleOperator = createOperatorHttp(operator);

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const audit = adminAuditFor(req.method, url.pathname);
    const shouldJournal = req.method !== 'OPTIONS' && (
      (url.pathname.startsWith('/v1/') && !PASSIVE_JOURNAL_ROUTES.has(url.pathname)) ||
      Boolean(audit)
    );
    const startedMs = Date.now();
    const journalRecord = shouldJournal ? {
      id: randomUUID(),
      startedAt: new Date(startedMs).toISOString(),
      route: url.pathname,
      method: req.method,
      client: requestMetadata(req),
      ...(audit ? { audit } : {}),
    } : null;
    let journalFinalized = false;
    const finalizeJournal = (overrides = {}) => {
      if (!journalRecord || journalFinalized) return;
      journalFinalized = true;
      const status = overrides.status ?? res.statusCode ?? 500;
      journal.append({
        ...journalRecord,
        ...overrides,
        status,
        outcome: overrides.outcome ?? journalRecord.outcome ?? (status >= 500 ? 'failed' : status >= 400 ? 'rejected' : 'served'),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedMs,
      });
    };
    if (journalRecord) {
      res.setHeader('X-SubChain-Request-Id', journalRecord.id);
      res.once('finish', () => finalizeJournal());
      res.once('close', () => {
        if (!res.writableEnded) finalizeJournal({ status: 499, outcome: 'client-disconnected' });
      });
    }

    if (req.method === 'OPTIONS' && !url.pathname.startsWith('/admin/')) {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers':
          'Content-Type, Authorization, X-SubChain-App, X-SubChain-Session-Id, X-Stainless-Lang, X-Stainless-Package-Version, X-Stainless-OS, X-Stainless-Arch, X-Stainless-Runtime, X-Stainless-Runtime-Version, X-Stainless-Retry-Count, X-Stainless-Timeout, X-Stainless-Helper-Method',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      });
      return res.end();
    }

    if (url.pathname === '/healthz' || url.pathname === '/v1/status') {
      const state = inventory();
      return json(res, 200, {
        ok: state.providers.some((provider) => provider.hasCredential),
        links: state.chains.flatMap((chain) => chain.links.map((link) => ({ ...link, chainId: chain.id }))),
        cooling: cooldowns.snapshot(),
        quota: quota.snapshot(),
        settings: runtime.settings,
        stats: { ...stats, uptimeSeconds: Math.round((Date.now() - stats.startedAt) / 1000) },
      }, { cors: true });
    }

    // ── Admin API ────────────────────────────────────────────────────
    if (ui && url.pathname.startsWith('/admin/')) {
      res.setHeader('Cache-Control', 'no-store');
      try {
        if (!isLoopbackAddress(req.socket.remoteAddress)) {
          return fail(res, 403, 'Administrative routes are available only from the local machine');
        }
        const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && fetchSite && !['same-origin', 'none'].includes(fetchSite)) {
          return fail(res, 403, 'Cross-site administrative mutations are not allowed');
        }
        if (['POST', 'PUT', 'PATCH'].includes(req.method)
          && !/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) {
          return fail(res, 415, 'Administrative mutations require application/json');
        }
        // Confirmation-gated control plane. It reuses the loopback, cross-site
        // and content-type gates already enforced for this whole admin block.
        if (url.pathname.startsWith('/admin/operator/')) {
          if (await handleOperator(req, res, url)) return;
        }
        if (url.pathname === '/admin/logs' && req.method === 'GET') {
          const page = journal.query(queryOptions(url, url.searchParams.get('localKey') || undefined));
          const names = new Map(runtime.routing.localKeys.map((key) => [key.id, key.name]));
          return json(res, 200, {
            ...page,
            items: page.items.map((record) => record.localKeyId
              ? { ...record, localKeyName: names.get(record.localKeyId) || record.localKeyId }
              : record),
          });
        }
        if (url.pathname === '/admin/state' && req.method === 'GET') {
          const harnessLibrary = loadHarnessLibrary(harnessFile);
          return json(res, 200, {
            ...inventory(),
            cooling: cooldowns.snapshot(),
            quota: quota.snapshot(),
            journal: journal.status(),
            harness: loadHarness(harnessFile),
            harnesses: harnessLibrary.harnesses,
            stats: { ...stats, uptimeSeconds: Math.round((Date.now() - stats.startedAt) / 1000) },
          });
        }
        if (url.pathname === '/admin/access-key' && req.method === 'GET') {
          const defaultKey = runtime.routing.localKeys.find((key) => key.id === 'default');
          return json(res, 200, { key: defaultKey ? tokenForLocalKey(runtime, defaultKey) : null });
        }
        if (url.pathname === '/admin/access-key/rotate' && req.method === 'POST') {
          return json(res, 200, { key: rotateLocalKey(runtime, 'default') });
        }
        if (url.pathname === '/admin/providers/openai-codex/connect'
          && ['GET', 'POST'].includes(req.method)) {
          if (!managedTransports) return fail(res, 503, 'Managed provider client is unavailable');
          const snapshot = req.method === 'POST'
            ? await managedTransports.startLogin('codex-app-server')
            : managedTransports.loginStatus('codex-app-server');
          return json(res, 200, managedLoginSnapshot(snapshot));
        }
        if (url.pathname === '/admin/providers/openai-codex/connect/cancel' && req.method === 'POST') {
          if (!managedTransports) return fail(res, 503, 'Managed provider client is unavailable');
          return json(res, 200, managedLoginSnapshot(await managedTransports.cancelLogin('codex-app-server')));
        }
        const providerPingMatch = /^\/admin\/providers\/([a-z0-9-]+)\/ping$/.exec(url.pathname);
        if (providerPingMatch && req.method === 'POST') {
          if (!providerProbeService) return fail(res, 503, 'Provider Ping service is unavailable');
          const result = await providerProbeService.ping(providerPingMatch[1]);
          return json(res, 200, {
            ok: true,
            account: providerStatusStore?.get(providerPingMatch[1]) || result,
          });
        }
        const providerMatch = /^\/admin\/providers\/([a-z0-9-]+)$/.exec(url.pathname);
        if (providerMatch && req.method === 'POST') {
          if (!providerStatusStore) return fail(res, 503, 'Provider account store is unavailable');
          const { name } = await readJson(req);
          return json(res, 200, { account: providerStatusStore.rename(providerMatch[1], name) });
        }
        if (url.pathname === '/admin/local-keys' && req.method === 'POST') {
          const { id, name, target, harnessId } = await readJson(req);
          if (harnessId && !loadHarnessLibrary(harnessFile).harnesses.some((harness) => harness.id === harnessId)) {
            return fail(res, 400, 'Unknown Harness');
          }
          const created = addLocalKey(runtime, { id, name, target, harnessId });
          if (journalRecord) journalRecord.audit.entityId = created.key.id;
          const { secretRef, ...localKey } = created.key;
          return json(res, 201, { localKey, key: created.token });
        }
        const keyMatch = /^\/admin\/local-keys\/([a-z0-9-]+)$/.exec(url.pathname);
        if (keyMatch && req.method === 'GET') {
          const key = runtime.routing.localKeys.find((candidate) => candidate.id === keyMatch[1]);
          if (!key) return fail(res, 404, 'Unknown local key');
          return json(res, 200, { key: tokenForLocalKey(runtime, key) });
        }
        if (keyMatch && req.method === 'POST') {
          const update = await readJson(req);
          if (update.harnessId && !loadHarnessLibrary(harnessFile).harnesses.some((harness) => harness.id === update.harnessId)) {
            return fail(res, 400, 'Unknown Harness');
          }
          const { secretRef, ...localKey } = updateLocalKey(runtime, keyMatch[1], update);
          return json(res, 200, { localKey });
        }
        if (keyMatch && req.method === 'DELETE') {
          removeLocalKey(runtime, keyMatch[1]);
          return json(res, 200, { ok: true });
        }
        const rotateMatch = /^\/admin\/local-keys\/([a-z0-9-]+)\/rotate$/.exec(url.pathname);
        if (rotateMatch && req.method === 'POST') {
          return json(res, 200, { key: rotateLocalKey(runtime, rotateMatch[1]) });
        }
        if (url.pathname === '/admin/chains' && req.method === 'POST') {
          const { id, name, link } = await readJson(req);
          const created = addChain(runtime, { id, name, link });
          if (journalRecord) journalRecord.audit.entityId = created.id;
          return json(res, 201, { chain: created });
        }
        const linkMatch = /^\/admin\/chains\/([a-z0-9-]+)\/links$/.exec(url.pathname);
        if (linkMatch && req.method === 'POST') {
          const link = await readJson(req);
          return json(res, 201, { link: addChainLink(runtime, linkMatch[1], link) });
        }
        const linkDeleteMatch = /^\/admin\/chains\/([a-z0-9-]+)\/links\/(\d+)$/.exec(url.pathname);
        if (linkDeleteMatch && req.method === 'DELETE') {
          removeChainLink(runtime, linkDeleteMatch[1], Number(linkDeleteMatch[2]));
          return json(res, 200, { ok: true });
        }
        if (url.pathname === '/admin/chain/reorder' && req.method === 'POST') {
          const { chainId = 'default', order } = await readJson(req);
          if (!Array.isArray(order)) return fail(res, 400, 'order[] is required');
          reorderRoutingChain(runtime, chainId, order);
          const chain = runtime.routing.chains.find((candidate) => candidate.id === chainId);
          return json(res, 200, { ok: true, count: chain.links.length });
        }
        if (url.pathname === '/admin/mode' && req.method === 'POST') {
          const { mode, pinnedProvider } = await readJson(req);
          if (mode !== 'chain' && mode !== 'pinned') return fail(res, 400, 'mode must be "chain" or "pinned"');
          runtime.settings.mode = mode;
          if (pinnedProvider !== undefined) runtime.settings.pinnedProvider = pinnedProvider;
          return json(res, 200, { ok: true, mode: runtime.settings.mode, pinnedProvider: runtime.settings.pinnedProvider });
        }
        if (url.pathname === '/admin/threshold' && req.method === 'POST') {
          const { global, perProvider } = await readJson(req);
          if (global !== undefined) runtime.settings.fallbackThresholdPercent = Number(global);
          if (perProvider) runtime.settings.providerThresholds = { ...runtime.settings.providerThresholds, ...perProvider };
          return json(res, 200, { ok: true, fallbackThresholdPercent: runtime.settings.fallbackThresholdPercent });
        }
        if (url.pathname === '/admin/harness' && req.method === 'GET') {
          return json(res, 200, loadHarness(harnessFile));
        }
        if (url.pathname === '/admin/harnesses' && req.method === 'GET') {
          return json(res, 200, loadHarnessLibrary(harnessFile));
        }
        if (url.pathname === '/admin/harnesses' && req.method === 'POST') {
          const input = await readJson(req);
          const library = loadHarnessLibrary(harnessFile);
          const harness = createHarness(library, input);
          if (journalRecord) journalRecord.audit.entityId = harness.id;
          saveHarnessLibrary(library, harnessFile);
          return json(res, 201, { harness });
        }
        const harnessMatch = /^\/admin\/harnesses\/([a-z0-9-]+)$/.exec(url.pathname);
        if (harnessMatch && req.method === 'POST') {
          const library = loadHarnessLibrary(harnessFile);
          const harness = updateHarness(library, harnessMatch[1], await readJson(req));
          saveHarnessLibrary(library, harnessFile);
          return json(res, 200, { harness });
        }
        if (harnessMatch && req.method === 'DELETE') {
          if (runtime.routing.localKeys.some((key) => key.harnessId === harnessMatch[1])) {
            return fail(res, 409, 'Harness is assigned to a local key');
          }
          const library = loadHarnessLibrary(harnessFile);
          removeHarness(library, harnessMatch[1]);
          saveHarnessLibrary(library, harnessFile);
          return json(res, 200, { ok: true });
        }
        if (url.pathname === '/admin/presets' && req.method === 'GET') {
          return json(res, 200, listPresetEntries({
            dataDir: runtime.presetDataDir,
            source: url.searchParams.get('source'),
            component: url.searchParams.get('component'),
            query: url.searchParams.get('query') || '',
            offset: url.searchParams.get('offset') || 0,
            limit: url.searchParams.get('limit') || 50,
          }));
        }
        if (url.pathname === '/admin/presets/read' && req.method === 'GET') {
          return json(res, 200, readPresetEntry({ dataDir: runtime.presetDataDir, id: url.searchParams.get('id') }));
        }
        if (url.pathname === '/admin/harness/preset' && req.method === 'POST') {
          const { harnessId = 'default', id, target = 'operatingInstructions', mode = 'replace' } = await readJson(req);
          if (journalRecord) journalRecord.audit.entityId = harnessId;
          if (!TEXT_COMPONENTS.includes(target)) return fail(res, 400, 'Preset target is invalid');
          if (!['replace', 'append'].includes(mode)) return fail(res, 400, 'Preset mode is invalid');
          const preset = readPresetEntry({ dataDir: runtime.presetDataDir, id });
          const library = loadHarnessLibrary(harnessFile);
          const selected = library.harnesses.find((harness) => harness.id === harnessId);
          if (!selected) return fail(res, 404, 'Unknown Harness');
          const current = typeof selected.components?.[target] === 'string' ? selected.components[target].trim() : '';
          const value = mode === 'append' && current ? `${current}\n\n${preset.content}` : preset.content;
          const updated = updateHarness(library, harnessId, { components: { [target]: value } });
          saveHarnessLibrary(library, harnessFile);
          return json(res, 200, {
            ok: true,
            harness: { ...updated, systemPrompts: updated.components },
            preset: { id: preset.id, title: preset.title, source: preset.source },
          });
        }
        if (url.pathname === '/admin/harness' && req.method === 'POST') {
          const config = await readJson(req);
          saveHarness(config, harnessFile);
          return json(res, 200, { ok: true });
        }
        if (url.pathname === '/admin/quota' && req.method === 'GET') {
          return json(res, 200, { quota: quota.snapshot() });
        }
        if (url.pathname === '/admin/shortcut' && req.method === 'GET') {
          return json(res, 200, shortcutStatus());
        }
        if (url.pathname === '/admin/shortcut/create' && req.method === 'POST') {
          return json(res, 200, createShortcut());
        }
        if (url.pathname === '/admin/shortcut/dismiss' && req.method === 'POST') {
          return json(res, 200, dismissShortcut());
        }
      } catch (err) {
        const code = err.statusCode || 500;
        if (journalRecord) journalRecord.error = {
          code: code >= 500 ? 'internal_error' : 'invalid_admin_request',
          category: code >= 500 ? 'internal' : 'request',
          httpStatus: code,
          retryable: code >= 500,
        };
        return fail(res, code, code >= 500 ? 'Internal server error' : String(err.message || err));
      }
      return fail(res, 404, `No admin route for ${req.method} ${url.pathname}`);
    }

    if (url.pathname === '/v1/logs' && req.method === 'GET') {
      const localKey = authenticateLocalKey(runtime, bearerFrom(req));
      if (!localKey) {
        return fail(res, 401, 'Invalid API key. Use the access key from the SubChain dashboard.', {
          code: 'invalid_api_key',
        }, { cors: true });
      }
      res.setHeader('Cache-Control', 'no-store');
      return json(res, 200, journal.query(queryOptions(url, localKey.id)), { cors: true });
    }

    if (url.pathname === '/v1/models') {
      const localKey = authenticateLocalKey(runtime, bearerFrom(req));
      if (!localKey) {
        journalRecord.auth = { result: 'rejected', ownership: 'subchain-local-key' };
        journalRecord.request = { inputSummary: 'unavailable-before-auth' };
        journalRecord.error = { code: 'invalid_api_key', category: 'authentication', httpStatus: 401, retryable: false };
        journalRecord.outcome = 'auth-rejected';
        return fail(res, 401, 'Invalid API key. Use the access key from the SubChain dashboard.', {
          code: 'invalid_api_key',
        }, { cors: true });
      }
      journalRecord.auth = { result: 'accepted', ownership: 'subchain-local-key' };
      journalRecord.localKeyId = localKey.id;
      journalRecord.target = localKey.target;
      journalRecord.harnessId = localKey.harnessId || 'default';
      const scope = scopeFor(localKey);
      const seen = new Set();
      const data = [{ id: 'auto', object: 'model', owned_by: 'subchain' }];
      for (const l of scope.links) {
        if (seen.has(l.model)) continue;
        seen.add(l.model);
        const managed = l.transport !== 'http' && managedAvailable(l.provider);
        const keyCount = managed ? 1 : resolveKeys(l.provider).length;
        data.push({
          id: l.model,
          object: 'model',
          owned_by: l.provider,
          subchain: { keyCount, hasKey: keyCount > 0, managed },
        });
      }
      return json(res, 200, { object: 'list', data }, { cors: true });
    }

    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
      // Read once per request so input, output and auth capture all agree on
      // the same policy even if the host flips a switch mid-flight.
      const logPolicy = operator.runtime.readSettings().logs;
      // Retained only on request: the most common reason to want it is a
      // rejected key, where the useful question is what the caller actually
      // presented rather than what it should have presented.
      const presentedCredential = logPolicy.credentials === true
        ? String(req.headers.authorization || '').slice(0, 600) || undefined
        : undefined;
      const localKey = authenticateLocalKey(runtime, bearerFrom(req));
      if (!localKey) {
        journalRecord.auth = { result: 'rejected', ownership: 'subchain-local-key', credential: presentedCredential };
        journalRecord.request = { inputSummary: 'unavailable-before-auth' };
        journalRecord.error = { code: 'invalid_api_key', category: 'authentication', httpStatus: 401, retryable: false };
        journalRecord.outcome = 'auth-rejected';
        return fail(res, 401, 'Invalid API key. Use the access key from the SubChain dashboard.', {
          code: 'invalid_api_key',
        }, { cors: true });
      }
      journalRecord.auth = { result: 'accepted', ownership: 'subchain-local-key', credential: presentedCredential };
      journalRecord.localKeyId = localKey.id;
      journalRecord.target = localKey.target;
      journalRecord.harnessId = localKey.harnessId || 'default';
      let body;
      try {
        body = await readJson(req);
      } catch (err) {
        journalRecord.error = { code: 'invalid_request', category: 'request', httpStatus: err.statusCode || 400, retryable: false };
        return fail(res, err.statusCode || 400, err.message, {}, { cors: true });
      }
      if (!Array.isArray(body.messages) || !body.messages.length) {
        journalRecord.request = { model: body.model, stream: body.stream === true, inputSummary: summarizeInput(body, logPolicy) };
        journalRecord.error = { code: 'invalid_messages', category: 'request', httpStatus: 400, retryable: false };
        return fail(res, 400, '"messages" must be a non-empty array', {}, { cors: true });
      }

      // Apply harness defaults (aliases, generation params, stream preference)
      const harnessLibrary = loadHarnessLibrary(harnessFile);
      const selectedHarness = harnessById(harnessLibrary, localKey.harnessId);
      body = applyHarnessConfig(body, selectedHarness);
      const inputSummary = summarizeInput(body, logPolicy);
      journalRecord.request = { model: inputSummary.model, stream: inputSummary.stream, inputSummary };
      const scope = { ...scopeFor(localKey), harnessHeaders: selectedHarness.components.headers };

      const abort = new AbortController();
      req.on('close', () => {
        if (!res.writableEnded) abort.abort();
      });

      try {
        const { response, link, provider, keyIndex, attempts } = await dispatch(scope, cooldowns, quota, body, {
          signal: abort.signal,
          managedTransports,
          onAttempt: (a) => {
            if (verbose || a.outcome !== 'ok') {
              console.log(
                `[subchain] ${a.provider}/${a.model} key#${a.keyIndex} ${a.outcome} (${a.ms}ms) ${a.detail ?? ''}`.trim()
              );
            }
          },
        });
        journalRecord.attempts = attempts;
        journalRecord.served = { provider, model: link.model, keyIndex, transport: link.transport };
        journalRecord.transport = link.transport;
        const cooling = cooldowns.snapshot();
        journalRecord.cooling = {
          count: cooling.length,
          candidates: cooling.map(({ id, secondsRemaining }) => ({ id, secondsRemaining })),
        };

        const served = {
          'X-SubChain-Provider': provider,
          'X-SubChain-Model': link.model,
          'X-SubChain-Key-Index': String(keyIndex),
          'X-SubChain-Attempts': String(attempts.length),
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers':
            'X-SubChain-Provider, X-SubChain-Model, X-SubChain-Key-Index, X-SubChain-Attempts, X-SubChain-Request-Id',
        };

        stats.served++;
        if (body.stream) {
          const meter = createSseMeter(logPolicy);
          res.writeHead(200, {
            ...served,
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });

          if (link.transform) {
            // Transform-aware streaming: convert chunks line by line
            const decoder = new TextDecoder();
            for await (const chunk of response.body) {
              const text = decoder.decode(chunk, { stream: true });
              const transformed = transformStreamChunk(text, link);
              if (transformed) {
                meter.push(Buffer.from(transformed));
                if (!res.write(transformed)) await new Promise((r) => res.once('drain', r));
              }
            }
          } else {
            for await (const chunk of response.body) {
              meter.push(chunk);
              if (!res.write(chunk)) await new Promise((r) => res.once('drain', r));
            }
          }
          journalRecord.result = meter.finish(inputSummary.inputChars);
          return res.end();
        }

        const rawPayload = await response.text();
        const payload = link.transform ? transformResponse(rawPayload, link) : rawPayload;
        const usage = usageFromPayload(payload);
        if (usage) {
          quota.recordUsage(provider, usage);
          providerStatusStore?.recordUsage(provider, usage);
        }
        const outputSummary = summarizeJsonOutput(payload, logPolicy);
        const quotaState = quota.get(provider)?.quotas?.[0];
        journalRecord.result = {
          ...outputSummary,
          usage: usage ? {
            inputTokens: usage.prompt_tokens,
            outputTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
            source: 'exact',
          } : estimatedUsage(inputSummary.inputChars, outputSummary.outputChars),
          quota: quotaState ? {
            family: quotaState.id,
            remaining: quotaState.remaining,
            limit: quotaState.limit,
            resetsAt: quotaState.resetsAt ? new Date(quotaState.resetsAt).toISOString() : undefined,
          } : undefined,
        };
        res.writeHead(200, {
          ...served,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        });
        return res.end(payload);
      } catch (err) {
        if (abort.signal.aborted) return;
        stats.failed++;
        if (err instanceof ChainError) {
          journalRecord.attempts = err.attempts;
          const providerStatus = Number.parseInt(String(err.attempts.at(-1)?.detail || ''), 10);
          const cooling = cooldowns.snapshot();
          journalRecord.cooling = {
            count: cooling.length,
            candidates: cooling.map(({ id, secondsRemaining }) => ({ id, secondsRemaining })),
          };
          journalRecord.error = {
            code: 'chain_failed',
            category: 'provider',
            httpStatus: 502,
            providerStatus: Number.isFinite(providerStatus) ? providerStatus : undefined,
            retryable: true,
          };
          return fail(res, 502, err.message, { attempts: err.attempts }, { cors: true });
        }
        console.error('[subchain] unexpected error:', err);
        journalRecord.error = { code: 'internal_error', category: 'internal', httpStatus: 500, retryable: true };
        return fail(res, 500, 'Internal server error', {}, { cors: true });
      }
    }

    if (ui && isLoopbackAddress(req.socket.remoteAddress) && req.method === 'GET' && serveStatic(res, url.pathname)) return;

    return fail(res, 404, `No route for ${req.method} ${url.pathname}`);
  });
}
