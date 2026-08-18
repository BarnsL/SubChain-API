// SubChain-specific host for the shared confirmation-gated control plane.
//
// SubChain specializes in subscription/OAuth lanes, quota-aware routing,
// managed transports, Harnesses, local keys, and ordinary compatible APIs.
// The operator reads only sanitized state: the privacy-safe RequestJournal
// records, the routing inventory, and provider metadata. Credentials, OAuth
// tokens, prompt bodies and completions never reach the model.

import fs from 'node:fs';
import path from 'node:path';
import { ChainOperatorRuntime, operatorSystemPrompt } from './operator-runtime.js';
import { FAMILIES, providerDef } from './providers.js';
import { ROOT } from './config.js';
import { resolveCredential } from './auth.js';
import {
  routingInventory,
  addChain,
  updateChain,
  removeChain,
  addChainLink,
  removeChainLink,
  reorderRoutingChain,
  updateChainLink,
} from './admin.js';
import { analyzeSanitizedRecords } from './operator-security.js';
import { applyMinorRepair } from './operator-repair.js';

/** Confirmed mutations the server is willing to execute. Nothing else runs. */
const ALLOWED_TOOLS = [
  'set_ui', 'set_port',
  'add_chain', 'update_chain', 'remove_chain',
  'add_chain_link', 'update_chain_link', 'remove_chain_link', 'move_chain_link',
  'set_mode', 'set_threshold',
  'start_managed_login', 'import_detected_credential', 'probe_provider',
  'set_log_policy',
  'minor_code_replace', 'clear_logs',
];

/**
 * Retention switches the model may never propose, even with a human confirming.
 *
 * The system prompt already tells the model not to propose raw retention, but
 * instruction is not enforcement. A confirmation dialog summarised as "adjust
 * log policy" must not be able to quietly start writing prompts, responses or
 * bearer tokens to disk — the human has to reach for those switches on the
 * Settings tab themselves, where the warnings are.
 */
export const HUMAN_ONLY_LOG_FLAGS = ['rawPrompts', 'rawResponses', 'rawToolBodies', 'credentials'];

export function stripHumanOnlyLogFlags(args = {}) {
  const out = { ...args };
  for (const flag of HUMAN_ONLY_LOG_FLAGS) delete out[flag];
  return out;
}

/** Files a confirmed minor repair may touch. Never auth, routing or transport. */
const REPAIR_ALLOWLIST = [
  'src/webui/app.css',
  'src/webui/app.js',
  'src/webui/index.html',
  'src/webui/operator.css',
  'src/webui/operator.js',
];

const familyOf = (id) => String(id).replace(/\d+$/, '');

function writeEnv(name, value) {
  const file = path.join(ROOT, '.env');
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : [];
  let found = false;
  const next = lines.map((line) => line.startsWith(`${name}=`) ? (found = true, `${name}=${value}`) : line);
  if (!found) next.push(`${name}=${value}`);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${next.filter(Boolean).join('\n')}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  process.env[name] = String(value);
}

/**
 * Provider setup guidance. This reports only whether a credential source was
 * detected and where the official setup page lives; it never returns the value.
 */
function providerHelp(statusStore, managedAvailable) {
  return FAMILIES.map((id) => {
    const def = providerDef(id);
    const credential = def.transport === 'http' ? resolveCredential(id) : null;
    const status = statusStore?.get?.(id);
    const managedReady = def.transport !== 'http' && status?.health === 'ready';
    const notes = id === 'dario'
      ? 'Dario owns its Claude subscription, OAuth and wire fidelity. SubChain talks only to its local OpenAI-compatible interface.'
      : id === 'google'
        ? 'Google Gemini authentication is transitioning to auth keys; use AI Studio and keep the credential outside chat.'
        : undefined;
    return {
      provider: id,
      label: def.label,
      authType: def.authType,
      transport: def.transport,
      found: Boolean(credential) || managedReady || def.keyOptional === true,
      sources: credential?.source
        ? [credential.source]
        : managedReady
          ? ['managed-client']
          : def.keyOptional
            ? ['no-key-required']
            : [],
      url: def.subscriptionUrl || null,
      managedAvailable: def.transport !== 'http' && managedAvailable(id),
      notes,
    };
  });
}

