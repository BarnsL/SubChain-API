// Optional Start Menu shortcut for the packaged Windows executable.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { IS_SEA, EXE_DIR } from './runtime.js';
import { ENV_FILE } from './admin.js';
import { setEnvVars, reloadEnv } from './envfile.js';

export const SHORTCUT_STATE_VAR = 'SUBCHAIN_SHORTCUT_STATE';

export const ELIGIBLE = IS_SEA && process.platform === 'win32';

function shortcutLnkPath() {
  return path.join(
    process.env.APPDATA || '',
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'SubChain.lnk'
  );
}

function getState() {
  const value = process.env[SHORTCUT_STATE_VAR];
  return value === 'created' || value === 'declined' ? value : null;
}

function setState(value) {
  setEnvVars(ENV_FILE, { [SHORTCUT_STATE_VAR]: value });
  reloadEnv(ENV_FILE);
}

const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;

export function shortcutStatus() {
  if (!ELIGIBLE) return { eligible: false, exists: false, state: null };
  return { eligible: true, exists: fs.existsSync(shortcutLnkPath()), state: getState() };
}

export function createShortcut() {
  if (!ELIGIBLE) {
    throw Object.assign(
      new Error('Start Menu shortcuts are only offered for the Windows executable release'),
      { statusCode: 400 }
    );
  }
  const link = shortcutLnkPath();
  fs.mkdirSync(path.dirname(link), { recursive: true });

  const script = [
    '$ws = New-Object -ComObject WScript.Shell',
    `$sc = $ws.CreateShortcut(${psQuote(link)})`,
    `$sc.TargetPath = ${psQuote(process.execPath)}`,
    `$sc.WorkingDirectory = ${psQuote(EXE_DIR)}`,
    `$sc.Description = ${psQuote('SubChain subscription-provider failover router')}`,
    '$sc.Save()',
  ].join('; ');

  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
  });
  setState('created');
  return shortcutStatus();
}

export function dismissShortcut() {
  if (!ELIGIBLE) {
    throw Object.assign(
      new Error('Nothing to dismiss: not running as the Windows executable'),
      { statusCode: 400 }
    );
  }
  setState('declined');
  return shortcutStatus();
}
