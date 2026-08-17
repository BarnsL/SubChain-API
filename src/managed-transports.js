// Supported native subscription transports. OAuth stays owned by each provider client.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { spawnJsonlRpc } from './jsonl-rpc.js';
import { resolveDataDir } from './storage.js';

function privateWorkspace(name, dataDir = resolveDataDir()) {
  const directory = path.join(dataDir, 'managed-workspaces', name);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
  return directory;
}

export function resolveCodexCommand({ env = process.env, platform = process.platform } = {}) {
  if (typeof env.SUBCHAIN_CODEX_COMMAND === 'string' && env.SUBCHAIN_CODEX_COMMAND.trim()) {
    return env.SUBCHAIN_CODEX_COMMAND.trim();
  }
  if (platform === 'win32' && typeof env.LOCALAPPDATA === 'string' && env.LOCALAPPDATA) {
    const binRoot = path.join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    try {
      const candidates = fs.readdirSync(binRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(binRoot, entry.name, 'codex.exe'))
        .filter((candidate) => fs.existsSync(candidate))
        .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
      if (candidates.length) return candidates[0];
    } catch {}
  }
  return 'codex';
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content ?? '');
  return content
    .filter((part) => part?.type === 'text' || part?.type === 'input_text' || typeof part === 'string')
    .map((part) => typeof part === 'string' ? part : part.text || '')
    .join('\n');
}

export function messagesToTranscript(messages = []) {
  const transcript = messages.map((message) => {
    const role = String(message?.role || 'user').toUpperCase();
    return `${role}:\n${contentText(message?.content)}`;
  }).join('\n\n');
  return [
    'Act only as a text completion backend for the following role-marked conversation.',
    'Do not invoke tools, inspect files, use the network, modify state, or describe internal reasoning.',
    'Return only the assistant response to the final request.',
    '',
    transcript,
  ].join('\n');
}

function safeNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export function codexQuotaBuckets(payload = {}) {
  const groups = payload.rateLimitsByLimitId && typeof payload.rateLimitsByLimitId === 'object'
    ? Object.values(payload.rateLimitsByLimitId)
    : payload.rateLimits ? [payload.rateLimits] : [];
  const buckets = [];
  for (const group of groups) {
    for (const slot of ['primary', 'secondary']) {
      const window = group?.[slot];
      if (!window) continue;
      const usedPercent = safeNumber(window.usedPercent);
      buckets.push({
        id: `${group.limitId || 'codex'}:${slot}`,
        label: group.limitName || `${group.limitId || 'Codex'} ${slot}`,
        status: usedPercent !== null && usedPercent >= 100 ? 'exhausted' : 'available',
        usedPercent,
        limit: null,
        remaining: null,
        windowMinutes: safeNumber(window.windowDurationMins),
        resetsAt: safeNumber(window.resetsAt) === null ? null : safeNumber(window.resetsAt) * 1_000,
      });
    }
  }
  return buckets.length ? buckets : [{ id: 'codex', label: 'Codex quota', status: 'unknown' }];
}

function codexModels(payload = {}) {
  return (Array.isArray(payload.data) ? payload.data : [])
    .filter((model) => !model.hidden)
    .map((model) => ({
      id: String(model.id || model.model || '').trim(),
      label: String(model.displayName || model.id || model.model || '').trim(),
      inputModalities: Array.isArray(model.inputModalities) ? model.inputModalities : ['text', 'image'],
      capabilities: {
        defaultReasoningEffort: String(model.defaultReasoningEffort || ''),
        supportsPersonality: Boolean(model.supportsPersonality),
      },
      quotaFamily: 'codex',
    }))
    .filter((model) => model.id);
}

function codexUsageFromEvent(payload = {}) {
  const usage = payload.tokenUsage || payload.usage || payload;
  const total = usage.total || usage.last || usage;
  const prompt = safeNumber(total.inputTokens ?? total.input_tokens ?? total.prompt_tokens) || 0;
  const completion = safeNumber(total.outputTokens ?? total.output_tokens ?? total.completion_tokens) || 0;
  const totalTokens = safeNumber(total.totalTokens ?? total.total_tokens) || prompt + completion;
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: totalTokens };
}

