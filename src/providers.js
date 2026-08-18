export const ACCOUNT_SLOTS = 10;
export const MAX_KEYS_PER_ACCOUNT = 10;

export const envBaseFor = (id) =>
  `SUBCHAIN_${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;

const BASE_PROVIDERS = {
  anthropic: {
    label: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    authType: 'oauth-bearer',
    transport: 'http',
    transform: 'anthropic',
    contextWindow: 200_000,
    vendorEnv: [],
    subscriptionUrl: 'https://console.anthropic.com',
    jurisdiction: 'United States',
    fallbackModels: [
      'claude-fable-5', 'claude-haiku-4-5-20251001', 'claude-opus-4-5-20251101',
      'claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-opus-5',
      'claude-sonnet-4-5-20250929', 'claude-sonnet-4-6', 'claude-sonnet-5',
    ],
  },
  'openai-codex': {
    label: 'OpenAI Codex subscription',
    baseUrl: 'managed://codex',
    authType: 'managed-subscription',
    transport: 'codex-app-server',
    transform: null,
    contextWindow: 400_000,
    vendorEnv: [],
    accountSlots: false,
    subscriptionUrl: 'https://chatgpt.com/#settings/Subscription',
    jurisdiction: 'United States',
    fallbackModels: [
      'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4',
      'gpt-5.4-mini', 'gpt-5.3-codex-spark',
    ],
  },
  'openai-api': {
    label: 'OpenAI API',
    baseUrl: 'https://api.openai.com/v1',
    authType: 'api-key',
    transport: 'http',
    transform: null,
    contextWindow: 400_000,
    vendorEnv: ['OPENAI_API_KEY'],
    subscriptionUrl: 'https://platform.openai.com',
    jurisdiction: 'United States',
    fallbackModels: [
      'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4',
      'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.3-codex',
    ],
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    authType: 'api-key',
    transport: 'http',
    transform: null,
    contextWindow: 1_000_000,
    vendorEnv: ['OPENROUTER_API_KEY'],
    subscriptionUrl: 'https://openrouter.ai/settings/keys',
    jurisdiction: 'United States',
    fallbackModels: [],
  },
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    authType: 'api-key',
    transport: 'http',
    transform: null,
    contextWindow: 262_144,
    vendorEnv: ['GROQ_API_KEY'],
    subscriptionUrl: 'https://console.groq.com/keys',
    jurisdiction: 'United States',
    fallbackModels: [],
  },
  // Dario is deliberately modelled as a local provider seam. Dario owns its own
  // Claude subscription, OAuth and wire fidelity; SubChain consumes only its
  // stable OpenAI-compatible interface and never copies its session material.
  dario: {
    label: 'Dario local subscription proxy',
    baseUrl: 'http://127.0.0.1:3456/v1',
    authType: 'local-fixed',
    transport: 'http',
    transform: null,
    contextWindow: 1_000_000,
    vendorEnv: ['DARIO_API_KEY'],
    accountSlots: false,
    subscriptionUrl: 'https://github.com/askalf/dario',
    jurisdiction: 'Local',
    // `[1m]` is dario's client-side long-context label, not a distinct upstream
    // model: its proxy strips the tag and rides the `context-1m-2025-08-07`
    // beta on the request instead. dario derives one `[1m]` variant per family
    // via longContextEligible(), which excludes haiku — real Claude Code never
    // offers a 1M haiku — so the three below are the complete set. Without them
    // this entry advertised contextWindow: 1_000_000 while listing no model
    // that could actually reach it.
    fallbackModels: [
      'claude-fable-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5',
      'claude-fable-5[1m]', 'claude-opus-5[1m]', 'claude-sonnet-5[1m]',
    ],
  },
  // Dario's `local:` backend is an OpenAI-compatible server on the machine —
  // Ollama by default, hence port 11434. llama.cpp, LM Studio and vLLM expose
  // the same shape; point baseUrl at whichever one is running.
  local: {
    label: 'Local OpenAI-compatible server (Ollama and similar)',
    baseUrl: 'http://127.0.0.1:11434/v1',
    authType: 'none',
    transport: 'http',
    transform: null,
    contextWindow: 262_144,
    vendorEnv: ['LOCAL_API_KEY'],
    accountSlots: false,
    keyOptional: true,
    subscriptionUrl: null,
    jurisdiction: 'Local',
    fallbackModels: [],
  },
  // DeepSeek's API is OpenAI-compatible and versioned at /v1, though the docs
  // quote the bare host. Models float: the base ids track the latest build.
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    authType: 'api-key',
    transport: 'http',
    transform: null,
    contextWindow: 128_000,
    vendorEnv: ['DEEPSEEK_API_KEY'],
    subscriptionUrl: 'https://platform.deepseek.com/api_keys',
    jurisdiction: 'China',
    fallbackModels: ['deepseek-v4-pro', 'deepseek-v4-flash'],
  },
  kimi: {
    label: 'Kimi Code',
    baseUrl: 'https://api.kimi.com/coding/v1',
    authType: 'api-key',
    transport: 'http',
    transform: null,
    contextWindow: 262_144,
    vendorEnv: ['KIMI_API_KEY'],
    subscriptionUrl: 'https://kimi.moonshot.cn',
    jurisdiction: 'China',
    fallbackModels: ['k3', 'k3-256k', 'kimi-for-coding', 'kimi-for-coding-highspeed'],
  },
  google: {
    label: 'Google Gemini API',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    authType: 'api-key',
    transport: 'http',
    transform: null,
    contextWindow: 1_000_000,
    vendorEnv: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
    subscriptionUrl: 'https://aistudio.google.com',
    jurisdiction: 'United States',
    fallbackModels: [
      'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite',
      'gemini-3.1-pro-preview', 'gemini-3.1-flash-preview', 'gemini-3-flash-preview',
      'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
    ],
  },
  'google-antigravity': {
    label: 'Google Antigravity subscription',
    baseUrl: 'managed://antigravity',
    authType: 'managed-subscription',
    transport: 'antigravity-cli',
    transform: null,
    contextWindow: 1_000_000,
    vendorEnv: [],
    accountSlots: false,
    subscriptionUrl: 'https://antigravity.google/docs/plans',
    jurisdiction: 'United States',
    quotaFamilies: ['google-models', 'third-party-models'],
    fallbackModels: [
      'gemini-3.7-flash-high', 'gemini-3.7-flash-medium', 'gemini-3.7-flash-low',
      'gemini-3.6-flash-high', 'gemini-3.6-flash-medium', 'gemini-3.6-flash-low',
      'gemini-3.5-flash-high', 'gemini-3.5-flash-medium', 'gemini-3.5-flash-low',
      'gemini-3.1-pro-high', 'gemini-3.1-pro-low', 'claude-sonnet-4-6',
      'claude-opus-4-6-thinking', 'gpt-oss-120b-medium',
    ],
  },
  zhipu: {
    label: 'Zhipu AI GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    authType: 'api-key',
    transport: 'http',
    transform: null,
    contextWindow: 128_000,
    vendorEnv: ['ZHIPUAI_API_KEY'],
    subscriptionUrl: 'https://open.bigmodel.cn',
    jurisdiction: 'China',
    fallbackModels: [
      'glm-4.5', 'glm-4.5-air', 'glm-4.6', 'glm-4.7', 'glm-5', 'glm-5-turbo',
      'glm-5.1', 'glm-5.2', 'glm-5.3',
    ],
  },
  sakana: {
    label: 'Sakana AI',
    baseUrl: 'https://api.sakana.ai/v1',
    authType: 'api-key',
    transport: 'http',
    transform: null,
    contextWindow: 1_000_000,
    vendorEnv: ['SAKANA_API_KEY'],
    subscriptionUrl: 'https://console.sakana.ai',
    jurisdiction: 'Japan',
    fallbackModels: ['fugu', 'fugu-ultra', 'fugu-ultra-20260615', 'fugu-ultra-v1.0', 'fugu-ultra-v1.1'],
  },
};

export const PROVIDERS = {};

for (const [family, def] of Object.entries(BASE_PROVIDERS)) {
  PROVIDERS[family] = {
    ...def, id: family, family, account: null,
    keyEnv: [envBaseFor(family), ...def.vendorEnv],
  };
  if (def.accountSlots === false) continue;
  for (let n = 0; n < ACCOUNT_SLOTS; n++) {
    const id = `${family}${n}`;
    PROVIDERS[id] = {
      ...def, id, family, account: n,
      label: `${def.label} #${n}`,
      keyEnv: [envBaseFor(id)],
    };
  }
}

export function providerDef(id) {
  const def = PROVIDERS[id];
  if (!def) {
    throw new Error(
      `Unknown provider "${id}". Known families: ${Object.keys(BASE_PROVIDERS).join(', ')} ` +
      `(API-key families also accept numbered slots 0-${ACCOUNT_SLOTS - 1})`,
    );
  }
  return def;
}

export function familyMembers(id) {
  const def = providerDef(id);
  if (def.account !== null || def.accountSlots === false) return [id];
  return [def.family, ...Array.from({ length: ACCOUNT_SLOTS }, (_, n) => `${def.family}${n}`)];
}

export const FAMILIES = Object.keys(BASE_PROVIDERS);
