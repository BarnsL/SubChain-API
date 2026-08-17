// Third-party prompt presets are imported as inert local data, never bundled into this public repository.

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveDataDir } from './storage.js';

export const PRESET_SOURCES = [
  {
    id: 'cl4r1t4s',
    repository: 'https://github.com/elder-plinius/CL4R1T4S.git',
    include: /^(?:ANTHROPIC|BOLT|BRAVE|CLINE|CLUELY|CURSOR|DEVIN|DIA|FACTORY|GOOGLE|HUME|LOVABLE|MANUS|META|MINIMAX|MISTRAL|MOONSHOT|MULTION|OPENAI|PERPLEXITY|REPLIT|SAMEDEV|VERCEL V0|WINDSURF|XAI|ZAI)\/.*\.(?:md|txt)$/i,
  },
  {
    id: 'tweakcc',
    repository: 'https://github.com/Piebald-AI/tweakcc.git',
    include: /^data\/prompts\/.*\.json$/i,
  },
  {
    id: 'claude-code-system-prompts',
    repository: 'https://github.com/Piebald-AI/claude-code-system-prompts.git',
    include: /^system-prompts\/.*\.md$/i,
  },
];

const PRESET_ID = (source, file, entry) => Buffer.from(JSON.stringify([source, file, entry]), 'utf8').toString('base64url');
const safeSource = (source) => typeof source === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(source);
const safeFile = (file) => typeof file === 'string' && file === path.posix.normalize(file) && !file.startsWith('../') && !file.startsWith('/');

function walkFiles(root, current = root, files = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const file = path.join(current, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) walkFiles(root, file, files);
    else if (entry.isFile()) files.push(path.relative(root, file).split(path.sep).join('/'));
  }
  return files;
}

