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
