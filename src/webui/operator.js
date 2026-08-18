// Chat page for the SubChain dashboard.
//
// This runs alongside app.js inside index.html rather than on its own page, so
// every id here is namespaced `op*` to stay clear of the dashboard's own ids.
// It talks only to /admin/operator/*, which the server restricts to loopback.
//
// Nothing here applies a change on its own: the model can only ever produce a
// pending proposal, and the confirm button is the one thing that reaches the
// server's executor.

const opEl = (id) => document.getElementById(id);
const opEsc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

/** Checkbox id → log-policy key. Order matches the Settings card. */
const OP_LOG_FLAGS = [
  ['opPromptSummary', 'promptSummary'],
  ['opRawPrompts', 'rawPrompts'],
  ['opRawResponses', 'rawResponses'],
  ['opRawToolBodies', 'rawToolBodies'],
  ['opCredentials', 'credentials'],
];

let opHistory = [];
let opLoaded = false;
let opBusy = false;

async function opApi(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
}

/**
 * Mirror the operator's appearance preferences onto the dashboard. The data
 * attributes and custom property must match the `[data-operator-*]` rules in
 * app.css, otherwise saving a preference silently does nothing.
 */
function opApplyAppearance(ui = {}) {
  const theme = ui.theme === 'system'
    ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : (ui.theme || 'dark');
  document.documentElement.dataset.operatorTheme = theme;
  document.documentElement.dataset.operatorFont = ui.fontFamily || 'system';
  document.documentElement.dataset.operatorDensity = ui.density || 'comfortable';
  document.documentElement.style.setProperty('--operator-scale', Number(ui.fontScale) || 1);
}

function opBubble(role, text) {
  const node = document.createElement('div');
  node.className = `op-bubble ${role === 'user' ? 'user' : 'assistant'}`;
  node.textContent = text;
  const log = opEl('opMessages');
  log.append(node);
  log.scrollTop = log.scrollHeight;
}

function opSetStatus(text) {
  const node = opEl('opStatus');
  if (node) node.textContent = text;
}

function opRenderPending(actions = []) {
  opEl('opPending').innerHTML = actions.map((action) => `
    <div class="op-pending">
      <div class="op-pending-head">
        <span class="badge badge-warn">Confirmation required</span>
        <span class="mono">${opEsc(action.tool)}</span>
      </div>
      <strong>${opEsc(action.description || action.tool)}</strong>
      <p>${opEsc(action.reason)}</p>
      <div class="op-actions">
        <button class="btn btn-primary btn-sm" type="button" data-op-confirm="${opEsc(action.id)}">Confirm</button>
        <button class="btn btn-ghost btn-sm" type="button" data-op-reject="${opEsc(action.id)}">Reject</button>
      </div>
    </div>`).join('');
}

function opRenderLinks(items = []) {
  opEl('opLinks').innerHTML = items.map((item) =>
    `<a href="${opEsc(item.url)}" target="_blank" rel="noopener noreferrer">${opEsc(item.label)}</a>`).join('');
}

function opRenderDoctor(checks = []) {
  opEl('opDoctor').innerHTML = checks.length ? checks.map((check) => `
    <div class="stat">
      <div class="op-stat-head">
        <div class="stat-label">${opEsc(check.id)}</div>
        <span class="badge ${check.status === 'ok' ? 'badge-ok' : check.status === 'warn' ? 'badge-warn' : check.status === 'info' ? 'badge-ok' : 'badge-err'}">${opEsc(check.status)}</span>
      </div>
      <div class="op-stat-message">${opEsc(check.message)}</div>
      <div class="stat-sub">${opEsc(check.recommendation || '')}</div>
    </div>`).join('') : '<div class="stat"><div class="stat-label">doctor</div><div class="stat-sub">No checks reported.</div></div>';
}

function opRenderSecurity(findings = []) {
  opEl('opSecurity').innerHTML = findings.length ? findings.map((finding) => `
    <div class="card op-finding">
      <div class="op-pending-head">
        <span class="badge ${finding.severity === 'high' ? 'badge-err' : finding.severity === 'medium' ? 'badge-warn' : 'badge-ok'}">${opEsc(finding.severity)}</span>
        <strong>${opEsc(finding.title)}</strong>
      </div>
      <p>${opEsc(finding.evidence)}</p>
      <div class="stat-sub">${opEsc(finding.recommendation)}</div>
    </div>`).join('') : '<div class="card op-finding"><div class="stat-sub">No findings yet.</div></div>';
}

