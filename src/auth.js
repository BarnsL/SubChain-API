// Portable provider credential discovery. Sources are reported generically, never as local paths.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function readFileTrimmed(filePath) {
  try { return fs.readFileSync(filePath, 'utf8').trim() || null; } catch { return null; }
}

function readJsonField(filePath, ...keys) {
  try {
    let value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    for (const key of keys) value = value?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  } catch { return null; }
}

function readEnvironmentFile(filePath) {
  try {
    if (!filePath || fs.statSync(filePath).size > 1024 * 1024) return {};
    const values = {};
    for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const match = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      let [, name, value] = match;
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1).replace(/\\(["\\])/g, '$1');
      }
      if (value) values[name] = value;
    }
    return values;
  } catch {
    return {};
  }
}

export function createWindowsEnvironmentReader(execFile = execFileSync) {
  let loaded = false;
  const values = new Map();
  return (name) => {
    if (!loaded) {
      loaded = true;
      try {
        const output = execFile('reg', ['query', 'HKCU\\Environment'], {
          windowsHide: true, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'],
        });
        for (const line of output.split(/\r?\n/)) {
          const match = line.match(/^\s*(\S+)\s+REG_(?:SZ|EXPAND_SZ)\s+(.*)$/i);
          if (match) values.set(match[1].toUpperCase(), match[2].trim());
        }
      } catch {}
    }
    return values.get(String(name).toUpperCase()) || null;
  };
}

const readWindowsEnvironment = createWindowsEnvironmentReader();

function createContext(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? os.homedir();
  const configuredDirectory = options.credentialDir ?? env.SUBCHAIN_CREDENTIALS_DIR ?? null;
  const configuredEnvironmentFile = options.credentialEnvFile ?? env.SUBCHAIN_CREDENTIAL_ENV_FILE ?? null;
  const appData = options.appData ?? env.APPDATA ?? null;
  return {
    env,
    platform,
    home,
    credentialDir: typeof configuredDirectory === 'string' && configuredDirectory.trim() ? configuredDirectory.trim() : null,
    credentialEnvironment: readEnvironmentFile(
      typeof configuredEnvironmentFile === 'string' && configuredEnvironmentFile.trim() ? configuredEnvironmentFile.trim() : null,
    ),
    appData: typeof appData === 'string' && appData.trim() ? appData.trim() : null,
    platformStore: options.platformStore ?? readWindowsEnvironment,
  };
}

function firstCredential(candidates, type) {
  for (const [token, source] of candidates) {
    if (typeof token === 'string' && token.trim()) return { token: token.trim(), type, source };
  }
  return null;
}

function environmentCandidates(context, names) {
  return [
    ...names.map((name) => [context.env[name], 'environment']),
    ...names.map((name) => [context.credentialEnvironment[name], 'credential-file']),
  ];
}

function credentialDirectory(context, ...fileNames) {
  if (!context.credentialDir) return null;
  for (const fileName of fileNames) {
    const value = readFileTrimmed(path.join(context.credentialDir, fileName));
    if (value) return value;
  }
  return null;
}

function platformCredential(context, names) {
  if (context.platform !== 'win32') return null;
  for (const name of names) {
    const token = context.platformStore(name);
    if (token) return token;
  }
  return null;
}

function appCredential(context, relativePath, ...keys) {
  return readJsonField(path.join(context.home, ...relativePath), ...keys);
}

