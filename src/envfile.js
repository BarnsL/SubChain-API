// Reading and writing .env in place.
//
// The web UI edits credentials, so this has to survive round-trips without
// destroying the file: comments, blank lines, ordering and unrelated variables
// all stay exactly where the user left them. Only the named keys change.

import fs from 'node:fs';
import path from 'node:path';

/** Whether a raw line is a `NAME=value` assignment, as opposed to a comment or blank line. */
const isAssignment = (line) => /^\s*[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line);
/** The variable name from an assignment line. Only valid when `isAssignment(line)` is true. */
const nameOf = (line) => line.slice(0, line.indexOf('=')).trim();

// Values are written bare unless they contain something a reader could
// misinterpret, in which case they are double-quoted.
function serialise(value) {
  const v = String(value);
  return /[\s#'"]/.test(v) ? `"${v.replace(/(["\\])/g, '\\$1')}"` : v;
}

/**
 * Apply { NAME: value } to a .env file. A value of null or '' removes the
 * assignment. Returns the set of names that were changed.
 */
export function setEnvVars(file, updates) {
  const eol = fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('\r\n') ? '\r\n' : '\n';
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : [];
  const pending = new Map(Object.entries(updates));
  const changed = new Set();
  const out = [];

  for (const line of lines) {
    if (!isAssignment(line)) {
      out.push(line);
      continue;
    }
    const name = nameOf(line);
    if (!pending.has(name)) {
      out.push(line);
      continue;
    }
    const value = pending.get(name);
    pending.delete(name);
    if (value === null || value === '') {
      changed.add(name); // drop the line entirely
      continue;
    }
    out.push(`${name}=${serialise(value)}`);
    changed.add(name);
  }

  // Anything not already present is appended, under a header the first time.
  const additions = [...pending.entries()].filter(([, v]) => v !== null && v !== '');
  if (additions.length) {
    const body = out.join(eol);
    if (out.length && out.at(-1).trim() !== '') out.push('');
    if (!body.includes('# Added by the SubChain web UI')) {
      out.push('# Added by the SubChain web UI');
    }
    for (const [name, value] of additions) {
      out.push(`${name}=${serialise(value)}`);
      changed.add(name);
    }
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  // 0600: this file is nothing but credentials.
  fs.writeFileSync(file, out.join(eol), { encoding: 'utf8', mode: 0o600 });
  return changed;
}

/** Push the file's values into process.env, overwriting; used after a save. */
export function reloadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!isAssignment(raw)) continue;
    const name = nameOf(raw);
    let value = raw.slice(raw.indexOf('=') + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).replace(/\\(["\\])/g, '$1');
    }
    process.env[name] = value;
  }
}

/** Names currently assigned in the file, so the UI can drop stale slots. */
export function envNames(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(isAssignment)
    .map(nameOf);
}