function opRenderProviders(providers = []) {
  opEl('opProviders').innerHTML = providers.map((provider) => `
    <div class="card op-provider">
      <div class="provider-head">
        <div>
          <div class="provider-title">
            <strong>${opEsc(provider.label || provider.provider)}</strong>
            <span class="badge ${provider.found ? 'badge-ok' : 'badge-warn'}">${provider.found ? 'credential detected' : 'not detected'}</span>
          </div>
          <div class="provider-meta">
            ${opEsc(provider.authType || '')} · ${opEsc(provider.transport || '')}${provider.sources?.length ? ` · ${opEsc(provider.sources.join(', '))}` : ''}
          </div>
          ${provider.notes ? `<div class="provider-meta">${opEsc(provider.notes)}</div>` : ''}
        </div>
        ${provider.url ? `<div class="op-links"><a href="${opEsc(provider.url)}" target="_blank" rel="noopener noreferrer">Open official setup</a></div>` : ''}
      </div>
      ${provider.authType === 'api-key' ? `
        <div class="op-compose">
          <input class="input" type="password" autocomplete="off" placeholder="Paste key directly — never sent to the model" data-op-provider-key="${opEsc(provider.provider)}" />
          <button class="btn" type="button" data-op-save-provider="${opEsc(provider.provider)}">Save key</button>
        </div>` : ''}
    </div>`).join('');
}

async function opRefreshContext() {
  const context = await opApi('/admin/operator/context');
  // The specialization blurb was dropped from the status line by request; this
  // element now carries only live action feedback (saves, failures, policy changes).
  opSetStatus('Operator ready.');
  opRenderDoctor(context.doctor?.checks || []);
  opRenderSecurity(context.security?.findings || []);
  opRenderProviders(context.providerHelp || []);
}

async function opLoadSettings() {
  const settings = await opApi('/admin/operator/settings');
  opApplyAppearance(settings.ui);
  opEl('opUseSelf').checked = Boolean(settings.assistant.useSelf);
  opEl('opBaseUrl').value = settings.assistant.baseUrl || '';
  opEl('opModel').value = settings.assistant.model || '';
  opEl('opTheme').value = settings.ui.theme;
  opEl('opFont').value = settings.ui.fontFamily;
  opEl('opScale').value = settings.ui.fontScale;
  opEl('opDensity').value = settings.ui.density;
  const logs = settings.logs || {};
  for (const [id, key] of OP_LOG_FLAGS) opEl(id).checked = Boolean(logs[key]);
  opEl('opMaxRawChars').value = logs.maxRawChars ?? 20000;
}

async function opSendMessage(text) {
  if (!text.trim() || opBusy) return;
  opBusy = true;
  opEl('opSend').disabled = true;
  opBubble('user', text);
  try {
    const reply = await opApi('/admin/operator/chat', {
      method: 'POST',
      body: JSON.stringify({ message: text, history: opHistory }),
    });
    opBubble('assistant', reply.message);
    opHistory.push({ role: 'user', content: text }, { role: 'assistant', content: reply.message });
    opHistory = opHistory.slice(-12);
    opRenderPending(reply.pending);
    opRenderLinks(reply.links);
  } catch (err) {
    opBubble('assistant', `Operator error: ${err.message}`);
  } finally {
    opBusy = false;
    opEl('opSend').disabled = false;
  }
}

/** Load on first visit only, so the page costs nothing until it is opened. */
async function opEnsureLoaded(force = false) {
  if (opLoaded && !force) return;
  opLoaded = true;
  try {
    await Promise.all([
      opLoadSettings(),
      opRefreshContext(),
      opApi('/admin/operator/pending').then((pending) => opRenderPending(pending.actions)),
    ]);
  } catch (err) {
    opSetStatus(`Operator unavailable: ${err.message}`);
  }
}

// ── wiring ────────────────────────────────────────────────────────────

document.querySelectorAll('[data-op-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-op-tab]').forEach((other) => other.classList.toggle('active', other === button));
    document.querySelectorAll('.op-panel').forEach((panel) =>
      panel.classList.toggle('active', panel.id === `op-tab-${button.dataset.opTab}`));
  });
});

document.querySelectorAll('[data-op-prompt]').forEach((button) => {
  button.addEventListener('click', () => opSendMessage(button.dataset.opPrompt));
});

opEl('opSend').addEventListener('click', () => {
  const input = opEl('opInput');
  const text = input.value;
  input.value = '';
  opSendMessage(text);
});

opEl('opInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    opEl('opSend').click();
  }
});

opEl('btnOpRefresh').addEventListener('click', () => opEnsureLoaded(true));

opEl('opSaveModel').addEventListener('click', async () => {
  try {
    await opApi('/admin/operator/settings', {
      method: 'POST',
      body: JSON.stringify({ assistant: {
        useSelf: opEl('opUseSelf').checked,
        baseUrl: opEl('opBaseUrl').value,
        model: opEl('opModel').value,
      } }),
    });
    await opLoadSettings();
    opSetStatus('Operator model settings saved.');
  } catch (err) {
    opSetStatus(`Could not save model settings: ${err.message}`);
  }
});

