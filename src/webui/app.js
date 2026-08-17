import { createHarnessExpansionState } from './ui-state.js';

/* SubChain dashboard behaviour.
   Plain DOM, no framework. State refetched from /admin/state after any
   mutation so the page always reflects what is on disk. */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ORIGIN = location.origin;
let state = null;
let revealed = false;
let accessKeyValue = null;
const harnessExpansion = createHarnessExpansionState();
const presetLibrary = { loaded: false, loading: false, query: '', source: '', component: '', page: null, selected: null, request: 0 };
let activeHarnessId = localStorage.getItem('subchain.harness.active') || 'default';
const subscriptionLogin = { providerId: null, snapshot: null, busy: false, pollTimer: null, requestId: 0 };

// ── helpers ───────────────────────────────────────────────────────────

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

let toastTimer;
function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('err', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
}

async function copy(text, what = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(what);
  } catch {
    toast('Clipboard blocked. Select and copy manually.', true);
  }
}

const icon = {
  ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/></svg>',
  grip: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m18 15-6-6-6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>',
  chevDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>',
};

// ── navigation ────────────────────────────────────────────────────────

function goto(page) {
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${page}`));
  $$('.nav-item[data-page]').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  window.scrollTo(0, 0);
}
$$('.nav-item[data-page]').forEach((b) => b.addEventListener('click', () => goto(b.dataset.page)));
document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-goto]');
  if (link) {
    e.preventDefault();
    goto(link.dataset.goto);
  }
});

// ── overview ─────────────────────────────────────────────────────────

function progressClass(pct) {
  if (pct < 60) return 'progress-green';
  if (pct < 85) return 'progress-yellow';
  return 'progress-red';
}

function renderOverview() {
  const { totals, stats, providers, cooling } = state;
  $('#statEndpoint').textContent = `${ORIGIN}/v1`;
  $('#statReady').textContent = totals.links;
  $('#statReadySub').textContent = `${totals.ready} provider account${totals.ready === 1 ? '' : 's'} ready`;
  $('#statServed').textContent = stats.served;
  $('#statFailed').textContent = stats.failed ? `${stats.failed} failed` : 'none failed';

  const withCreds = providers.filter((p) => p.hasCredential);
  $('#noKeysCallout').classList.toggle('hidden', withCreds.length > 0);

  $('#sourceCards').innerHTML = providers
    .filter((p) => p.linkCount > 0)
    .map((p) => {
      const ok = p.hasCredential;
      const q = p.quota;
      const usagePct = q ? q.usagePercent : 0;
      const usageBar = q
        ? `<div class="progress-bar"><div class="progress-fill ${progressClass(usagePct)}" style="width:${usagePct}%"></div></div>`
        : '';
      return `<div class="stat status-card">
        <div class="status-card-head">
          <div class="stat-label">${esc(p.label)}</div>
          <span class="badge ${ok ? 'badge-ok' : 'badge-warn'}"><span class="dot"></span>${ok ? 'ready' : 'no credential'}</span>
        </div>
        <div class="stat-value" style="font-size:22px">${q ? `${usagePct}%` : (ok ? 'idle' : 'not available')}</div>
        <div class="stat-sub">${p.linkCount} model(s) in chain · ${esc(p.jurisdiction)}</div>
        ${usageBar}
      </div>`;
    })
    .join('');

  $('#coolingBox').innerHTML = cooling.length
    ? `<div class="table-wrap"><table><thead><tr><th>Route</th><th>Last error</th><th>Retry in</th></tr></thead><tbody>${cooling
        .map(
          (c) =>
            `<tr><td class="mono">${esc(c.id)}</td><td style="color:var(--muted-foreground)">${esc(c.lastError || 'not reported')}</td><td class="num">${c.secondsRemaining}s</td></tr>`
        )
        .join('')}</tbody></table></div>`
    : `<div class="card" style="color:var(--muted-foreground);font-size:13px">Nothing cooling off. Every configured route is available.</div>`;
}

// ── providers ────────────────────────────────────────────────────────

function clearSubscriptionPolling() {
  clearTimeout(subscriptionLogin.pollTimer);
  subscriptionLogin.pollTimer = null;
}

function invalidateSubscriptionLogin() {
  clearSubscriptionPolling();
  subscriptionLogin.requestId += 1;
  return subscriptionLogin.requestId;
}

function subscriptionStatusMessage(snapshot) {
  if (snapshot?.status === 'pending') return 'Use the official verification page and enter this one-time code.';
  if (snapshot?.status === 'cancelled') return 'Connection cancelled. Start again when you are ready.';
  if (snapshot?.status === 'expired') return 'That code expired. Start a new ChatGPT connection to get another one.';
  return 'SubChain could not complete the ChatGPT connection. Check that Codex can sign in to your subscription, then try again.';
}

function subscriptionPanel(provider) {
  if (!provider.canConnectSubscription) return { action: '', panel: '' };
  const current = subscriptionLogin.providerId === provider.id ? subscriptionLogin.snapshot : null;
  const busy = subscriptionLogin.providerId === provider.id && subscriptionLogin.busy;
  const canStart = !current || ['cancelled', 'expired', 'error'].includes(current.status);
  const action = canStart
    ? `<button class="btn btn-sm btn-primary" type="button" data-connect-subscription ${busy ? 'disabled' : ''} aria-describedby="connect-${esc(provider.id)}-hint">${busy ? 'Connecting…' : 'Connect ChatGPT subscription'}</button>`
    : '';
  if (!current) {
    return {
      action,
      panel: `<p class="subscription-hint" id="connect-${esc(provider.id)}-hint">Connect through the official ChatGPT verification flow. SubChain never receives your ChatGPT password or tokens.</p>`,
    };
  }
  if (current.status === 'pending') {
    const verificationLink = current.verificationUrl
      ? `<a class="btn btn-sm" href="${esc(current.verificationUrl)}" target="_blank" rel="noopener noreferrer">${icon.ext} Open official verification</a>`
      : '';
    return {
      action,
      panel: `<section class="subscription-connect" id="connect-${esc(provider.id)}-hint" aria-live="polite">
        <div><h3>Finish connecting ChatGPT</h3><p>${subscriptionStatusMessage(current)}</p></div>
        <div class="subscription-code" aria-label="One-time verification code"><span>One-time code</span><code>${esc(current.userCode || 'Waiting for a code…')}</code></div>
        <div class="subscription-actions">${verificationLink}<button class="btn btn-sm btn-ghost" type="button" data-cancel-subscription ${busy ? 'disabled' : ''}>${busy ? 'Cancelling…' : 'Cancel'}</button></div>
      </section>`,
    };
  }
  return {
    action,
    panel: `<section class="subscription-connect subscription-connect-error" id="connect-${esc(provider.id)}-hint" aria-live="polite"><div><h3>ChatGPT connection needs attention</h3><p>${subscriptionStatusMessage(current)}</p></div></section>`,
  };
}

function renderSubscriptionLogin() {
  if (state) renderProviders();
}

function scheduleSubscriptionStatus(requestId) {
  clearSubscriptionPolling();
  subscriptionLogin.pollTimer = setTimeout(() => checkSubscriptionStatus(requestId), 2_500);
}

async function finishSubscriptionLogin(requestId) {
  if (requestId !== subscriptionLogin.requestId) return;
  clearSubscriptionPolling();
  subscriptionLogin.busy = true;
  renderSubscriptionLogin();
  try {
    await api('/admin/providers/openai-codex/ping', { method: 'POST' });
    if (requestId !== subscriptionLogin.requestId) return;
    subscriptionLogin.snapshot = null;
    await refresh();
    toast('ChatGPT subscription connected and provider status refreshed');
  } catch (error) {
    if (requestId !== subscriptionLogin.requestId) return;
    subscriptionLogin.snapshot = { status: 'error' };
    toast('ChatGPT connected, but Ping could not refresh the provider. Try Ping again.', true);
    renderSubscriptionLogin();
  } finally {
    if (requestId === subscriptionLogin.requestId) {
      subscriptionLogin.busy = false;
      renderSubscriptionLogin();
    }
  }
}

async function checkSubscriptionStatus(requestId) {
  if (requestId !== subscriptionLogin.requestId) return;
  try {
    const snapshot = await api('/admin/providers/openai-codex/connect');
    if (requestId !== subscriptionLogin.requestId) return;
    subscriptionLogin.snapshot = snapshot;
    if (snapshot.status === 'pending') {
      renderSubscriptionLogin();
      scheduleSubscriptionStatus(requestId);
    } else if (snapshot.status === 'ready') {
      await finishSubscriptionLogin(requestId);
    } else {
      clearSubscriptionPolling();
      renderSubscriptionLogin();
    }
  } catch (error) {
    if (requestId !== subscriptionLogin.requestId) return;
    clearSubscriptionPolling();
    subscriptionLogin.snapshot = { status: 'error' };
    toast('Could not check the ChatGPT connection. Check Codex, then try again.', true);
    renderSubscriptionLogin();
  }
}

async function startSubscriptionLogin() {
  const requestId = invalidateSubscriptionLogin();
  subscriptionLogin.providerId = 'openai-codex';
  subscriptionLogin.snapshot = null;
  subscriptionLogin.busy = true;
  renderSubscriptionLogin();
  try {
    const snapshot = await api('/admin/providers/openai-codex/connect', { method: 'POST' });
    if (requestId !== subscriptionLogin.requestId) return;
    subscriptionLogin.snapshot = snapshot;
    subscriptionLogin.busy = false;
    if (snapshot.status === 'pending') {
      renderSubscriptionLogin();
      scheduleSubscriptionStatus(requestId);
    } else if (snapshot.status === 'ready') {
      await finishSubscriptionLogin(requestId);
    } else {
      clearSubscriptionPolling();
      renderSubscriptionLogin();
    }
  } catch (error) {
    if (requestId !== subscriptionLogin.requestId) return;
    subscriptionLogin.snapshot = { status: 'error' };
    subscriptionLogin.busy = false;
    toast('Could not start the ChatGPT connection. Check Codex, then try again.', true);
    renderSubscriptionLogin();
  }
}

async function cancelSubscriptionLogin() {
  const requestId = invalidateSubscriptionLogin();
  subscriptionLogin.busy = true;
  renderSubscriptionLogin();
  try {
    const snapshot = await api('/admin/providers/openai-codex/connect/cancel', { method: 'POST' });
    if (requestId !== subscriptionLogin.requestId) return;
    subscriptionLogin.snapshot = snapshot;
    toast('ChatGPT connection cancelled');
  } catch (error) {
    if (requestId !== subscriptionLogin.requestId) return;
    subscriptionLogin.snapshot = { status: 'error' };
    toast('Could not cancel the ChatGPT connection. Check Codex, then try again.', true);
  } finally {
    if (requestId === subscriptionLogin.requestId) {
      clearSubscriptionPolling();
      subscriptionLogin.busy = false;
      renderSubscriptionLogin();
    }
  }
}

function renderProviders() {
  $('#providerList').innerHTML = state.providers
    .map((p) => {
      const source = p.credentialSource ? p.credentialSource.replace(/-/g, ' ') : null;
      const status = p.health === 'ready' ? 'ready' : p.health === 'error' ? 'error' : p.hasCredential ? 'unchecked' : 'no credential';
      const statusClass = status === 'ready' ? 'badge-ok' : status === 'error' ? 'badge-err' : 'badge-warn';
      const quotas = p.quotas || p.quota?.quotas || [];
      const quotaInfo = quotas.length
        ? quotas.map((quota) => {
          const value = quota.usedPercent;
          return `<div class="quota-row">
            <div class="row-between"><span>${esc(quota.label || quota.id)}</span><span class="num">${value === null || value === undefined ? 'unknown' : `${value}%`}</span></div>
            ${value === null || value === undefined ? '' : `<div class="progress-bar"><div class="progress-fill ${progressClass(value)}" style="width:${Math.max(0, Math.min(100, value))}%"></div></div>`}
            <div class="provider-meta">${quota.status === 'exhausted' ? 'Exhausted' : quota.status === 'available' ? 'Available' : 'Limit is not published'}${quota.windowMinutes ? ` · ${quota.windowMinutes} minute window` : ''}</div>
          </div>`;
        }).join('')
        : '<div class="provider-empty">No quota data yet. Ping checks what the provider publishes.</div>';
      const observed = p.observedUsage || {};
      const models = p.models || [];

      const siteLink = p.subscriptionUrl
        ? `<a class="btn btn-sm btn-ghost" href="${esc(p.subscriptionUrl)}" target="_blank" rel="noopener noreferrer">${icon.ext} Manage subscription</a>`
        : '';
      const subscription = subscriptionPanel(p);

      return `<article class="card provider" data-provider="${esc(p.id)}">
        <div class="provider-head">
          <div class="provider-identity">
            <div class="provider-title">
              <input class="provider-name" value="${esc(p.name || p.label)}" maxlength="120" aria-label="Subscription account name" data-provider-name />
              <span class="badge ${statusClass}"><span class="dot"></span>${esc(status)}</span>
              ${p.linkCount ? `<span class="badge badge-sub">${p.linkCount} model(s) in chain</span>` : `<span class="badge">not in chain</span>`}
            </div>
            <div class="provider-meta">
              ${esc(p.transport)} · ${esc(p.authType)} · ${esc(p.jurisdiction)}
            </div>
            <div class="provider-meta">${source ? `Authorized through ${esc(source)}.` : p.statusMessage ? esc(p.statusMessage) : 'No authorized credential source is currently available.'}</div>
          </div>
          <div class="provider-actions">${subscription.action}<button class="btn btn-sm" type="button" data-provider-ping ${p.isPinging ? 'disabled' : ''}>${p.isPinging ? 'Pinging…' : 'Ping'}</button>${siteLink}</div>
        </div>
        ${subscription.panel}
        <div class="provider-detail-grid">
          <section><h3>Quota and account status</h3><div class="quota-list">${quotaInfo}</div></section>
          <section><h3>Observed through SubChain</h3><div class="usage-grid"><span><strong>${Number(observed.requests || 0).toLocaleString()}</strong> requests</span><span><strong>${Number(observed.totalTokens || 0).toLocaleString()}</strong> tokens</span><span><strong>${esc(p.plan || 'unknown')}</strong> plan</span><span><strong>${p.lastPingAt ? new Date(p.lastPingAt).toLocaleString() : 'never'}</strong> last Ping</span></div></section>
        </div>
        <section class="provider-models"><div class="row-between"><h3>Available models</h3><span class="provider-meta">${models.length.toLocaleString()} discovered</span></div><div class="model-list">${models.length ? models.map((model) => `<span class="model-chip" title="${esc(model.quotaFamily || '')}">${esc(model.label || model.id)}${model.quotaFamily ? `<small>${esc(model.quotaFamily)}</small>` : ''}</span>`).join('') : '<span class="provider-empty">Ping this subscription to refresh its model catalog.</span>'}</div></section>
      </article>`;
    })
    .join('');
}

$('#providerList').addEventListener('click', async (event) => {
  if (event.target.closest('[data-connect-subscription]')) {
    await startSubscriptionLogin();
    return;
  }
  if (event.target.closest('[data-cancel-subscription]')) {
    await cancelSubscriptionLogin();
    return;
  }
  const button = event.target.closest('[data-provider-ping]');
  if (!button) return;
  const card = button.closest('[data-provider]');
  button.disabled = true;
  button.textContent = 'Pinging…';
  try {
    await api(`/admin/providers/${encodeURIComponent(card.dataset.provider)}/ping`, { method: 'POST' });
    await refresh();
    toast('Provider status, models, usage, and quota refreshed');
  } catch (error) {
    toast(error.message, true);
    await refresh().catch(() => {});
  }
});

$('#providerList').addEventListener('change', async (event) => {
  const input = event.target.closest('[data-provider-name]');
  if (!input) return;
  const card = input.closest('[data-provider]');
  try {
    await api(`/admin/providers/${encodeURIComponent(card.dataset.provider)}`, { method: 'POST', body: JSON.stringify({ name: input.value }) });
    await refresh();
    toast('Subscription name saved');
  } catch (error) { toast(error.message, true); }
});

// ── chains ────────────────────────────────────────────────────────────

function providerOptions(selected) {
  return state.providers.map((provider) =>
    `<option value="${esc(provider.id)}" ${provider.id === selected ? 'selected' : ''}>${esc(provider.label)}</option>`
  ).join('');
}

function modelOptions(provider, selected) {
  const available = state.providers.find((candidate) => candidate.id === provider)?.models?.map((model) => model.id) || [];
  const models = selected && !available.includes(selected) ? [selected, ...available] : available;
  return models.map((model) => `<option value="${esc(model)}" ${model === selected ? 'selected' : ''}>${esc(model)}</option>`).join('');
}

function renderChain() {
  const providerSelect = $('#newChainProvider');
  const modelSelect = $('#newChainModel');
  providerSelect.innerHTML = providerOptions(providerSelect.value || state.providers[0]?.id);
  const firstProvider = providerSelect.value || state.providers[0]?.id;
  const liveModels = state.providers.find((provider) => provider.id === firstProvider)?.models?.map((model) => model.id) || [];
  const preferredModel = liveModels.includes(modelSelect.value)
    ? modelSelect.value
    : liveModels[0];
  modelSelect.innerHTML = modelOptions(firstProvider, preferredModel);
  $('#chainList').innerHTML = state.chains.map((chain) => {
    const atLimit = chain.links.length >= 5;
    const firstProvider = state.providers.some((provider) => provider.id === chain.links[0]?.provider) ? chain.links[0].provider : state.providers[0]?.id;
    return `<article class="card chain-card" data-chain="${esc(chain.id)}">
      <div class="row-between chain-card-head">
        <div><h2>${esc(chain.name)}</h2><p>${chain.migrated ? 'Migrated compatibility chain' : 'Local chain'} · ${chain.links.length}/5 links${chain.migrated && chain.links.length > 5 ? ' · additions locked' : ''}</p></div>
        <span class="badge badge-sub">${esc(chain.id)}</span>
      </div>
      <div class="chain-links">${chain.links.map((link, index) => `<div class="chain-link">
        <span class="num">${index + 1}</span><span class="mono">${esc(link.provider)}</span><span class="mono grow">${esc(link.model)}</span>
        <button class="btn btn-ghost btn-sm btn-danger" data-remove-link="${index}" ${chain.links.length === 1 ? 'disabled' : ''}>Remove</button>
      </div>`).join('')}</div>
      <form class="form-row chain-link-form" data-chain-link-form>
        <label class="form-field grow">Provider<select class="input" name="provider">${providerOptions(firstProvider)}</select></label>
        <label class="form-field grow">Model<select class="input" name="model">${modelOptions(firstProvider, state.providers.find((provider) => provider.id === firstProvider)?.models?.[0]?.id)}</select></label>
        <button class="btn btn-sm" type="submit" ${atLimit ? 'disabled' : ''}>Add link</button>
      </form>
    </article>`;
  }).join('');
}

$('#newChainProvider').addEventListener('change', (event) => {
  $('#newChainModel').innerHTML = modelOptions(event.target.value, state.providers.find((provider) => provider.id === event.target.value)?.models?.[0]?.id);
});

$('#addChainForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  try {
    await api('/admin/chains', { method: 'POST', body: JSON.stringify({ name: form.get('name'), link: { provider: form.get('provider'), model: form.get('model') } }) });
    formElement.reset();
    await refresh();
    toast('Chain created');
  } catch (error) { toast(error.message, true); }
});

$('#chainList').addEventListener('change', (event) => {
  const select = event.target.closest('[name="provider"]');
  if (!select) return;
  const model = $('select[name="model"]', select.closest('form'));
  model.innerHTML = modelOptions(select.value, state.providers.find((provider) => provider.id === select.value)?.models?.[0]?.id);
});

$('#chainList').addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-chain-link-form]');
  if (!form) return;
  event.preventDefault();
  const chain = form.closest('[data-chain]');
  const data = new FormData(form);
  try {
    await api(`/admin/chains/${encodeURIComponent(chain.dataset.chain)}/links`, { method: 'POST', body: JSON.stringify({ provider: data.get('provider'), model: data.get('model') }) });
    await refresh();
    toast('Provider link added');
  } catch (error) { toast(error.message, true); }
});

$('#chainList').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-remove-link]');
  if (!button || !confirm('Remove this provider link?')) return;
  const chain = button.closest('[data-chain]');
  try {
    await api(`/admin/chains/${encodeURIComponent(chain.dataset.chain)}/links/${button.dataset.removeLink}`, { method: 'DELETE' });
    await refresh();
    toast('Provider link removed');
  } catch (error) { toast(error.message, true); }
});

// ── harness ──────────────────────────────────────────────────────────

const HARNESS_COMPONENTS = [
  { key: 'identity', label: 'Identity' },
  { key: 'operatingInstructions', label: 'Operating instructions' },
  { key: 'safetyPolicy', label: 'Safety policy' },
  { key: 'toolPolicy', label: 'Tool policy' },
  { key: 'reasoningPolicy', label: 'Reasoning policy' },
  { key: 'outputStyle', label: 'Output style' },
  { key: 'behavioralMode', label: 'Behavioral mode' },
  { key: 'persona', label: 'Persona' },
];

const HARNESS_SECTIONS = [
  { key: 'identity-operating', label: 'Identity and operating instructions', fields: HARNESS_COMPONENTS.slice(0, 2).map((field) => ({ ...field, type: 'textarea', scope: 'components' })) },
  { key: 'safety-tools', label: 'Safety and tools', fields: HARNESS_COMPONENTS.slice(2, 4).map((field) => ({ ...field, type: 'textarea', scope: 'components' })) },
  { key: 'reasoning-output', label: 'Reasoning and output', fields: HARNESS_COMPONENTS.slice(4, 6).map((field) => ({ ...field, type: 'textarea', scope: 'components' })) },
  { key: 'behavior-persona', label: 'Behavior and persona', fields: HARNESS_COMPONENTS.slice(6, 8).map((field) => ({ ...field, type: 'textarea', scope: 'components' })) },
  { key: 'generation', label: 'Generation defaults', fields: [
    { key: 'temperature', label: 'Temperature', type: 'number', scope: 'generation', min: 0, max: 2, step: 0.1 },
    { key: 'top_p', label: 'Top P', type: 'number', scope: 'generation', min: 0, max: 1, step: 0.05 },
    { key: 'top_k', label: 'Top K', type: 'number', scope: 'generation', min: 0, max: 100, step: 1 },
    { key: 'max_tokens', label: 'Max tokens', type: 'number', scope: 'generation', min: 0, max: 100000, step: 100 },
    { key: 'effort', label: 'Reasoning effort', type: 'select', scope: 'generation', options: ['', 'none', 'low', 'medium', 'high', 'xhigh', 'max'] },
  ]},
  { key: 'infrastructure', label: 'Infrastructure defaults', fields: [
    { key: 'stream', label: 'Stream', type: 'select', scope: 'infrastructure', options: ['', 'true', 'false'] },
    { key: 'service_tier', label: 'Service tier', type: 'select', scope: 'infrastructure', options: ['', 'auto', 'default', 'flex', 'priority'] },
    { key: 'user_id', label: 'Provider user identifier', type: 'text', scope: 'infrastructure' },
  ]},
  { key: 'aliases', label: 'Model aliases', type: 'json', scope: 'components' },
  { key: 'headers', label: 'Custom request metadata', type: 'json', scope: 'components' },
];

const presetSourceLabel = (source) => ({
  cl4r1t4s: 'CL4R1T4S', tweakcc: 'tweakcc', 'claude-code-system-prompts': 'Claude Code system prompts',
}[source] || source);

function renderPresetLibrary() {
  const root = $('#presetLibrary');
  if (!root) return;
  const page = presetLibrary.page;
  const items = page?.items || [];
  const sourceOptions = (page?.sources || []).map((source) =>
    `<option value="${esc(source.id)}" ${presetLibrary.source === source.id ? 'selected' : ''}>${esc(presetSourceLabel(source.id))} (${source.count})</option>`,
  ).join('');
  const componentOptions = (page?.components || []).map((component) => {
    const label = HARNESS_COMPONENTS.find((item) => item.key === component.id)?.label || component.id;
    return `<option value="${esc(component.id)}" ${presetLibrary.component === component.id ? 'selected' : ''}>${esc(label)} (${component.count.toLocaleString()})</option>`;
  }).join('');
  const results = presetLibrary.loading
    ? '<div class="preset-empty">Loading imported presets…</div>'
    : items.length
      ? items.map((entry) => `<button class="preset-result ${presetLibrary.selected?.id === entry.id ? 'selected' : ''}" type="button" data-preset-id="${esc(entry.id)}">
          <span><span class="preset-result-title">${esc(entry.title)}</span><span class="preset-result-detail">${esc(entry.description || entry.file)}</span></span>
          <span class="preset-source">${esc(HARNESS_COMPONENTS.find((item) => item.key === entry.suggestedComponent)?.label || entry.suggestedComponent)} · ${esc(presetSourceLabel(entry.source))}</span>
        </button>`).join('')
      : '<div class="preset-empty">No imported presets match this search.</div>';
  const selected = presetLibrary.selected;
  const preview = selected ? `<div class="preset-preview">
      <div class="preset-preview-head"><h3>${esc(selected.title)}</h3><span class="preset-count">${selected.content.length.toLocaleString()} characters</span></div>
      <pre>${esc(selected.content.slice(0, 4000))}${selected.content.length > 4000 ? '\n\n[Preview truncated. Applying uses the complete imported preset.]' : ''}</pre>
      <div class="preset-apply">
        <label class="form-field">Apply to<select class="input" data-preset-target>${HARNESS_COMPONENTS.map((component) => `<option value="${component.key}" ${component.key === (selected.suggestedComponent || 'operatingInstructions') ? 'selected' : ''}>${esc(component.label)}</option>`).join('')}</select></label>
        <label class="form-field">Mode<select class="input" data-preset-mode><option value="replace">Replace</option><option value="append">Append</option></select></label>
        <button class="btn btn-sm" type="button" data-apply-preset>Apply preset</button>
      </div>
    </div>` : '';
  root.innerHTML = `<div class="preset-library-head"><h2>Imported preset library</h2><span class="preset-count">${page ? `${page.total.toLocaleString()} matching` : 'Preparing library'}</span></div>
    <p>Presets are inert text. SubChain classifies likely functions from metadata, then lets you choose the exact component before applying the complete source text.</p>
    <div class="preset-toolbar"><select class="input" aria-label="Preset source" data-preset-source><option value="">All imported sources</option>${sourceOptions}</select><select class="input" aria-label="Harness component" data-preset-component><option value="">All Harness components</option>${componentOptions}</select><input class="input" type="search" placeholder="Search preset names, descriptions, or files" value="${esc(presetLibrary.query)}" data-preset-query /></div>
    <div class="preset-results">${results}</div>${preview}`;
  if (!presetLibrary.loaded && !presetLibrary.loading) void loadPresetEntries();
}

async function loadPresetEntries() {
  const request = ++presetLibrary.request;
  presetLibrary.loading = true;
  renderPresetLibrary();
  const params = new URLSearchParams({ limit: '100' });
  if (presetLibrary.query) params.set('query', presetLibrary.query);
  if (presetLibrary.source) params.set('source', presetLibrary.source);
  if (presetLibrary.component) params.set('component', presetLibrary.component);
  try {
    const page = await api(`/admin/presets?${params}`);
    if (request !== presetLibrary.request) return;
    presetLibrary.page = page;
    presetLibrary.loaded = true;
  } catch (error) {
    if (request === presetLibrary.request) toast(error.message, true);
  } finally {
    if (request === presetLibrary.request) {
      presetLibrary.loading = false;
      renderPresetLibrary();
    }
  }
}

let presetSearchDebounce;
$('#presetLibrary').addEventListener('input', (event) => {
  const field = event.target.closest('[data-preset-query]');
  if (!field) return;
  presetLibrary.query = field.value;
  presetLibrary.selected = null;
  clearTimeout(presetSearchDebounce);
  presetSearchDebounce = setTimeout(loadPresetEntries, 180);
});
$('#presetLibrary').addEventListener('change', (event) => {
  const field = event.target.closest('[data-preset-source], [data-preset-component]');
  if (!field) return;
  if (field.matches('[data-preset-source]')) presetLibrary.source = field.value;
  else presetLibrary.component = field.value;
  presetLibrary.selected = null;
  void loadPresetEntries();
});
$('#presetLibrary').addEventListener('click', async (event) => {
  const choice = event.target.closest('[data-preset-id]');
  if (choice) {
    try {
      presetLibrary.selected = await api(`/admin/presets/read?id=${encodeURIComponent(choice.dataset.presetId)}`);
      renderPresetLibrary();
    } catch (error) { toast(error.message, true); }
    return;
  }
  if (!event.target.closest('[data-apply-preset]') || !presetLibrary.selected) return;
  const target = $('[data-preset-target]', $('#presetLibrary')).value;
  const mode = $('[data-preset-mode]', $('#presetLibrary')).value;
  const current = currentHarness()?.components?.[target];
  if (mode === 'replace' && current && !confirm(`Replace the current ${HARNESS_COMPONENTS.find((component) => component.key === target)?.label || target}?`)) return;
  try {
    const result = await api('/admin/harness/preset', { method: 'POST', body: JSON.stringify({ harnessId: activeHarnessId, id: presetLibrary.selected.id, target, mode }) });
    const index = state.harnesses.findIndex((harness) => harness.id === result.harness.id);
    if (index >= 0) state.harnesses[index] = result.harness;
    renderHarness();
    toast(`Preset applied to ${result.harness.name}`);
  } catch (error) { toast(error.message, true); }
});

function currentHarness() {
  return state?.harnesses?.find((harness) => harness.id === activeHarnessId)
    || state?.harnesses?.[0]
    || null;
}

function valueForField(harness, field) {
  if (field.scope === 'components') return harness.components?.[field.key];
  return harness.components?.[field.scope]?.[field.key];
}

function renderHarnessField(harness, field) {
  const value = valueForField(harness, field);
  const attributes = `data-harness-edit data-component-scope="${esc(field.scope)}" data-component-key="${esc(field.key)}"`;
  if (field.type === 'textarea') return `<div class="harness-field"><label>${esc(field.label)}</label><textarea ${attributes}>${esc(value || '')}</textarea></div>`;
  if (field.type === 'select') {
    return `<div class="harness-field"><label>${esc(field.label)}</label><select class="input" ${attributes}>${field.options.map((option) => `<option value="${esc(option)}" ${(value === option || (value === null && option === '')) ? 'selected' : ''}>${esc(option || '(provider default)')}</option>`).join('')}</select></div>`;
  }
  return `<div class="harness-field"><label>${esc(field.label)}</label><input class="input" type="${field.type === 'number' ? 'number' : 'text'}" ${attributes} value="${value !== null && value !== undefined ? esc(value) : ''}" ${field.min !== undefined ? `min="${field.min}"` : ''} ${field.max !== undefined ? `max="${field.max}"` : ''} ${field.step ? `step="${field.step}"` : ''} placeholder="provider default" /></div>`;
}

function renderHarness() {
  if (!state.harnesses?.some((harness) => harness.id === activeHarnessId)) activeHarnessId = state.harnesses?.[0]?.id || 'default';
  const harness = currentHarness();
  if (!harness) return;
  localStorage.setItem('subchain.harness.active', activeHarnessId);
  const assigned = state.localKeys.filter((key) => key.harnessId === harness.id).length;
  const sections = HARNESS_SECTIONS.map((section) => {
    const expansionKey = `${harness.id}:${section.key}`;
    const expanded = harnessExpansion.isExpanded(expansionKey);
    let bodyHtml;
    if (section.type === 'json') {
      const help = section.key === 'headers' ? '<p class="form-hint">Optional HTTP metadata only. Credential, cookie, host, and connection headers are blocked.</p>' : '';
      bodyHtml = `<div class="harness-field"><label>${esc(section.label)} (JSON object)</label><textarea class="mono" data-harness-edit data-component-json="${esc(section.key)}" rows="4">${esc(JSON.stringify(harness.components?.[section.key] || {}, null, 2))}</textarea>${help}</div>`;
    } else {
      bodyHtml = section.fields.map((field) => renderHarnessField(harness, field)).join('');
    }
    return `<section class="harness-section"><button class="harness-toggle ${expanded ? 'open' : ''}" type="button" data-toggle="${esc(expansionKey)}" aria-expanded="${expanded}"><h3>${esc(section.label)}</h3>${icon.chevDown}</button><div class="harness-body ${expanded ? '' : 'collapsed'}" data-harness-body="${esc(expansionKey)}">${bodyHtml}</div></section>`;
  }).join('');
  $('#harnessConfig').innerHTML = `<div class="card harness-workspace">
      <div class="harness-workspace-grid"><label class="form-field grow">Active Harness<select class="input" data-active-harness>${state.harnesses.map((candidate) => `<option value="${esc(candidate.id)}" ${candidate.id === harness.id ? 'selected' : ''}>${esc(candidate.name)}</option>`).join('')}</select></label><label class="form-field grow">Harness name<input class="input" data-harness-name maxlength="120" value="${esc(harness.name)}" /></label><button class="btn btn-ghost btn-danger" type="button" data-delete-harness ${harness.id === 'default' ? 'disabled' : ''}>Delete</button></div>
      <div class="row-between harness-workspace-meta"><span>${assigned} local key${assigned === 1 ? '' : 's'} assigned</span><span>Changes save automatically</span></div>
      <form class="form-row harness-create" data-create-harness><label class="form-field grow">New Harness name<input class="input" name="name" maxlength="120" placeholder="Research with strict citations" required /></label><button class="btn" type="submit">Create Harness</button></form>
    </div>${sections}`;
  renderPresetLibrary();
}

// Toggle harness sections
$('#harnessConfig').addEventListener('click', (e) => {
  const toggle = e.target.closest('.harness-toggle');
  if (!toggle) return;
  const key = toggle.dataset.toggle;
  const body = $(`[data-harness-body="${CSS.escape(key)}"]`, $('#harnessConfig'));
  body.classList.toggle('collapsed');
  toggle.classList.toggle('open');
  toggle.setAttribute('aria-expanded', String(!body.classList.contains('collapsed')));
  harnessExpansion.setExpanded(key, !body.classList.contains('collapsed'));
});

$('#harnessConfig').addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-create-harness]');
  if (!form) return;
  event.preventDefault();
  try {
    const result = await api('/admin/harnesses', { method: 'POST', body: JSON.stringify({ name: new FormData(form).get('name') }) });
    activeHarnessId = result.harness.id;
    presetLibrary.selected = null;
    await refresh();
    toast('Harness created');
  } catch (error) { toast(error.message, true); }
});

$('#harnessConfig').addEventListener('change', async (event) => {
  const select = event.target.closest('[data-active-harness]');
  if (!select) return;
  activeHarnessId = select.value;
  localStorage.setItem('subchain.harness.active', activeHarnessId);
  presetLibrary.selected = null;
  renderHarness();
});

$('#harnessConfig').addEventListener('click', async (event) => {
  if (!event.target.closest('[data-delete-harness]')) return;
  const harness = currentHarness();
  if (!harness || !confirm(`Delete ${harness.name}?`)) return;
  try {
    await api(`/admin/harnesses/${encodeURIComponent(harness.id)}`, { method: 'DELETE' });
    activeHarnessId = 'default';
    await refresh();
    toast('Harness deleted');
  } catch (error) { toast(error.message, true); }
});

// Save harness on change (debounced)
let harnessDebounce;
$('#harnessConfig').addEventListener('input', (event) => {
  if (!event.target.closest('[data-harness-edit], [data-harness-name]')) return;
  clearTimeout(harnessDebounce);
  harnessDebounce = setTimeout(saveHarness, 800);
});
$('#harnessConfig').addEventListener('change', (event) => {
  if (!event.target.closest('[data-harness-edit], [data-harness-name]')) return;
  clearTimeout(harnessDebounce);
  saveHarness();
});

async function saveHarness() {
  const harness = currentHarness();
  if (!harness) return;
  const components = structuredClone(harness.components || {});
  $$('[data-harness-edit]', $('#harnessConfig')).forEach((el) => {
    if (el.dataset.componentJson) {
      try { components[el.dataset.componentJson] = JSON.parse(el.value); } catch {}
      return;
    }
    const scope = el.dataset.componentScope;
    const field = el.dataset.componentKey;
    let val = el.value;
    if (el.type === 'number') {
      val = val === '' ? null : Number(val);
    } else if (val === '') {
      val = null;
    } else if (val === 'true') {
      val = true;
    } else if (val === 'false') {
      val = false;
    }
    if (scope === 'components') components[field] = val ?? '';
    else {
      if (!components[scope]) components[scope] = {};
      components[scope][field] = val;
    }
  });
  try {
    const result = await api(`/admin/harnesses/${encodeURIComponent(harness.id)}`, {
      method: 'POST',
      body: JSON.stringify({ name: $('[data-harness-name]', $('#harnessConfig')).value, components }),
    });
    const index = state.harnesses.findIndex((candidate) => candidate.id === result.harness.id);
    if (index >= 0) state.harnesses[index] = result.harness;
  } catch (err) {
    toast(err.message, true);
  }
}

// ── local API keys ───────────────────────────────────────────────────

const MASK = '••••••••••••••••••••••••';

function destinationOptions(type, selected) {
  const values = type === 'chain'
    ? state.chains.map((chain) => ({ id: chain.id, label: chain.name }))
    : state.providers.map((provider) => ({ id: provider.id, label: provider.label }));
  return values.map((value) => `<option value="${esc(value.id)}" ${value.id === selected ? 'selected' : ''}>${esc(value.label)}</option>`).join('');
}

function harnessOptions(selected) {
  return (state.harnesses || []).map((harness) => `<option value="${esc(harness.id)}" ${harness.id === selected ? 'selected' : ''}>${esc(harness.name)}</option>`).join('');
}

function renderAccess() {
  const form = $('#addLocalKeyForm');
  const type = form.elements.targetType.value;
  $('#newKeyTarget').innerHTML = destinationOptions(type, $('#newKeyTarget').value);
  $('#newKeyHarness').innerHTML = harnessOptions($('#newKeyHarness').value || 'default');
  $('#localKeyList').innerHTML = state.localKeys.map((localKey) => `<article class="card local-key-card" data-local-key="${esc(localKey.id)}">
    <div class="row-between local-key-head"><div><h2>${esc(localKey.name)}</h2><p>Required on every request to <span class="mono">/v1/*</span> made with this key.</p></div><span class="badge ${localKey.hasToken ? 'badge-ok' : 'badge-warn'}"><span class="dot"></span>${localKey.hasToken ? 'active' : 'missing'}</span></div>
    <div class="keyfield"><input type="password" value="${MASK}" readonly spellcheck="false" data-key-value /><button class="btn btn-ghost btn-sm" data-reveal-key>Show</button><button class="btn btn-sm" data-copy-key>Copy</button><button class="btn btn-sm" data-rotate-key>Rotate</button></div>
    <div class="form-row local-key-target"><label class="form-field">Feeds<select class="input" data-key-target-type><option value="chain" ${localKey.target.type === 'chain' ? 'selected' : ''}>a chain</option><option value="provider" ${localKey.target.type === 'provider' ? 'selected' : ''}>one provider</option></select></label><label class="form-field grow">Destination<select class="input" data-key-target-id>${destinationOptions(localKey.target.type, localKey.target.id)}</select></label><label class="form-field grow">Harness<select class="input" data-key-harness>${harnessOptions(localKey.harnessId || 'default')}</select></label><button class="btn btn-sm" data-save-key-target>Save routing</button>${localKey.id === 'default' ? '' : '<button class="btn btn-ghost btn-sm btn-danger" data-delete-key>Delete</button>'}</div>
  </article>`).join('');
}

$('#addLocalKeyForm').addEventListener('change', (event) => {
  if (event.target.name !== 'targetType') return;
  $('#newKeyTarget').innerHTML = destinationOptions(event.target.value, null);
});

$('#addLocalKeyForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  try {
    const result = await api('/admin/local-keys', { method: 'POST', body: JSON.stringify({ name: form.get('name'), target: { type: form.get('targetType'), id: form.get('targetId') }, harnessId: form.get('harnessId') }) });
    await copy(result.key, 'New local key copied');
    formElement.reset();
    await refresh();
  } catch (error) { toast(error.message, true); }
});

$('#localKeyList').addEventListener('change', (event) => {
  const type = event.target.closest('[data-key-target-type]');
  if (!type) return;
  const card = type.closest('[data-local-key]');
  $('[data-key-target-id]', card).innerHTML = destinationOptions(type.value, null);
});

$('#localKeyList').addEventListener('click', async (event) => {
  const card = event.target.closest('[data-local-key]');
  if (!card) return;
  const id = encodeURIComponent(card.dataset.localKey);
  const field = $('[data-key-value]', card);
  try {
    if (event.target.closest('[data-reveal-key]')) {
      const key = await api(`/admin/local-keys/${id}`);
      const shown = field.type === 'text';
      field.type = shown ? 'password' : 'text';
      field.value = shown ? MASK : key.key;
      event.target.closest('[data-reveal-key]').textContent = shown ? 'Show' : 'Hide';
      return;
    }
    if (event.target.closest('[data-copy-key]')) {
      const key = await api(`/admin/local-keys/${id}`);
      await copy(key.key, 'Local key copied');
      return;
    }
    if (event.target.closest('[data-rotate-key]')) {
      if (!confirm('Rotate this local key? Apps using its old value will stop working.')) return;
      const key = await api(`/admin/local-keys/${id}/rotate`, { method: 'POST' });
      field.type = 'text';
      field.value = key.key;
      await copy(key.key, 'Rotated local key copied');
      await refresh();
      return;
    }
    if (event.target.closest('[data-save-key-target]')) {
      const type = $('[data-key-target-type]', card).value;
      const target = $('[data-key-target-id]', card).value;
      const harnessId = $('[data-key-harness]', card).value;
      await api(`/admin/local-keys/${id}`, { method: 'POST', body: JSON.stringify({ target: { type, id: target }, harnessId }) });
      await refresh();
      toast('Key routing and Harness saved');
      return;
    }
    if (event.target.closest('[data-delete-key]')) {
      if (!confirm('Delete this local key?')) return;
      await api(`/admin/local-keys/${id}`, { method: 'DELETE' });
      await refresh();
      toast('Local key deleted');
    }
  } catch (error) { toast(error.message, true); }
});

// ── snippets ─────────────────────────────────────────────────────────

let activeSnippet = 'ui';
$$('#snippetTabs .tab').forEach((tab) =>
  tab.addEventListener('click', () => {
    activeSnippet = tab.dataset.snip;
    $$('#snippetTabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
    renderSnippet();
  })
);

function renderSnippet() {
  const key = revealed && accessKeyValue ? accessKeyValue : 'YOUR_ACCESS_KEY';
  const base = `${ORIGIN}/v1`;
  const c = (s) => `<span class="c">${esc(s)}</span>`;
  const k = (s) => `<span class="k">${esc(s)}</span>`;
  const s = (t) => `<span class="s">${esc(t)}</span>`;

  const snippets = {
    curl: `curl ${esc(base)}/chat/completions \\
  -H ${s(`"Authorization: Bearer ${key}"`)} \\
  -H ${s('"Content-Type: application/json"')} \\
  -d ${s(`'{"model":"auto","messages":[{"role":"user","content":"hello"}]}'`)}`,

    python: `${k('from')} openai ${k('import')} OpenAI

client = OpenAI(
    base_url=${s(`"${base}"`)},
    api_key=${s(`"${key}"`)},
)

r = client.chat.completions.create(
    model=${s('"auto"')},   ${c('# let the chain choose')}
    messages=[{${s('"role"')}: ${s('"user"')}, ${s('"content"')}: ${s('"hello"')}}],
)
${k('print')}(r.choices[0].message.content)`,

    node: `${k('import')} OpenAI ${k('from')} ${s("'openai'")};

${k('const')} client = ${k('new')} OpenAI({
  baseURL: ${s(`'${base}'`)},
  apiKey: ${s(`'${key}'`)},
});

${k('const')} r = ${k('await')} client.chat.completions.create({
  model: ${s("'auto'")},
  messages: [{ role: ${s("'user'")}, content: ${s("'hello'")} }],
});
console.log(r.choices[0].message.content);`,

    env: `${c('# Most tools read these directly.')}
OPENAI_BASE_URL=${esc(base)}
OPENAI_API_KEY=${esc(key)}

${c('# Some expect the older name:')}
OPENAI_API_BASE=${esc(base)}`,

    ui: `${c('Any editor assistant or GUI with a custom OpenAI endpoint:')}

  Provider    OpenAI compatible ${c('(or "OpenRouter", same wire format)')}
  Base URL    ${esc(base)}
  API key     ${esc(key)}
  Model       auto

${c('"auto" walks the whole chain. Naming a specific model from the')}
${c('Chain page pins it to links serving that model.')}`,
  };

  $('#snippet').innerHTML = snippets[activeSnippet];
}

// ── Start Menu shortcut ──────────────────────────────────────────────

async function loadShortcutPrompt() {
  let status;
  try {
    status = await api('/admin/shortcut');
  } catch {
    return;
  }
  const show = status.eligible && !status.exists && !status.state;
  $('#shortcutPrompt').classList.toggle('hidden', !show);
}

$('#btnShortcutCreate').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    await api('/admin/shortcut/create', { method: 'POST' });
    $('#shortcutPrompt').classList.add('hidden');
    toast('Shortcut added to the Start Menu');
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
});

$('#btnShortcutDismiss').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    await api('/admin/shortcut/dismiss', { method: 'POST' });
    $('#shortcutPrompt').classList.add('hidden');
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
});

// ── boot ─────────────────────────────────────────────────────────────

async function refresh({ preserveHarnessEditor = false } = {}) {
  state = await api('/admin/state');
  renderOverview();
  renderProviders();
  renderChain();
  renderAccess();
  if (!preserveHarnessEditor) renderHarness();
  renderSnippet();
  $('#serverDot').style.color = 'var(--success)';
  $('#serverStatus').textContent = `running · ${state.stats.uptimeSeconds}s`;
}

refresh().catch((err) => {
  $('#serverDot').style.color = 'var(--danger)';
  $('#serverStatus').textContent = 'unreachable';
  toast(err.message, true);
});
loadShortcutPrompt();

setInterval(() => refresh({ preserveHarnessEditor: $('#page-harness').classList.contains('active') }).catch(() => {}), 10_000);
