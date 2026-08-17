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

export function loadHarness() {
  if (!fs.existsSync(HARNESS_FILE)) return { ...DEFAULTS };
  try {
    const raw = JSON.parse(fs.readFileSync(HARNESS_FILE, 'utf8'));
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveHarness(config) {
  fs.writeFileSync(HARNESS_FILE, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

export function applyHarness(body) {
  const harness = loadHarness();

  if (harness.aliases[body.model]) {
    body.model = harness.aliases[body.model];
  }

  const gen = harness.generation;
  if (gen.temperature !== null && body.temperature === undefined) body.temperature = gen.temperature;
  if (gen.top_p !== null && body.top_p === undefined) body.top_p = gen.top_p;
  if (gen.top_k !== null && body.top_k === undefined) body.top_k = gen.top_k;
  if (gen.max_tokens !== null && body.max_tokens === undefined) body.max_tokens = gen.max_tokens;
  if (gen.stop_sequences?.length && !body.stop) body.stop = gen.stop_sequences;

  if (harness.infrastructure.stream !== null && body.stream === undefined) {
    body.stream = harness.infrastructure.stream;
  }

  return body;
}