opEl('opSaveKey').addEventListener('click', async () => {
  const field = opEl('opKey');
  if (!field.value) return;
  try {
    await opApi('/admin/operator/key', { method: 'POST', body: JSON.stringify({ key: field.value }) });
    field.value = '';
    opSetStatus('Control-model key saved to .env. It is never shown to the model.');
  } catch (err) {
    opSetStatus(`Could not save the control-model key: ${err.message}`);
  }
});

opEl('opSaveUi').addEventListener('click', async () => {
  try {
    await opApi('/admin/operator/settings', {
      method: 'POST',
      body: JSON.stringify({ ui: {
        theme: opEl('opTheme').value,
        fontFamily: opEl('opFont').value,
        fontScale: Number(opEl('opScale').value),
        density: opEl('opDensity').value,
      } }),
    });
    await opLoadSettings();
    opSetStatus('Appearance saved.');
  } catch (err) {
    opSetStatus(`Could not save appearance: ${err.message}`);
  }
});

// Retention is opt-in rather than a silent default: even a bounded, redacted
// prompt summary is still caller content, and the raw switches are the caller's
// traffic verbatim.
opEl('opSaveLogs').addEventListener('click', async () => {
  const logs = Object.fromEntries(OP_LOG_FLAGS.map(([id, key]) => [key, opEl(id).checked]));
  logs.maxRawChars = Number(opEl('opMaxRawChars').value) || 20000;

  // Storing live local keys is the one switch here that can burn something
  // outside this machine, so it gets a second, explicit yes.
  if (logs.credentials && !opEl('opCredentials').dataset.confirmed) {
    if (!confirm(
      'Store presented credentials in clear text?\n\n'
      + 'Every local key a caller sends will be written to the request journal '
      + 'unredacted. Anyone who can read that file gets working keys.\n\n'
      + 'Only do this to diagnose a rejected key, then turn it off, rotate the key, '
      + 'and clear the journal.',
    )) {
      opEl('opCredentials').checked = false;
      return;
    }
    opEl('opCredentials').dataset.confirmed = '1';
  }
  if (!logs.credentials) delete opEl('opCredentials').dataset.confirmed;

  try {
    await opApi('/admin/operator/settings', { method: 'POST', body: JSON.stringify({ logs }) });
    await opLoadSettings();
    // The Logs page states the policy in force, so it has to be told when the
    // policy changes from here rather than waiting for a reload.
    globalThis.renderRetentionNotice?.(logs);
    const on = OP_LOG_FLAGS.filter(([id]) => opEl(id).checked).map(([, key]) => key);
    opSetStatus(on.length
      ? `Log policy saved. Retaining: ${on.join(', ')}.`
      : 'Log policy saved. Metadata only — no caller content is written to the journal.');
  } catch (err) {
    opSetStatus(`Could not save the log policy: ${err.message}`);
  }
});

document.addEventListener('click', async (event) => {
  const save = event.target.closest('[data-op-save-provider]');
  if (save) {
    const input = document.querySelector(`[data-op-provider-key="${CSS.escape(save.dataset.opSaveProvider)}"]`);
    if (!input?.value) return;
    try {
      await opApi('/admin/operator/provider-key', {
        method: 'POST',
        body: JSON.stringify({ provider: save.dataset.opSaveProvider, key: input.value }),
      });
      input.value = '';
      opSetStatus(`Saved the ${save.dataset.opSaveProvider} credential directly. It was never sent to the model.`);
      await opRefreshContext();
    } catch (err) {
      opSetStatus(`Credential save failed: ${err.message}`);
    }
    return;
  }

  const confirmBtn = event.target.closest('[data-op-confirm]');
  if (confirmBtn) {
    try {
      const out = await opApi('/admin/operator/confirm', {
        method: 'POST',
        body: JSON.stringify({ id: confirmBtn.dataset.opConfirm }),
      });
      opBubble('assistant', `Applied: ${out.action.description}`);
      opRenderPending((await opApi('/admin/operator/pending')).actions);
      await opRefreshContext();
    } catch (err) {
      opBubble('assistant', `Change failed: ${err.message}`);
    }
    return;
  }

  const rejectBtn = event.target.closest('[data-op-reject]');
  if (rejectBtn) {
    await opApi('/admin/operator/reject', { method: 'POST', body: JSON.stringify({ id: rejectBtn.dataset.opReject }) });
    opRenderPending((await opApi('/admin/operator/pending')).actions);
  }
});

// app.js owns page switching; hook the nav button so the operator only loads
// when the page is actually opened.
document.querySelector('.nav-item[data-page="chat"]')?.addEventListener('click', () => opEnsureLoaded());
if (document.getElementById('page-chat')?.classList.contains('active')) opEnsureLoaded();
