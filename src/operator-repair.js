// Confirmation-gated, rollback-tested minor repair helper.
// It performs only one exact text replacement inside explicitly allowed files.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const BLOCKED = /(?:authorization|access.?key|api.?key|oauth|token|secret|child_process|exec\(|spawn\(|eval\(|content-security-policy|isloopback|requireapikey|authenticate)/i;

export function applyMinorRepair({ root, file, search, replace, allowFiles }) {
  const normalized = String(file || '').replace(/\\/g, '/');
  if (!allowFiles.includes(normalized)) throw Object.assign(new Error('That file is outside the minor-repair allowlist.'), { statusCode: 400 });
  if (!search || typeof search !== 'string' || typeof replace !== 'string') throw Object.assign(new Error('Exact search and replacement text are required.'), { statusCode: 400 });
  if (search.length > 4000 || replace.length > 4000 || replace.split(/\r?\n/).length > 120) throw Object.assign(new Error('Repair exceeds the minor-change size limit.'), { statusCode: 400 });
  if (BLOCKED.test(search) || BLOCKED.test(replace)) throw Object.assign(new Error('Security-sensitive code cannot be changed through minor repair.'), { statusCode: 400 });
  const absolute = path.resolve(root, normalized);
  if (!absolute.startsWith(path.resolve(root) + path.sep)) throw Object.assign(new Error('Invalid repair path.'), { statusCode: 400 });
  const before = fs.readFileSync(absolute, 'utf8');
  const occurrences = before.split(search).length - 1;
  if (occurrences !== 1) throw Object.assign(new Error(`Exact repair search must match once; found ${occurrences}.`), { statusCode: 409 });
  const backupDir = path.join(root, '.chain-operator-backups');
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const backup = path.join(backupDir, `${path.basename(normalized)}.${Date.now()}.bak`);
  fs.copyFileSync(absolute, backup);
  fs.writeFileSync(absolute, before.replace(search, replace), 'utf8');
  const syntax = normalized.endsWith('.js') || normalized.endsWith('.mjs')
    ? spawnSync(process.execPath, ['--check', absolute], { cwd: root, encoding: 'utf8' })
    : { status: 0, stdout: '', stderr: '' };
  const tests = syntax.status === 0 ? spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['test'], { cwd: root, encoding: 'utf8', timeout: 120_000 }) : syntax;
  if (syntax.status !== 0 || tests.status !== 0) {
    fs.copyFileSync(backup, absolute);
    throw Object.assign(new Error('Validation failed; the repair was rolled back.'), { statusCode: 409, validation: String((syntax.stderr || tests.stderr || tests.stdout || '')).slice(-2000) });
  }
  return { ok: true, file: normalized, backup: path.relative(root, backup), validation: 'node --check + npm test passed' };
}