function doctor(runtime, quota, journal, statusStore, managedAvailable) {
  const inventory = routingInventory(runtime, quota, { statusStore, managedProviderAvailable: managedAvailable });
  const recent = journal.query({ limit: 100 }).items;
  const failed = recent.filter((record) => Number(record.status) >= 500).length;
  const usable = inventory.providers.filter((provider) => provider.hasCredential).length;
  const dario = inventory.providers.find((provider) => provider.id === 'dario');

  const checks = [
    {
      id: 'providers',
      status: usable ? 'ok' : 'error',
      message: `${usable}/${inventory.providers.length} provider accounts appear usable or configured.`,
      recommendation: 'Configure or authorize at least one provider and Ping it before depending on auto routing.',
    },
    {
      id: 'routing',
      status: inventory.chains.length && inventory.chains.every((chain) => chain.links.length) ? 'ok' : 'error',
      message: `${inventory.chains.length} chain(s), ${inventory.totals.links} link(s), ${inventory.localKeys.length} local client key(s).`,
      recommendation: 'Keep each local key scoped to only the chain or provider it needs.',
    },
    {
      id: 'failures',
      status: recent.length && failed / recent.length > 0.3 ? 'warn' : 'ok',
      message: `${failed}/${recent.length} recent retained requests are server-side failures.`,
      recommendation: 'Use Security and provider Ping before changing global thresholds.',
    },
    {
      id: 'dario',
      status: dario?.hasCredential ? 'ok' : 'info',
      message: dario?.hasCredential
        ? 'Dario local lane is available and configured.'
        : 'Dario lane is installed in the provider catalog but its local proxy may not be running.',
      recommendation: 'If using a Claude subscription through Dario, start Dario locally and Ping the dario provider. SubChain never copies Dario OAuth material.',
    },
  ];

  return { generatedAt: new Date().toISOString(), checks, quota: quota.snapshot() };
}

const TOOL_CONTRACT = `
SUBCHAIN TOOL ARGUMENT CONTRACT (follow literally):
- set_ui: {theme, fontFamily, fontScale, density} using the documented enumerations from context.
- set_port: {port: 1024..65535}; restart required.
- add_chain: {id?, name, provider, model, optional baseUrl}; creates one new named chain with its first link.
- update_chain: {chainId, name}; rename only.
- remove_chain: {chainId}; never remove the last chain or a chain still targeted by a local key.
- add_chain_link: {chainId, provider, model, optional baseUrl}. Use a known provider and exact model.
- update_chain_link: {chainId, index, provider/model/baseUrl/note fields to change}. Preserve unspecified values.
- remove_chain_link: {chainId, index}; never remove the final link.
- move_chain_link: {chainId, from, to}; use actual zero-based indexes from context.
- set_mode: {mode: chain|pinned, optional pinnedProvider}. Pin only a provider that exists.
- set_threshold: {percent: 0..100, optional provider}. Use for quota-aware fallback policy, not as a fix for auth errors.
- start_managed_login: {provider: openai-codex}. This starts only the supported managed Codex login and may return a verification URL/code to the HUMAN. Never ingest the resulting OAuth token.
- import_detected_credential: {provider}. Only direct API providers with an approved detected source; never for managed OAuth, Dario subscription auth, or local no-key lanes.
- probe_provider: {provider}. A bounded model/catalog health check; do not call it proof of every completion path.
- set_log_policy: {promptSummary: boolean, maxSummaryChars: 80..600, maxContextItems: 1..6}. Never propose raw prompt, raw response, raw tool body or credential retention; the server strips those flags from anything you propose.
- clear_logs: {}. Destructive; explain first.
- minor_code_replace: {file, search, replace}; last resort, tiny exact replacement, repair allowlist only, never auth/security/control code.
The request journal records metadata only unless the HUMAN has explicitly enabled a retention switch on the Settings tab. Never ask for prompts, completions, headers or credentials, never propose enabling their retention, and never claim you can read them.
PROVIDER SETUP PROCEDURE: determine provider type first. Managed subscription => managed login/status. Dario => instruct or start Dario separately and Ping the local dario lane; never copy Dario OAuth or session material. Direct API => use a detected source or the official key page. Local => verify its OpenAI-compatible server is running; a key may be optional.
RELIABILITY PROCEDURE: 401/403 => auth or permission, 429/quota => wait, fallback or threshold, 5xx => provider health or fallback, timeout/network => connectivity or timeout, 400/422 => model or request compatibility. Do not change unrelated settings.
SECURITY PROCEDURE: never weaken loopback admin restrictions, local-key scoping, redaction, confirmation, CSP, or secret stores. After any confirmed mutation, re-read state before proposing another.
Provider rule: do not copy OAuth tokens from Codex, Dario, Claude Code, Antigravity, browsers or credential stores into chat. For a supported managed provider, propose start_managed_login. For a direct API provider, prefer an already detected approved source; otherwise link the official setup page. Provider Ping is diagnostic and must not be misrepresented as a full completion test.`;

