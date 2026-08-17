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
    toast('Clipboard blocked — select and copy manually', true);
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
  $('#statReady').textContent = totals.ready;
  $('#statReadySub').textContent = `of ${totals.links} chain links`;
  $('#statCandidates').textContent = totals.candidates;
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
        <div class="stat-value" style="font-size:22px">${q ? `${usagePct}%` : (ok ? 'idle' : '—')}</div>
        <div class="stat-sub">${p.linkCount} model(s) in chain · ${esc(p.jurisdiction)}</div>
        ${usageBar}
      </div>`;
    })
    .join('');

  $('#coolingBox').innerHTML = cooling.length
    ? `<div class="table-wrap"><table><thead><tr><th>Candidate</th><th>Last error</th><th>Retry in</th></tr></thead><tbody>${cooling
        .map(
          (c) =>
            `<tr><td class="mono">${esc(c.id)}</td><td style="color:var(--muted-foreground)">${esc(c.lastError || '—')}</td><td class="num">${c.secondsRemaining}s</td></tr>`
        )
        .join('')}</tbody></table></div>`
    : `<div class="card" style="color:var(--muted-foreground);font-size:13px">Nothing cooling off. Every configured candidate is available.</div>`;
}

// ── providers ────────────────────────────────────────────────────────

function renderProviders() {
  $('#providerList').innerHTML = state.providers
    .map((p) => {
      const credBadge = p.hasCredential
        ? `<span class="badge badge-ok"><span class="dot"></span>detected</span>`
        : `<span class="badge badge-warn"><span class="dot"></span>missing</span>`;

      const q = p.quota;
      const quotaInfo = q
        ? `<div style="margin-top:12px">
            <div style="font-size:12px;color:var(--muted-foreground)">Usage: ${q.usagePercent}%${q.resetIn ? ` · resets in ${q.resetIn}s` : ''}${q.isExhausted ? ' · EXHAUSTED' : ''}</div>
            <div class="progress-bar"><div class="progress-fill ${progressClass(q.usagePercent)}" style="width:${q.usagePercent}%"></div></div>
          </div>`
        : '';

      const siteLink = p.subscriptionUrl
        ? `<a class="btn btn-sm btn-ghost" href="${esc(p.subscriptionUrl)}" target="_blank" rel="noopener noreferrer">${icon.ext} Manage subscription</a>`
        : '';

      return `<div class="card provider">
        <div class="provider-head">
          <div>
            <div class="provider-title">
              <h2>${esc(p.label)}</h2>
              ${credBadge}
              ${p.linkCount ? `<span class="badge badge-sub">${p.linkCount} model(s) in chain</span>` : `<span class="badge">not in chain</span>`}
            </div>
            <div class="provider-meta">
              <span class="mono">${esc(p.baseUrl)}</span>
              · ${esc(p.authType)} · ctx ${(p.contextWindow / 1000).toFixed(0)}K · ${esc(p.jurisdiction)}
            </div>
          </div>
          <div class="provider-actions">${siteLink}</div>
        </div>
        ${quotaInfo}
      </div>`;
    })
    .join('');
}

// ── chains ────────────────────────────────────────────────────────────

const MODEL_OPTIONS = {
  anthropic: ['claude-sonnet-4-6', 'claude-opus-4-6'],
  'openai-codex': ['gpt-5', 'gpt-4.1'],
  kimi: ['kimi-k2.5', 'kimi-for-coding'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  zhipu: ['glm-5', 'glm-4.7-flash'],
  sakana: ['fugu-ultra-v1.1', 'fugu'],
};

function providerOptions(selected) {
  return state.providers.map((provider) =>
    `<option value="${esc(provider.id)}" ${provider.id === selected ? 'selected' : ''}>${esc(provider.label)}</option>`
  ).join('');
}

function modelOptions(provider, selected) {
  const available = MODEL_OPTIONS[provider] || [];
  const models = selected && !available.includes(selected) ? [selected, ...available] : available;
  return models.map((model) => `<option value="${esc(model)}" ${model === selected ? 'selected' : ''}>${esc(model)}</option>`).join('');
}

function renderChain() {
  const providerSelect = $('#newChainProvider');
  const modelSelect = $('#newChainModel');
  providerSelect.innerHTML = providerOptions(providerSelect.value || state.providers[0]?.id);
  const firstProvider = providerSelect.value || state.providers[0]?.id;
  const preferredModel = MODEL_OPTIONS[firstProvider]?.includes(modelSelect.value)
    ? modelSelect.value
    : MODEL_OPTIONS[firstProvider]?.[0];
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
        <label class="form-field grow">Model<select class="input" name="model">${modelOptions(firstProvider, MODEL_OPTIONS[firstProvider]?.[0])}</select></label>
        <button class="btn btn-sm" type="submit" ${atLimit ? 'disabled' : ''}>Add link</button>
      </form>
    </article>`;
  }).join('');
}

