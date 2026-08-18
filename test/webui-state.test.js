import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const module = await import('../src/webui/ui-state.js');
const { createHarnessExpansionState } = module;

test('harness expansion state survives dashboard refreshes and reloads', () => {
  assert.equal(typeof createHarnessExpansionState, 'function', 'persistent harness state must exist');
  if (!createHarnessExpansionState) return;
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const first = createHarnessExpansionState(storage);
  assert.equal(first.isExpanded('generation'), false);
  first.setExpanded('generation', true);
  assert.equal(first.isExpanded('generation'), true);

  const reloaded = createHarnessExpansionState(storage);
  assert.equal(reloaded.isExpanded('generation'), true);
});

test('operator Logs sits between Harness and Chat with scoped routing and privacy states', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src', 'webui', 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(ROOT, 'src', 'webui', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'src', 'webui', 'app.css'), 'utf8');

  assert.match(html, /data-page="chain"[\s\S]*?Chain[\s\S]*?<\/button>\s*<button class="nav-item" data-page="harness"[\s\S]*?Harness[\s\S]*?<\/button>\s*<button class="nav-item" data-page="logs"[\s\S]*?Logs[\s\S]*?<\/button>\s*<button class="nav-item" data-page="chat"[\s\S]*?Chat[\s\S]*?<\/button>/);
  for (const id of ['page-logs', 'logSummary', 'logFilters', 'logStatus', 'logRows', 'logEmpty', 'logError', 'btnLogsRefresh', 'btnLogsPause', 'btnLogsClear']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing Logs UI anchor #${id}`);
  }
  for (const field of ['localKey', 'target', 'harness', 'transport', 'provider', 'app', 'route', 'status', 'q']) {
    assert.match(html, new RegExp(`name="${field}"`), `missing operator filter ${field}`);
  }
  // The standing "metadata only" reassurance was removed on request. What must
  // survive is the inverse: the callout stays hidden while nothing raw is written
  // and app.js reveals it the moment retention is switched on, so the page can
  // never stay silent about prompts or keys landing on disk.
  assert.match(html, /id="logRetentionNotice"/);
  assert.match(html, /id="logRetentionCallout" *class=|class="callout warn hidden" id="logRetentionCallout"/);
  assert.doesNotMatch(html, /Raw prompts, responses, Harness bodies, preset bodies, tool bodies, and credentials are never stored/i);
  assert.match(appJs, /function renderRetentionNotice/);
  assert.match(appJs, /Retention is on\./);
  assert.match(appJs, /callout\.classList\.remove\('hidden'\)/);
  assert.match(appJs, /callout\.classList\.add\('hidden'\)/);
  assert.match(appJs, /globalThis\.renderRetentionNotice/);
  assert.match(html, /exact/i);
  assert.match(html, /estimated/i);
  assert.match(appJs, /async function refreshLogs/);
  assert.match(appJs, /logsPaused/);
  assert.match(appJs, /data-request-id/);
  assert.doesNotMatch(appJs, /log-record-summary" aria-label=/);
  assert.match(appJs, /\/admin\/logs/);
  assert.match(appJs, /10_000/);
  assert.match(appJs, /X-SubChain-App/);
  assert.match(appJs, /X-SubChain-Session-Id/);
  assert.match(css, /\.log-filters/);
  assert.match(css, /\.log-record/);
  assert.match(css, /\.log-detail/);
  // Container-driven, not viewport-driven: a fixed column count squeezed the
  // tiles whenever the sidebar narrowed the content column above the breakpoint.
  assert.match(css, /\.log-summary\s*\{[\s\S]*repeat\(auto-fit, minmax\(\d+px,/);
  assert.match(css, /\.log-filters\s*\{[\s\S]*repeat\(auto-fit, minmax\(\d+px,/);
  assert.match(css, /max-width:\s*880px[\s\S]*\.nav-item\s*\{[\s\S]*width:\s*auto/);
});
