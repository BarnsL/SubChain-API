// Shared confirmation-gated operator runtime for FreeChain/SubChain.
// This module deliberately contains no app-specific mutation logic. The host
// adapter supplies sanitized context and an executor; all model proposals are
// inert until confirm() calls that executor with an allowlisted action.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const clean = (value, max = 4000) => String(value ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const SECRET_PATTERNS = [
  /Bearer\s+[^\s,;]+/gi,
  /\b(?:sk|key|tok|token|api)[-_][A-Za-z0-9._-]{12,}\b/gi,
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\b[A-Za-z0-9+/_=-]{48,}\b/g,
];
export function redactOperatorText(value) {
  let out = clean(value, 8000);
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[REDACTED]');
  return out;
}

function completionUrl(baseUrl) {
  const raw = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!raw) throw Object.assign(new Error('Control-model base URL is not configured.'), { statusCode: 409 });
  const url = new URL(raw);
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !loopback) throw Object.assign(new Error('External control models require HTTPS unless loopback.'), { statusCode: 400 });
  return raw.endsWith('/chat/completions') ? raw : `${raw}/chat/completions`;
}

function parseEnvelope(text) {
  let raw = String(text || '').trim();
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) raw = fenced[1];
  let data;
  try { data = JSON.parse(raw); }
  catch {
    const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return { message: raw.slice(0, 8000), actions: [], links: [] };
    try { data = JSON.parse(raw.slice(start, end + 1)); }
    catch { return { message: raw.slice(0, 8000), actions: [], links: [] }; }
  }
  return {
    message: typeof data?.message === 'string' ? data.message.slice(0, 8000) : '',
    actions: Array.isArray(data?.actions) ? data.actions.slice(0, 8) : [],
    links: Array.isArray(data?.links) ? data.links.slice(0, 8) : [],
  };
}

export class ChainOperatorRuntime {
  constructor({ root, prefix, appName, specialization, allowedTools, getContext, executeAction, selfComplete, systemPrompt }) {
    this.root = root;
    this.prefix = prefix;
    this.appName = appName;
    this.specialization = specialization;
    this.allowedTools = new Set(allowedTools);
    this.getContext = getContext;
    this.executeAction = executeAction;
    this.selfComplete = selfComplete;
    this.systemPrompt = systemPrompt;
    this.pending = new Map();
    this.settingsPath = path.join(root, `.${appName.toLowerCase()}-operator.json`);
    this.envPath = path.join(root, '.env');
  }

  readSettings() {
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8')); } catch {}
    return {
      assistant: { baseUrl: '', model: '', useSelf: true, ...(saved.assistant || {}), keyConfigured: Boolean(process.env[`${this.prefix}_CONTROL_API_KEY`]?.trim()) },
      ui: { theme: 'dark', fontFamily: 'system', fontScale: 1, density: 'comfortable', ...(saved.ui || {}) },
      // Every retention switch is off by default. SubChain's shipped posture is
      // that nothing a caller sent is written to disk; a host who needs the
      // exact bytes to debug their own router can turn these on, but that is
      // always an explicit act, never inherited from a default.
      //
      // `credentials` is the sharp one: it stores the presented bearer token
      // in clear text. Keep it off unless actively chasing an auth bug, and
      // clear the journal afterwards.
      logs: {
        promptSummary: false,
        maxSummaryChars: 280,
        maxContextItems: 3,
        rawPrompts: false,
        rawResponses: false,
        rawToolBodies: false,
        credentials: false,
        maxRawChars: 20_000,
        ...(saved.logs || {}),
      },
    };
  }