function checksum(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function privatePresetRoot(dataDir) {
  return path.join(dataDir, 'presets');
}

function importedFile(root, source, file) {
  if (!safeSource(source) || !safeFile(file)) return null;
  const sourceRoot = path.join(root, source);
  const resolved = path.join(sourceRoot, ...file.split('/'));
  return resolved.startsWith(sourceRoot + path.sep) ? resolved : null;
}

function catalogFromPrivateData(dataDir) {
  const root = privatePresetRoot(dataDir);
  let index;
  try { index = readJson(path.join(root, 'index.json')); } catch { return []; }
  if (!Array.isArray(index?.sources)) return [];

  const entries = [];
  for (const sourceRecord of index.sources) {
    const source = sourceRecord?.source;
    if (!safeSource(source)) continue;
    let manifest;
    try { manifest = readJson(path.join(root, source, 'manifest.json')); } catch { continue; }
    for (const fileRecord of Array.isArray(manifest?.files) ? manifest.files : []) {
      const file = fileRecord?.path;
      const filePath = importedFile(root, source, file);
      if (!filePath || !fs.existsSync(filePath)) continue;
      if (/\.json$/i.test(file)) {
        try {
          const parsed = readJson(filePath);
          if (Array.isArray(parsed?.prompts)) {
            parsed.prompts.forEach((prompt, entry) => {
              if (!Array.isArray(prompt?.pieces) || !prompt.pieces.every((piece) => typeof piece === 'string')) return;
              entries.push({
                id: PRESET_ID(source, file, entry), source, file, entry,
                title: String(prompt.name || prompt.id || `${path.posix.basename(file)} #${entry + 1}`),
                description: typeof prompt.description === 'string' ? prompt.description : '',
              });
            });
          }
        } catch {
          // Imported JSON that cannot be parsed is inert and unavailable until re-imported.
        }
      } else if (/\.(?:md|txt)$/i.test(file)) {
        entries.push({ id: PRESET_ID(source, file, null), source, file, entry: null, title: path.posix.basename(file), description: '' });
      }
    }
  }
  return entries.sort((left, right) => left.source.localeCompare(right.source) || left.title.localeCompare(right.title));
}

/** List private, inert preset metadata for the loopback Harness picker. */
export function listPresetEntries({ dataDir = resolveDataDir(), source = null, query = '', limit = 50 } = {}) {
  const all = catalogFromPrivateData(dataDir);
  const normalizedSource = typeof source === 'string' && source ? source : null;
  const needle = String(query || '').trim().toLocaleLowerCase();
  const matching = all.filter((entry) =>
    (!normalizedSource || entry.source === normalizedSource) &&
    (!needle || `${entry.title}\n${entry.description}\n${entry.file}`.toLocaleLowerCase().includes(needle)),
  );
  const sources = [...new Set(all.map((entry) => entry.source))].map((id) => ({ id, count: all.filter((entry) => entry.source === id).length }));
  return { total: matching.length, sources, items: matching.slice(0, Math.max(1, Math.min(Number(limit) || 50, 100))) };
}

/** Read exactly one catalogue-selected inert prompt. Paths and entries are checked against the private manifest. */
export function readPresetEntry({ dataDir = resolveDataDir(), id } = {}) {
  const entry = catalogFromPrivateData(dataDir).find((candidate) => candidate.id === id);
  if (!entry) throw Object.assign(new Error('Unknown preset'), { statusCode: 404 });
  const filePath = importedFile(privatePresetRoot(dataDir), entry.source, entry.file);
  if (!filePath) throw Object.assign(new Error('Invalid preset'), { statusCode: 400 });
  let content;
  if (entry.entry === null) {
    content = fs.readFileSync(filePath, 'utf8');
  } else {
    const prompt = readJson(filePath)?.prompts?.[entry.entry];
    if (!Array.isArray(prompt?.pieces) || !prompt.pieces.every((piece) => typeof piece === 'string')) {
      throw Object.assign(new Error('Imported preset is malformed'), { statusCode: 400 });
    }
    content = prompt.pieces.join('');
  }
  if (!content.trim()) throw Object.assign(new Error('Imported preset is empty'), { statusCode: 400 });
  return { ...entry, content };
}

function copyLicense(sourceDirectory, destinationDirectory) {
  const license = fs.readdirSync(sourceDirectory, { withFileTypes: true })
    .find((entry) => entry.isFile() && /^licen[cs]e(?:\.[a-z0-9-]+)?$/i.test(entry.name));
  if (license) fs.copyFileSync(path.join(sourceDirectory, license.name), path.join(destinationDirectory, 'LICENSE'));
}

/** Import allowed prompt files from an already checked-out source directory. */
export function importPresetDirectory({ sourceDirectory, destinationDirectory, source, revision }) {
  if (!source?.id || !(source.include instanceof RegExp)) throw new Error('preset source needs an id and include rule');
  const selected = walkFiles(sourceDirectory)
    .filter((relative) => source.include.test(relative))
    .sort((left, right) => left.localeCompare(right));
  const stage = `${destinationDirectory}.staging-${process.pid}-${Date.now()}`;
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true, mode: 0o700 });
  const files = selected.map((relative) => {
    const from = path.join(sourceDirectory, ...relative.split('/'));
    const to = path.join(stage, ...relative.split('/'));
    fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 });
    fs.copyFileSync(from, to);
    return { path: relative, sha256: checksum(from) };
  });
  copyLicense(sourceDirectory, stage);
  const manifest = {
    schemaVersion: 1,
    source: source.id,
    repository: source.repository,
    revision,
    importedAt: new Date().toISOString(),
    fileCount: files.length,
    files,
  };
  fs.writeFileSync(path.join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.mkdirSync(path.dirname(destinationDirectory), { recursive: true, mode: 0o700 });
  fs.rmSync(destinationDirectory, { recursive: true, force: true });
  fs.renameSync(stage, destinationDirectory);
  return manifest;
}

function git(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000, ...options }).trim();
}

/** Fetch one public repository and import only its declared preset file types to private app data. */
export function importPresetSource(source, { dataDir = resolveDataDir() } = {}) {
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), `subchain-${source.id}-`));
  try {
    git(['clone', '--depth', '1', '--filter=blob:none', source.repository, checkout]);
    const revision = git(['-C', checkout, 'rev-parse', 'HEAD']);
    return importPresetDirectory({
      sourceDirectory: checkout,
      destinationDirectory: path.join(dataDir, 'presets', source.id),
      source,
      revision,
    });
  } finally {
    fs.rmSync(checkout, { recursive: true, force: true });
  }
}

/** Import every supported public preset source without executing any imported text. */
export function importAllPresets(options = {}) {
  const manifests = PRESET_SOURCES.map((source) => importPresetSource(source, options));
  const dataDir = options.dataDir || resolveDataDir();
  const index = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    sources: manifests.map(({ source, repository, revision, fileCount }) => ({ source, repository, revision, fileCount })),
  };
  const presetDir = path.join(dataDir, 'presets');
  fs.mkdirSync(presetDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(presetDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return index;
}
