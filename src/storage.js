// Private local storage for generated SubChain credentials and imported presets.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Resolve a conventional private data directory without baking a host path into the app. */
export function resolveDataDir({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const explicit = nonEmpty(env.SUBCHAIN_DATA_DIR);
  if (explicit) return explicit;
  if (platform === 'win32') return path.join(nonEmpty(env.APPDATA) || path.join(home, 'AppData', 'Roaming'), 'SubChain');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'SubChain');
  return path.join(nonEmpty(env.XDG_CONFIG_HOME) || path.join(home, '.config'), 'subchain');
}

function validateSecretRef(reference) {
  if (typeof reference !== 'string' || !/^local-key:[a-z0-9][a-z0-9-]{0,63}$/.test(reference)) {
    throw new Error('invalid secret reference');
  }
}

function readSecretFile(file) {
  if (!fs.existsSync(file)) return { schemaVersion: 1, secrets: {} };
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (parsed?.schemaVersion !== 1 || !parsed.secrets || typeof parsed.secrets !== 'object' || Array.isArray(parsed.secrets)) {
    throw new Error('invalid credential store');
  }
  return parsed;
}

function writeSecretFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  if (process.platform !== 'win32') fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, file);
  if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
}

/** Create a narrow key-value store that can hold only generated local API keys. */
export function createSecretStore({ dataDir = resolveDataDir(), fileName = 'credentials.json' } = {}) {
  const file = path.join(dataDir, fileName);
  return {
    get(reference) {
      validateSecretRef(reference);
      const value = readSecretFile(file).secrets[reference];
      return typeof value === 'string' && value ? value : null;
    },
    set(reference, token) {
      validateSecretRef(reference);
      if (typeof token !== 'string' || !token) throw new Error('secret token must be a non-empty string');
      const data = readSecretFile(file);
      data.secrets[reference] = token;
      writeSecretFile(file, data);
    },
    delete(reference) {
      validateSecretRef(reference);
      const data = readSecretFile(file);
      delete data.secrets[reference];
      writeSecretFile(file, data);
    },
    file,
  };
}