  saveSettings(update = {}) {
    const current = this.readSettings(); delete current.assistant.keyConfigured;
    const next = {
      assistant: { ...current.assistant, ...(update.assistant || {}) },
      ui: { ...current.ui, ...(update.ui || {}) },
      logs: { ...current.logs, ...(update.logs || {}) },
    };
    if (!['dark','light','system'].includes(next.ui.theme)) throw Object.assign(new Error('Invalid theme.'), { statusCode: 400 });
    if (!['system','sans','serif','mono'].includes(next.ui.fontFamily)) throw Object.assign(new Error('Invalid font preset.'), { statusCode: 400 });
    next.ui.fontScale = Math.max(.8, Math.min(1.4, Number(next.ui.fontScale) || 1));
    if (!['compact','comfortable','spacious'].includes(next.ui.density)) throw Object.assign(new Error('Invalid density.'), { statusCode: 400 });
    next.logs.maxSummaryChars = Math.max(80, Math.min(600, Number(next.logs.maxSummaryChars) || 280));
    next.logs.maxContextItems = Math.max(1, Math.min(6, Number(next.logs.maxContextItems) || 3));
    // Coerce rather than trust: these gate whether caller content reaches the
    // disk, so a truthy string from a malformed request must not enable one.
    for (const flag of ['promptSummary', 'rawPrompts', 'rawResponses', 'rawToolBodies', 'credentials']) {
      next.logs[flag] = next.logs[flag] === true;
    }
    next.logs.maxRawChars = Math.max(1_000, Math.min(64_000, Number(next.logs.maxRawChars) || 20_000));
    const tmp = `${this.settingsPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(tmp, this.settingsPath);
    return this.readSettings();
  }

  saveControlKey(key) {
    if (typeof key !== 'string' || !key.trim() || /\r|\n/.test(key)) throw Object.assign(new Error('A valid control-model key is required.'), { statusCode: 400 });
    const name = `${this.prefix}_CONTROL_API_KEY`;
    const lines = fs.existsSync(this.envPath) ? fs.readFileSync(this.envPath, 'utf8').split(/\r?\n/) : [];
    let replaced = false;
    const out = lines.map(line => line.startsWith(`${name}=`) ? (replaced = true, `${name}=${key.trim()}`) : line);
    if (!replaced) out.push(`${name}=${key.trim()}`);
    const tmp = `${this.envPath}.${process.pid}.tmp`; fs.writeFileSync(tmp, out.filter(Boolean).join('\n') + '\n', { mode: 0o600 }); fs.renameSync(tmp, this.envPath);
    process.env[name] = key.trim(); return { configured: true };
  }

  async callModel(messages, signal) {
    const settings = this.readSettings();
    if (settings.assistant.useSelf) return this.selfComplete(messages, signal);
    const key = process.env[`${this.prefix}_CONTROL_API_KEY`]?.trim();
    if (!key) throw Object.assign(new Error('Control-model API key is not configured.'), { statusCode: 409 });
    if (!settings.assistant.model) throw Object.assign(new Error('Control-model name is not configured.'), { statusCode: 409 });
    const response = await fetch(completionUrl(settings.assistant.baseUrl), { method:'POST', signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000), headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`}, body:JSON.stringify({model:settings.assistant.model,messages,stream:false,temperature:.1,max_tokens:2200}) });
    if (!response.ok) throw Object.assign(new Error(`Control model HTTP ${response.status}`), { statusCode: 502 });
    const payload = await response.json();
    return payload?.choices?.[0]?.message?.content || '';
  }

  purge() { const now=Date.now(); for (const [id,a] of this.pending) if (a.expiresAt <= now) this.pending.delete(id); }
  listPending() { this.purge(); return [...this.pending.values()].map(a=>({...a,expiresAt:new Date(a.expiresAt).toISOString()})); }
  reject(id) { return { ok:this.pending.delete(String(id)) }; }

  propose(actions = []) {
    this.purge(); const out=[];
    for (const raw of actions.slice(0,8)) {
      const tool=clean(raw?.tool,80); if (!this.allowedTools.has(tool)) continue;
      const id=randomUUID(); const action={id,tool,args:raw?.args&&typeof raw.args==='object'?raw.args:{},reason:clean(raw?.reason,800)||'Proposed by the operator.',description:clean(raw?.description,1000)||tool,createdAt:new Date().toISOString(),expiresAt:Date.now()+10*60_000};
      this.pending.set(id,action); out.push({...action,expiresAt:new Date(action.expiresAt).toISOString()});
    }
    return out;
  }

  async chat(message, history = [], signal) {
    const context = await this.getContext();
    const safeHistory = Array.isArray(history) ? history.slice(-10).map(item=>({role:item?.role==='assistant'?'assistant':'user',content:redactOperatorText(item?.content)})) : [];
    const messages=[{role:'system',content:this.systemPrompt},{role:'system',content:`CURRENT SANITIZED APP CONTEXT:\n${JSON.stringify(context)}`},...safeHistory,{role:'user',content:redactOperatorText(message)}];
    const envelope=parseEnvelope(await this.callModel(messages,signal));
    const allowedLinks=new Set((context.providerHelp||[]).map(item=>item.url).filter(Boolean));
    return {message:envelope.message||`I reviewed ${this.appName}.`,pending:this.propose(envelope.actions),links:envelope.links.filter(l=>allowedLinks.has(l?.url)).map(l=>({label:clean(l.label,120),url:l.url}))};
  }

  async confirm(id) {
    this.purge(); const action=this.pending.get(String(id));
    if (!action) throw Object.assign(new Error('Pending action not found or expired.'), { statusCode:404 });
    this.pending.delete(String(id));
    const result=await this.executeAction(action);
    return {action:{id:action.id,tool:action.tool,description:action.description},result};
  }
}

export function operatorSystemPrompt(appName, specialization, tools) {
  return `You are the local ${appName} operator, setup assistant, reliability engineer, log/security analyst, and constrained repair planner. Specialization: ${specialization}.
RETURN EXACTLY JSON: {"message":"answer","actions":[{"tool":"name","args":{},"reason":"why","description":"exact human-visible change"}],"links":[{"label":"...","url":"..."}]}.
Rules: never claim a proposal is already applied. All mutations require a separate human confirmation enforced by the server. Never request, expose, copy into chat, or log provider API keys/OAuth tokens. Use only provider URLs present in context. Prefer supported managed OAuth over copying tokens. Diagnose from doctor/security/sanitized logs first. Distinguish 401/403 auth, 429 rate pressure, 5xx provider failures, timeout/network failures, and 400/422 model/request incompatibility. Prefer configuration changes to code changes. Never propose disabling authentication, loopback protections, CSP, redaction, request limits or confirmation. Never propose arbitrary shell, arbitrary filesystem edits, package installation, destructive commands, or broad rewrites. Minor repair is a last resort and must stay within the host app's explicitly documented allowlist and rollback/test workflow.
Allowed mutation tool names: ${tools.join(', ')}.`;
}