function completionResponse(content, model, usage, stream) {
  const id = `chatcmpl-subchain-${Date.now().toString(36)}`;
  if (stream) {
    const chunk = JSON.stringify({
      id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1_000), model,
      choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }],
    });
    const finish = JSON.stringify({
      id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1_000), model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage,
    });
    return new Response(`data: ${chunk}\n\ndata: ${finish}\n\ndata: [DONE]\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    });
  }
  return new Response(JSON.stringify({
    id, object: 'chat.completion', created: Math.floor(Date.now() / 1_000), model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage,
  }), { headers: { 'content-type': 'application/json' } });
}

function openAiUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const prompt = safeNumber(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens) || 0;
  const completion = safeNumber(usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens) || 0;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: safeNumber(usage.total_tokens ?? usage.totalTokens) || prompt + completion,
  };
}

async function defaultCodexConnect({ cwd, timeoutMs }) {
  const command = resolveCodexCommand();
  const rpc = spawnJsonlRpc({ command, args: ['app-server', '--listen', 'stdio://'], cwd, timeoutMs });
  await rpc.initialize(
    { name: 'subchain', title: 'SubChain', version: '0.1.0' },
    { experimentalApi: true },
  );
  const profiles = await rpc.request('permissionProfile/list', { cwd, limit: 50 });
  const readOnly = profiles?.data?.find((profile) => profile.allowed && /read-only/i.test(profile.id));
  if (!readOnly?.id) {
    rpc.close();
    throw new Error('Codex has no allowed read-only permission profile');
  }
  rpc.subchainReadOnlyPermission = readOnly.id;
  return rpc;
}

async function withCodex(connect, options, operation) {
  let rpc;
  try {
    rpc = await connect(options);
    if (typeof rpc.initialize === 'function' && options.skipInitialize) await rpc.initialize();
    return await operation(rpc);
  } finally {
    rpc?.close?.();
  }
}

async function pingCodex(connect, options) {
  return withCodex(connect, options, async (rpc) => {
    const account = await rpc.request('account/read', { refreshToken: false });
    if (account?.requiresOpenaiAuth && !account?.account) {
      throw Object.assign(new Error('Sign in with Codex before using the managed subscription'), { statusCode: 409 });
    }
    const models = await rpc.request('model/list', { limit: 100, includeHidden: false });
    const limits = await rpc.request('account/rateLimits/read');
    let usage = {};
    try { usage = (await rpc.request('account/usage/read'))?.summary || {}; } catch {}
    return {
      health: 'ready',
      message: 'Codex managed ChatGPT session is ready',
      plan: account?.account?.planType || account?.planType || null,
      models: codexModels(models),
      quotas: codexQuotaBuckets(limits),
      usage,
    };
  });
}

async function completeCodex(connect, options, link, body) {
  return withCodex(connect, options, async (rpc) => {
    let threadId;
    try {
      const started = await rpc.request('thread/start', {
        model: link.model,
        cwd: options.cwd,
        approvalPolicy: 'never',
        permissions: rpc.subchainReadOnlyPermission || ':read-only',
        serviceName: 'subchain',
      });
      threadId = started?.thread?.id;
      if (!threadId) throw new Error('Codex did not return a thread id');

      let content = '';
      let finalText = '';
      let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      const unsubscribeDelta = rpc.subscribe?.('item/agentMessage/delta', (event) => {
        if (!event.threadId || event.threadId === threadId) content += String(event.delta || '');
      }) || (() => {});
      const unsubscribeItem = rpc.subscribe?.('item/completed', (event) => {
        if ((!event.threadId || event.threadId === threadId) && event.item?.type === 'agentMessage') {
          finalText = String(event.item.text || '');
        }
      }) || (() => {});
      const unsubscribeUsage = rpc.subscribe?.('thread/tokenUsage/updated', (event) => {
        if (!event.threadId || event.threadId === threadId) usage = codexUsageFromEvent(event);
      }) || (() => {});
      const completed = rpc.waitFor('turn/completed', (event) => !event.threadId || event.threadId === threadId, options.timeoutMs);
      await rpc.request('turn/start', {
        threadId,
        input: [{ type: 'text', text: messagesToTranscript(body.messages) }],
        cwd: options.cwd,
        approvalPolicy: 'never',
        model: link.model,
        ...(body.reasoning_effort ? { effort: body.reasoning_effort } : {}),
      });
      const completedEvent = await completed;
      unsubscribeDelta(); unsubscribeItem(); unsubscribeUsage();
      if (completedEvent?.turn?.status !== 'completed') {
        throw new Error(String(completedEvent?.turn?.error?.message || 'Codex turn did not complete'));
      }
      return completionResponse(finalText || content, link.model, usage, Boolean(body.stream));
    } finally {
      if (threadId) await rpc.request('thread/delete', { threadId }).catch(() => {});
    }
  });
}

function runCommand(command, args, { cwd, timeoutMs = 120_000, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Managed provider command timed out')); }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-10_000_000); });
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-2_000); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(stdout);
      try {
        if (JSON.parse(stdout)?.status === 'ERROR') return resolve(stdout);
      } catch {}
      reject(new Error(`Managed provider command failed (${code ?? 'unknown'}): ${stderr.slice(-300)}`));
    });
  });
}

function antigravityModels(output) {
  return output.split(/\r?\n/).map((line) => {
    const [id, ...labelParts] = line.trim().split(/\t+/);
    if (!/^[a-z0-9][a-z0-9._-]+$/i.test(id)) return null;
    return {
    id,
    label: labelParts.join(' ').trim() || id,
    inputModalities: ['text'],
    capabilities: {},
    quotaFamily: /^(?:claude-|gpt-)/.test(id) ? 'third-party-models' : 'google-models',
    };
  }).filter(Boolean);
}

function antigravityResult(output) {
  try {
    const parsed = JSON.parse(output);
    return {
      content: String(parsed.result ?? parsed.response ?? parsed.content ?? parsed.message?.content ?? parsed.message ?? ''),
      error: parsed.status === 'ERROR' ? String(parsed.error || 'Managed provider request failed').slice(0, 240) : null,
      usage: openAiUsage(parsed.usage),
    };
  } catch {
    return { content: output.trim(), error: null, usage: null };
  }
}

export function createManagedTransports({
  codexConnect = defaultCodexConnect,
  commandRunner = runCommand,
  dataDir = resolveDataDir(),
  timeoutMs = 120_000,
} = {}) {
  const codexOptions = { cwd: privateWorkspace('codex', dataDir), timeoutMs };
  const antigravityCwd = privateWorkspace('antigravity', dataDir);
  const command = process.env.SUBCHAIN_ANTIGRAVITY_COMMAND || 'agy';
  const handlers = {
    'codex-app-server': {
      ping: () => pingCodex(codexConnect, codexOptions),
      request: (link, body) => completeCodex(codexConnect, codexOptions, link, body),
    },
    'antigravity-cli': {
      async ping() {
        const models = antigravityModels(await commandRunner(command, ['models'], { cwd: antigravityCwd, timeoutMs }));
        return {
          health: 'ready',
          message: 'Antigravity managed session is ready',
          models,
          quotas: [
            { id: 'google-models', label: 'Google models', status: 'unknown' },
            { id: 'third-party-models', label: 'Claude and GPT models', status: 'unknown' },
          ],
        };
      },
      async request(link, body) {
        const output = await commandRunner(command, [
          '-p', messagesToTranscript(body.messages), '--model', link.model,
          '--output-format', 'json', '--mode', 'plan', '--sandbox', '--new-project',
        ], { cwd: antigravityCwd, timeoutMs });
        const result = antigravityResult(output);
        if (result.error) {
          const quotaFamily = /^(?:claude-|gpt-)/.test(link.model) ? 'third-party-models' : 'google-models';
          const quotaReached = /quota.*(?:reached|exhausted)|(?:reached|exhausted).*quota/i.test(result.error);
          return new Response(JSON.stringify({
            error: { message: result.error, type: quotaReached ? 'rate_limit_error' : 'managed_provider_error' },
          }), {
            status: quotaReached ? 429 : 502,
            headers: {
              'content-type': 'application/json',
              ...(quotaReached ? { 'x-subchain-quota-family': quotaFamily } : {}),
            },
          });
        }
        return completionResponse(result.content, link.model, result.usage, Boolean(body.stream));
      },
    },
  };
  return {
    has(transport) { return Boolean(handlers[transport]); },
    ping(transport) {
      if (!handlers[transport]) throw Object.assign(new Error('Managed provider client is unavailable'), { statusCode: 409 });
      return handlers[transport].ping();
    },
    request(transport, link, body) {
      if (!handlers[transport]) throw new Error('Managed provider client is unavailable');
      return handlers[transport].request(link, body);
    },
    probes: {
      'codex-app-server': () => handlers['codex-app-server'].ping(),
      'antigravity-cli': () => handlers['antigravity-cli'].ping(),
    },
  };
}
