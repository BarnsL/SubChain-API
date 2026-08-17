import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const HARNESS_FILE = path.join(ROOT, 'harness.config.json');

const DEFAULTS = {
  systemPrompts: { identity: 'auto', operatingInstructions: '', behavioralMode: 'auto', persona: '' },
  generation: { temperature: null, top_p: null, top_k: null, max_tokens: null, stop_sequences: [], effort: null },
  thinking: { type: null, budget_tokens: null, display: null },
  tools: { tool_choice: null, parallel_tool_use: null, allowlist: [] },
  infrastructure: { stream: null, service_tier: null, user_id: null },
  aliases: {},
  headers: {},
};

export function loadHarness(file = HARNESS_FILE) {
  if (!fs.existsSync(file)) return { ...DEFAULTS };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveHarness(config, file = HARNESS_FILE) {
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

export function applyHarnessConfig(body, harness) {
  const next = { ...body, messages: Array.isArray(body.messages) ? [...body.messages] : body.messages };

  if (harness.aliases?.[next.model]) {
    next.model = harness.aliases[next.model];
  }

  const gen = harness.generation || {};
  if (gen.temperature !== null && gen.temperature !== undefined && next.temperature === undefined) next.temperature = gen.temperature;
  if (gen.top_p !== null && gen.top_p !== undefined && next.top_p === undefined) next.top_p = gen.top_p;
  if (gen.top_k !== null && gen.top_k !== undefined && next.top_k === undefined) next.top_k = gen.top_k;
  if (gen.max_tokens !== null && gen.max_tokens !== undefined && next.max_tokens === undefined) next.max_tokens = gen.max_tokens;
  if (gen.stop_sequences?.length && !next.stop) next.stop = gen.stop_sequences;

  if (harness.infrastructure?.stream !== null && harness.infrastructure?.stream !== undefined && next.stream === undefined) {
    next.stream = harness.infrastructure.stream;
  }

  const prompts = [harness.systemPrompts?.operatingInstructions, harness.systemPrompts?.persona]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim());
  if (prompts.length && Array.isArray(next.messages)) {
    next.messages.unshift({ role: 'system', content: prompts.join('\n\n') });
  }

  return next;
}

export function applyHarness(body) {
  return applyHarnessConfig(body, loadHarness());
}
