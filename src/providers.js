export const ACCOUNT_SLOTS = 10;
export const MAX_KEYS_PER_ACCOUNT = 10;

export const envBaseFor = (id) =>
  `SUBCHAIN_${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;

const BASE_PROVIDERS = {
  anthropic: {
    label: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    authType: 'oauth-bearer',
    transform: 'anthropic',
    contextWindow: 200_000,
    vendorEnv: [],
    subscriptionUrl: 'https://console.anthropic.com',
    jurisdiction: 'United States',
  },
  'openai-codex': {
    label: 'OpenAI API / Codex',
    baseUrl: 'https://api.openai.com/v1',
    authType: 'api-key',
    transform: null,
    contextWindow: 272_000,
    vendorEnv: ['OPENAI_API_KEY'],
    subscriptionUrl: 'https://platform.openai.com',
    jurisdiction: 'United States',
  },
  kimi: {
    label: 'Kimi Code',
    baseUrl: 'https://api.kimi.com/coding/v1',
    authType: 'api-key',
    transform: null,
    contextWindow: 262_144,
    vendorEnv: ['KIMI_API_KEY'],
    subscriptionUrl: 'https://kimi.moonshot.cn',
    jurisdiction: 'China',
  },
  google: {
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    authType: 'api-key',
    transform: null,
    contextWindow: 1_000_000,
    vendorEnv: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
    subscriptionUrl: 'https://aistudio.google.com',
    jurisdiction: 'United States',
  },
  zhipu: {
    label: 'Zhipu AI GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    authType: 'api-key',
    transform: null,
    contextWindow: 128_000,
    vendorEnv: ['ZHIPUAI_API_KEY'],
    subscriptionUrl: 'https://open.bigmodel.cn',
    jurisdiction: 'China',
  },
  sakana: {
    label: 'Sakana AI',
    baseUrl: 'https://api.sakana.ai/v1',
    authType: 'api-key',
    transform: null,
    contextWindow: 1_000_000,
    vendorEnv: ['SAKANA_API_KEY'],
    subscriptionUrl: 'https://console.sakana.ai',
    jurisdiction: 'Japan',
  },
};

export const PROVIDERS = {};

for (const [family, def] of Object.entries(BASE_PROVIDERS)) {
  PROVIDERS[family] = {
    ...def, id: family, family, account: null,
    keyEnv: [envBaseFor(family), ...def.vendorEnv],
  };
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
      `(each also accepts numbered slots 0-${ACCOUNT_SLOTS - 1})`
    );
  }
  return def;
}

export function familyMembers(id) {
  const def = providerDef(id);
  if (def.account !== null) return [id];
  return [def.family, ...Array.from({ length: ACCOUNT_SLOTS }, (_, n) => `${def.family}${n}`)];
}

export const FAMILIES = Object.keys(BASE_PROVIDERS);