$('#newChainProvider').addEventListener('change', (event) => {
  $('#newChainModel').innerHTML = modelOptions(event.target.value, MODEL_OPTIONS[event.target.value]?.[0]);
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
  model.innerHTML = modelOptions(select.value, MODEL_OPTIONS[select.value]?.[0]);
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

const HARNESS_SECTIONS = [
  { key: 'systemPrompts', label: 'System Prompts', fields: [
    { key: 'identity', label: 'Identity', type: 'select', options: ['auto', 'custom'] },
    { key: 'operatingInstructions', label: 'Operating Instructions', type: 'textarea' },
    { key: 'behavioralMode', label: 'Behavioral Mode', type: 'select', options: ['auto', 'custom'] },
    { key: 'persona', label: 'Persona', type: 'textarea' },
  ]},
  { key: 'generation', label: 'Generation', fields: [
    { key: 'temperature', label: 'Temperature', type: 'number', min: 0, max: 2, step: 0.1 },
    { key: 'top_p', label: 'Top P', type: 'number', min: 0, max: 1, step: 0.05 },
    { key: 'top_k', label: 'Top K', type: 'number', min: 0, max: 100, step: 1 },
    { key: 'max_tokens', label: 'Max Tokens', type: 'number', min: 0, max: 100000, step: 100 },
    { key: 'effort', label: 'Effort', type: 'select', options: ['', 'low', 'medium', 'high'] },
  ]},
  { key: 'thinking', label: 'Thinking', fields: [
    { key: 'type', label: 'Type', type: 'select', options: ['', 'enabled', 'disabled'] },
    { key: 'budget_tokens', label: 'Budget Tokens', type: 'number', min: 0, max: 100000, step: 100 },
  ]},
  { key: 'infrastructure', label: 'Infrastructure', fields: [
    { key: 'stream', label: 'Stream', type: 'select', options: ['', 'true', 'false'] },
    { key: 'service_tier', label: 'Service Tier', type: 'select', options: ['', 'auto', 'default'] },
  ]},
  { key: 'aliases', label: 'Model Aliases', type: 'json' },
  { key: 'headers', label: 'Custom Headers', type: 'json' },
];

function renderHarness() {
  const harness = state.harness || {};

  $('#harnessConfig').innerHTML = HARNESS_SECTIONS.map((section) => {
    let bodyHtml;

    if (section.type === 'json') {
      const val = harness[section.key] || {};
      bodyHtml = `<div class="harness-field">
        <label>${esc(section.label)} (JSON object)</label>
        <textarea class="mono" data-harness-json="${esc(section.key)}" rows="4">${esc(JSON.stringify(val, null, 2))}</textarea>
      </div>`;
    } else {
      bodyHtml = section.fields.map((f) => {
        const val = harness[section.key]?.[f.key];
        if (f.type === 'textarea') {
          return `<div class="harness-field">
            <label>${esc(f.label)}</label>
            <textarea data-harness-section="${esc(section.key)}" data-harness-field="${esc(f.key)}">${esc(val || '')}</textarea>
          </div>`;
        }
        if (f.type === 'select') {
          const opts = f.options.map((o) =>
            `<option value="${esc(o)}" ${(val === o || (val === null && o === '')) ? 'selected' : ''}>${esc(o || '(default)')}</option>`
          ).join('');
          return `<div class="harness-field">
            <label>${esc(f.label)}</label>
            <select class="input" data-harness-section="${esc(section.key)}" data-harness-field="${esc(f.key)}">${opts}</select>
          </div>`;
        }
        if (f.type === 'number') {
          return `<div class="harness-field">
            <label>${esc(f.label)}</label>
            <input class="input" type="number" data-harness-section="${esc(section.key)}" data-harness-field="${esc(f.key)}"
              value="${val !== null && val !== undefined ? val : ''}"
              ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} ${f.step ? `step="${f.step}"` : ''} placeholder="null" />
          </div>`;
        }
        return '';
      }).join('');
    }

    return `<div class="harness-section">
      <div class="harness-toggle ${harnessExpansion.isExpanded(section.key) ? 'open' : ''}" data-toggle="${esc(section.key)}">
        <h3>${esc(section.label)}</h3>
        ${icon.chevDown}
      </div>
      <div class="harness-body ${harnessExpansion.isExpanded(section.key) ? '' : 'collapsed'}" id="harness-${esc(section.key)}">
        ${bodyHtml}
      </div>
    </div>`;
  }).join('');
}

// Toggle harness sections
$('#harnessConfig').addEventListener('click', (e) => {
  const toggle = e.target.closest('.harness-toggle');
  if (!toggle) return;
  const key = toggle.dataset.toggle;
  const body = $(`#harness-${CSS.escape(key)}`);
  body.classList.toggle('collapsed');
  toggle.classList.toggle('open');
  harnessExpansion.setExpanded(key, !body.classList.contains('collapsed'));
});

// Save harness on change (debounced)
let harnessDebounce;
$('#harnessConfig').addEventListener('input', () => {
  clearTimeout(harnessDebounce);
  harnessDebounce = setTimeout(saveHarness, 800);
});
$('#harnessConfig').addEventListener('change', () => {
  clearTimeout(harnessDebounce);
  saveHarness();
});

async function saveHarness() {
  const harness = state.harness || {};

  // Collect section fields
  $$('[data-harness-section]').forEach((el) => {
    const section = el.dataset.harnessSection;
    const field = el.dataset.harnessField;
    if (!harness[section]) harness[section] = {};
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
    harness[section][field] = val;
  });

  // Collect JSON fields
  $$('[data-harness-json]').forEach((el) => {
    try {
      harness[el.dataset.harnessJson] = JSON.parse(el.value);
    } catch {
      // leave unchanged on invalid JSON
    }
  });

  try {
    await api('/admin/harness', { method: 'POST', body: JSON.stringify(harness) });
    state.harness = harness;
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

function renderAccess() {
  const form = $('#addLocalKeyForm');
  const type = form.elements.targetType.value;
  $('#newKeyTarget').innerHTML = destinationOptions(type, $('#newKeyTarget').value);
  $('#localKeyList').innerHTML = state.localKeys.map((localKey) => `<article class="card local-key-card" data-local-key="${esc(localKey.id)}">
    <div class="row-between local-key-head"><div><h2>${esc(localKey.name)}</h2><p>Required on every request to <span class="mono">/v1/*</span> made with this key.</p></div><span class="badge ${localKey.hasToken ? 'badge-ok' : 'badge-warn'}"><span class="dot"></span>${localKey.hasToken ? 'active' : 'missing'}</span></div>
    <div class="keyfield"><input type="password" value="${MASK}" readonly spellcheck="false" data-key-value /><button class="btn btn-ghost btn-sm" data-reveal-key>Show</button><button class="btn btn-sm" data-copy-key>Copy</button><button class="btn btn-sm" data-rotate-key>Rotate</button></div>
    <div class="form-row local-key-target"><label class="form-field">Feeds<select class="input" data-key-target-type><option value="chain" ${localKey.target.type === 'chain' ? 'selected' : ''}>a chain</option><option value="provider" ${localKey.target.type === 'provider' ? 'selected' : ''}>one provider</option></select></label><label class="form-field grow">Destination<select class="input" data-key-target-id>${destinationOptions(localKey.target.type, localKey.target.id)}</select></label><button class="btn btn-sm" data-save-key-target>Save destination</button>${localKey.id === 'default' ? '' : '<button class="btn btn-ghost btn-sm btn-danger" data-delete-key>Delete</button>'}</div>
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
    const result = await api('/admin/local-keys', { method: 'POST', body: JSON.stringify({ name: form.get('name'), target: { type: form.get('targetType'), id: form.get('targetId') } }) });
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
      await api(`/admin/local-keys/${id}`, { method: 'POST', body: JSON.stringify({ target: { type, id: target } }) });
      await refresh();
      toast('Key destination saved');
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

  Provider    OpenAI compatible ${c('(or "OpenRouter" — same wire format)')}
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

async function refresh() {
  state = await api('/admin/state');
  renderOverview();
  renderProviders();
  renderChain();
  renderAccess();
  renderHarness();
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

setInterval(() => refresh().catch(() => {}), 10_000);
