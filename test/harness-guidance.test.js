import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

const appJs = read('src', 'webui', 'app.js');
const appCss = read('src', 'webui', 'app.css');

/** The eight instruction components, plus the defaults that need explaining. */
const INSTRUCTION_COMPONENTS = [
  'identity', 'operatingInstructions', 'safetyPolicy', 'toolPolicy',
  'reasoningPolicy', 'outputStyle', 'behavioralMode', 'persona',
];
const OTHER_FIELDS = [
  'temperature', 'top_p', 'top_k', 'max_tokens', 'effort',
  'stream', 'service_tier', 'user_id', 'aliases', 'headers',
];

test('every Harness field has a guide, and instruction components also say what does not belong', () => {
  const guide = appJs.slice(appJs.indexOf('const HARNESS_GUIDE'), appJs.indexOf('const HARNESS_SECTIONS'));
  assert.ok(guide.length > 0, 'HARNESS_GUIDE is missing');

  for (const key of [...INSTRUCTION_COMPONENTS, ...OTHER_FIELDS]) {
    assert.match(guide, new RegExp(`\\b${key}:\\s*\\{`), `no guide entry for ${key}`);
  }
  // The belongs/avoid pair is what keeps text out of the wrong component, so it
  // is required for the eight fields a preset can actually be applied to.
  for (const key of INSTRUCTION_COMPONENTS) {
    const entry = guide.slice(guide.indexOf(`${key}: {`));
    const body = entry.slice(0, entry.indexOf('},'));
    assert.match(body, /guide:/, `${key} has no guide line`);
    assert.match(body, /detail:/, `${key} has no tooltip detail`);
    assert.match(body, /belongs:/, `${key} does not say what belongs in it`);
    assert.match(body, /avoid:/, `${key} does not say what to keep out of it`);
  }
});

test('tooltips dismiss themselves after three seconds', () => {
  assert.match(appJs, /const TOOLTIP_MS = 3000;/);
  assert.match(appJs, /tooltipTimer = setTimeout\(hideTooltip, TOOLTIP_MS\)/);
  // A second trigger must cancel the pending timer rather than race it.
  assert.match(appJs, /clearTimeout\(tooltipTimer\);\s*\n\s*tooltipTimer = setTimeout/);
  assert.match(appCss, /\.field-tooltip\b/);
  assert.match(appCss, /\.field-tooltip\.visible\b/);
});

test('instruction components can browse presets scoped to themselves', () => {
  assert.match(appJs, /function browsePresetsFor\(componentKey\)/);
  assert.match(appJs, /presetLibrary\.component = componentKey;/);
  assert.match(appJs, /data-browse-presets=/);
  // Only the eight text components get the affordance; a number field has no
  // preset corpus behind it.
  assert.match(appJs, /field\.scope === 'components' && field\.type === 'textarea'/);
});

test('a preset applied to the wrong component warns instead of applying silently', () => {
  assert.match(appJs, /const isMismatched = \(entry, target\) =>/);
  assert.match(appJs, /entry\.suggestedComponent !== target/);
  assert.match(appJs, /function mismatchNotice\(entry, target\)/);
  assert.match(appJs, /class="preset-mismatch" role="alert"/);
  assert.match(appJs, /Apply anyway/);
  // Mismatch is a warning, not a block: it must still be possible to proceed.
  assert.match(appJs, /if \(isMismatched\(presetLibrary\.selected, target\)/);
  assert.match(appJs, /anyway\?\`\)\) return;/);
  assert.match(appCss, /\.preset-mismatch\b/);
});

test('the Harness reference documents every component', () => {
  const doc = read('docs', 'HARNESS.md');
  for (const label of [
    'Identity', 'Operating instructions', 'Safety policy', 'Tool policy',
    'Reasoning policy', 'Output style', 'Behavioral mode', 'Persona',
  ]) {
    assert.ok(doc.includes(label), `HARNESS.md does not cover ${label}`);
  }
  assert.match(doc, /three seconds/);
  assert.match(doc, /Browse presets/);
  assert.match(doc, /mismatch warning/i);
  assert.match(doc, /classification is a guess/i);
  assert.match(read('README.md'), /docs\/HARNESS\.md/);
});
