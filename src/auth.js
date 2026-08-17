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

function readWindowsEnvironment(name) {
  try {
    const output = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', name], {
      windowsHide: true, encoding: 'utf8', timeout: 3000,
    });
    const match = output.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)/);
    return match ? match[1].trim() : null;
  } catch { return null; }
}

function createContext(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? os.homedir();
  const configuredDirectory = options.credentialDir ?? env.SUBCHAIN_CREDENTIALS_DIR ?? null;
  const appData = options.appData ?? env.APPDATA ?? null;
  return {
    env,
    platform,
    home,
    credentialDir: typeof configuredDirectory === 'string' && configuredDirectory.trim() ? configuredDirectory.trim() : null,
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

function credentialDirectory(context, fileName) {
  return context.credentialDir ? readFileTrimmed(path.join(context.credentialDir, fileName)) : null;
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

const resolvers = {
  anthropic(context) {
    return firstCredential([
      [context.env.SUBCHAIN_ANTHROPIC_OAUTH_TOKEN, 'override'],
      [context.env.CLAUDE_CODE_OAUTH_TOKEN || context.env.ANTHROPIC_TOKEN, 'environment'],
      [credentialDirectory(context, 'anthropic-oauth-token.txt'), 'credential-directory'],
      [appCredential(context, ['.claude', '.credentials.json'], 'claudeAiOauth', 'accessToken'), 'provider-application'],
      [platformCredential(context, ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_TOKEN']), 'platform-store'],
      [credentialDirectory(context, 'anthropic-api-key.txt'), 'credential-directory'],
    ], 'bearer');
  },

  'openai-codex'(context) {
    return firstCredential([
      [context.env.SUBCHAIN_OPENAI_API_KEY || context.env.SUBCHAIN_OPENAI_CODEX_TOKEN, 'override'],
      [context.env.OPENAI_API_KEY, 'environment'],
      [credentialDirectory(context, 'openai-api-key.txt'), 'credential-directory'],
    ], 'api-key');
  },

  kimi(context) {
    const appKey = context.platform === 'win32' && context.appData
      ? readJsonField(path.join(context.appData, 'kimi-desktop', 'daimon-share', 'daimon', 'kimi-code-key.json'), 'apiKey')
      : null;
    return firstCredential([
      [context.env.SUBCHAIN_KIMI_API_KEY, 'override'],
      [context.env.KIMI_API_KEY, 'environment'],
      [credentialDirectory(context, 'kimi-code-api-key.txt'), 'credential-directory'],
      [appKey, 'provider-application'],
    ], 'api-key');
  },

  google(context) {
    return firstCredential([
      [context.env.SUBCHAIN_GOOGLE_API_KEY, 'override'],
      [context.env.GOOGLE_API_KEY || context.env.GEMINI_API_KEY, 'environment'],
      [credentialDirectory(context, 'google-api-key.txt'), 'credential-directory'],
    ], 'api-key');
  },

  zhipu(context) {
    return firstCredential([
      [context.env.SUBCHAIN_ZHIPU_API_KEY, 'override'],
      [context.env.ZHIPUAI_API_KEY || context.env.GLM_API_KEY, 'environment'],
      [credentialDirectory(context, 'zhipu-api-key.txt'), 'credential-directory'],
    ], 'api-key');
  },

  sakana(context) {
    return firstCredential([
      [context.env.SUBCHAIN_SAKANA_API_KEY, 'override'],
      [context.env.SAKANA_API_KEY, 'environment'],
      [credentialDirectory(context, 'sakana-api-key.txt'), 'credential-directory'],
    ], 'api-key');
  },
};

/** Resolve one provider credential without leaking local storage details to callers. */
export function resolveCredential(providerId, options) {
  const family = providerId.replace(/\d+$/, '');
  const resolver = resolvers[family];
  return resolver ? resolver(createContext(options)) : null;
}