function slotEnvironmentName(providerId) {
  return `SUBCHAIN_${providerId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;
}

function slotCredential(context, providerId, type) {
  const primary = slotEnvironmentName(providerId);
  const names = providerId.startsWith('anthropic')
    ? [`${primary.slice(0, -'_API_KEY'.length)}_OAUTH_TOKEN`, primary]
    : [primary];
  return firstCredential([
    ...names.map((name) => [context.env[name], 'override']),
    ...names.map((name) => [context.credentialEnvironment[name], 'credential-file']),
    [credentialDirectory(context, `${providerId}-api-key.txt`), 'credential-directory'],
    [platformCredential(context, names), 'platform-store'],
  ], type);
}

const resolverTypes = {
  anthropic: 'bearer', 'openai-api': 'api-key', kimi: 'api-key', google: 'api-key', zhipu: 'api-key', sakana: 'api-key',
};

const resolvers = {
  anthropic(context) {
    return firstCredential([
      [context.env.SUBCHAIN_ANTHROPIC_OAUTH_TOKEN, 'override'],
      ...environmentCandidates(context, ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_TOKEN']),
      [credentialDirectory(context, 'anthropic-oauth-token.txt'), 'credential-directory'],
      [appCredential(context, ['.claude', '.credentials.json'], 'claudeAiOauth', 'accessToken'), 'provider-application'],
      [platformCredential(context, ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_TOKEN']), 'platform-store'],
      [credentialDirectory(context, 'anthropic-api-key.txt'), 'credential-directory'],
    ], 'bearer');
  },

  'openai-api'(context) {
    return firstCredential([
      [context.env.SUBCHAIN_OPENAI_API_KEY || context.env.SUBCHAIN_OPENAI_CODEX_TOKEN, 'override'],
      ...environmentCandidates(context, ['OPENAI_API_KEY']),
      [credentialDirectory(context, 'openai-api-key.txt'), 'credential-directory'],
      [platformCredential(context, ['OPENAI_API_KEY']), 'platform-store'],
    ], 'api-key');
  },

  kimi(context) {
    const appKey = context.platform === 'win32' && context.appData
      ? readJsonField(path.join(context.appData, 'kimi-desktop', 'daimon-share', 'daimon', 'kimi-code-key.json'), 'apiKey')
      : null;
    return firstCredential([
      [context.env.SUBCHAIN_KIMI_API_KEY, 'override'],
      ...environmentCandidates(context, ['KIMI_API_KEY']),
      [credentialDirectory(context, 'kimi-code-api-key.txt'), 'credential-directory'],
      [appKey, 'provider-application'],
      [platformCredential(context, ['KIMI_API_KEY']), 'platform-store'],
    ], 'api-key');
  },

  google(context) {
    return firstCredential([
      [context.env.SUBCHAIN_GOOGLE_API_KEY, 'override'],
      ...environmentCandidates(context, ['GOOGLE_API_KEY', 'GEMINI_API_KEY', 'GEMINI_PAID_API_KEY']),
      [credentialDirectory(context, 'google-api-key.txt', 'google api.txt'), 'credential-directory'],
      [platformCredential(context, ['GOOGLE_API_KEY', 'GEMINI_API_KEY', 'GEMINI_PAID_API_KEY']), 'platform-store'],
    ], 'api-key');
  },

  zhipu(context) {
    return firstCredential([
      [context.env.SUBCHAIN_ZHIPU_API_KEY, 'override'],
      ...environmentCandidates(context, ['ZHIPUAI_API_KEY', 'GLM_API_KEY']),
      [credentialDirectory(context, 'zhipu-api-key.txt'), 'credential-directory'],
      [platformCredential(context, ['ZHIPUAI_API_KEY', 'GLM_API_KEY']), 'platform-store'],
    ], 'api-key');
  },

  sakana(context) {
    return firstCredential([
      [context.env.SUBCHAIN_SAKANA_API_KEY, 'override'],
      ...environmentCandidates(context, ['SAKANA_API_KEY']),
      [credentialDirectory(context, 'sakana-api-key.txt', 'sakana.txt'), 'credential-directory'],
      [platformCredential(context, ['SAKANA_API_KEY']), 'platform-store'],
    ], 'api-key');
  },
};

/** Resolve one provider credential without leaking local storage details to callers. */
export function resolveCredential(providerId, options) {
  const family = providerId.replace(/\d+$/, '');
  const resolver = resolvers[family];
  if (!resolver) return null;
  const context = createContext(options);
  return /\d+$/.test(providerId)
    ? slotCredential(context, providerId, resolverTypes[family])
    : resolver(context);
}