export function createSubChainOperator({
  runtime: subRuntime,
  quota,
  journal,
  statusStore,
  probeService,
  managedTransports,
  managedAvailable,
  selfComplete,
}) {
  let runtime;

  const getContext = async () => {
    const inventory = routingInventory(subRuntime, quota, {
      statusStore,
      providerProbeService: probeService,
      managedProviderAvailable: managedAvailable,
    });
    const logs = journal.query({ limit: 100 });
    return {
      appName: 'SubChain',
      specialization: 'Subscription/OAuth, quota-aware and API-key provider routing with managed transports and Harnesses.',
      providers: inventory.providers,
      chains: inventory.chains,
      localKeys: inventory.localKeys,
      routingSettings: inventory.settings,
      providerHelp: providerHelp(statusStore, managedAvailable),
      doctor: doctor(subRuntime, quota, journal, statusStore, managedAvailable),
      security: analyzeSanitizedRecords(logs.items),
      recentLogs: logs.items.slice(0, 30),
      operatorSettings: runtime.readSettings(),
      mutationBoundary: 'All model-proposed mutations require separate human confirmation. Managed OAuth remains owned by the provider client.',
    };
  };

  const executeAction = async (action) => {
    const args = action.args || {};
    switch (action.tool) {
      case 'set_ui':
        return runtime.saveSettings({ ui: args });

      case 'set_port': {
        const port = Number(args.port);
        if (!Number.isInteger(port) || port < 1024 || port > 65535) {
          throw Object.assign(new Error('Port must be 1024-65535.'), { statusCode: 400 });
        }
        writeEnv('SUBCHAIN_PORT', port);
        return { ok: true, port, restartRequired: true };
      }

      case 'add_chain':
        return {
          ok: true,
          chain: addChain(subRuntime, {
            id: args.id,
            name: args.name,
            link: {
              provider: String(args.provider || ''),
              model: String(args.model || ''),
              ...(args.baseUrl ? { baseUrl: String(args.baseUrl) } : {}),
            },
          }),
        };

      case 'update_chain':
        return { ok: true, chain: updateChain(subRuntime, String(args.chainId || ''), { name: args.name }) };

      case 'remove_chain':
        removeChain(subRuntime, String(args.chainId || ''));
        return { ok: true };

      case 'add_chain_link':
        return {
          ok: true,
          link: addChainLink(subRuntime, String(args.chainId || 'default'), {
            provider: String(args.provider || ''),
            model: String(args.model || ''),
            ...(args.baseUrl ? { baseUrl: String(args.baseUrl) } : {}),
          }),
        };

      case 'update_chain_link':
        return { ok: true, link: updateChainLink(subRuntime, String(args.chainId || 'default'), Number(args.index), args) };

      case 'remove_chain_link':
        removeChainLink(subRuntime, String(args.chainId || 'default'), Number(args.index));
        return { ok: true };

      case 'move_chain_link': {
        const chainId = String(args.chainId || 'default');
        const chain = subRuntime.routing.chains.find((candidate) => candidate.id === chainId);
        if (!chain) throw Object.assign(new Error('Unknown chain.'), { statusCode: 404 });
        const from = Number(args.from);
        const to = Number(args.to);
        const valid = (index) => Number.isInteger(index) && index >= 0 && index < chain.links.length;
        if (!valid(from) || !valid(to)) throw Object.assign(new Error('Invalid chain indexes.'), { statusCode: 400 });
        const order = chain.links.map((_, index) => index);
        const [moved] = order.splice(from, 1);
        order.splice(to, 0, moved);
        reorderRoutingChain(subRuntime, chainId, order);
        return { ok: true };
      }

      case 'set_mode': {
        if (!['chain', 'pinned'].includes(args.mode)) {
          throw Object.assign(new Error('Mode must be chain or pinned.'), { statusCode: 400 });
        }
        subRuntime.settings.mode = args.mode;
        if (args.pinnedProvider !== undefined) subRuntime.settings.pinnedProvider = args.pinnedProvider;
        return {
          ok: true,
          mode: subRuntime.settings.mode,
          pinnedProvider: subRuntime.settings.pinnedProvider,
          note: 'Runtime setting changed; use the dashboard persistence path if this must survive a restart.',
        };
      }

      case 'set_threshold': {
        const percent = Number(args.percent);
        if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
          throw Object.assign(new Error('Threshold must be 0-100.'), { statusCode: 400 });
        }
        if (args.provider) subRuntime.settings.providerThresholds[String(args.provider)] = percent;
        else subRuntime.settings.fallbackThresholdPercent = percent;
        return { ok: true };
      }

      case 'start_managed_login': {
        const provider = String(args.provider || '');
        const def = providerDef(provider);
        if (provider !== 'openai-codex' || def.transport !== 'codex-app-server' || !managedTransports) {
          throw Object.assign(new Error('Only the supported OpenAI Codex managed login is currently confirmation-startable.'), { statusCode: 400 });
        }
        const snapshot = await managedTransports.startLogin('codex-app-server');
        return {
          status: snapshot.status,
          verificationUrl: snapshot.verificationUrl,
          userCode: snapshot.userCode,
          expiresAt: snapshot.expiresAt,
        };
      }

      case 'import_detected_credential': {
        const provider = String(args.provider || '');
        const def = providerDef(provider);
        if (def.transport !== 'http' || def.keyOptional) {
          throw Object.assign(new Error('This provider does not use an importable direct credential.'), { statusCode: 400 });
        }
        const found = resolveCredential(provider) || resolveCredential(familyOf(provider));
        if (!found?.token) {
          throw Object.assign(new Error('No approved credential source was detected.'), { statusCode: 409 });
        }
        writeEnv(`SUBCHAIN_${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`, found.token);
        return { ok: true, provider, source: found.source };
      }

      case 'probe_provider': {
        const provider = String(args.provider || '');
        providerDef(provider);
        if (!probeService) throw Object.assign(new Error('Provider Ping service is unavailable.'), { statusCode: 503 });
        const result = await probeService.ping(provider);
        return {
          ok: true,
          provider,
          health: result.health,
          message: result.message,
          modelCount: result.models?.length || 0,
          quotas: result.quotas || [],
        };
      }

      case 'set_log_policy':
        return runtime.saveSettings({ logs: stripHumanOnlyLogFlags(args) });

      case 'clear_logs':
        return journal.clear();

      case 'minor_code_replace':
        return applyMinorRepair({
          root: ROOT,
          file: args.file,
          search: args.search,
          replace: args.replace,
          allowFiles: REPAIR_ALLOWLIST,
        });

      default:
        throw Object.assign(new Error('Unsupported confirmed action.'), { statusCode: 400 });
    }
  };

  runtime = new ChainOperatorRuntime({
    root: ROOT,
    prefix: 'SUBCHAIN',
    appName: 'SubChain',
    specialization: 'subscription and quota-aware provider routing',
    allowedTools: ALLOWED_TOOLS,
    getContext,
    executeAction,
    selfComplete,
    systemPrompt: operatorSystemPrompt(
      'SubChain',
      'Subscription/OAuth and quota-aware provider routing. Prefer managed clients for subscription auth. Dario is a local provider seam and owns its own Claude OAuth and wire fidelity.',
      ALLOWED_TOOLS,
    ) + TOOL_CONTRACT,
  });

  /**
   * Direct credential entry from the operator page. The value travels from the
   * browser field to the local .env only; it is never shown to the model.
   */
  const saveProviderKey = (provider, key) => {
    const id = String(provider || '').trim();
    const value = String(key || '').trim();
    const def = providerDef(id);
    if (def.transport !== 'http' || def.keyOptional || def.authType === 'local-fixed') {
      throw Object.assign(new Error('This provider does not accept a direct API key here.'), { statusCode: 400 });
    }
    if (!value || /\r|\n/.test(value)) {
      throw Object.assign(new Error('A provider key is required.'), { statusCode: 400 });
    }
    writeEnv(`SUBCHAIN_${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`, value);
    return { ok: true, provider: id };
  };

  return {
    runtime,
    getContext,
    security: () => analyzeSanitizedRecords(journal.query({ limit: 500 }).items),
    doctor: () => doctor(subRuntime, quota, journal, statusStore, managedAvailable),
    logs: (query) => journal.query(query),
    saveProviderKey,
  };
}
