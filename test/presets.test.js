import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const presetsModule = await import('../src/presets.js');
const { importPresetDirectory, listPresetEntries, readPresetEntry } = presetsModule;

function temp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('preset importer copies only declared inert prompt files and writes provenance metadata', () => {
  assert.equal(typeof importPresetDirectory, 'function', 'preset importer must exist');
  if (!importPresetDirectory) return;
  const source = temp('subchain-preset-source-');
  const destination = temp('subchain-preset-destination-');
  fs.mkdirSync(path.join(source, 'data', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(source, 'data', 'prompts', 'coding.json'), '{"name":"coding"}');
  fs.writeFileSync(path.join(source, 'data', 'ignore.js'), 'process.exit(1)');
  fs.writeFileSync(path.join(source, 'README.md'), '# ignored');
  fs.writeFileSync(path.join(source, 'LICENSE'), 'MIT');

  const result = importPresetDirectory({
    sourceDirectory: source,
    destinationDirectory: destination,
    source: { id: 'tweakcc', repository: 'https://example.invalid/tweakcc', include: /^data\/prompts\/.*\.json$/i },
    revision: 'abc123',
  });

  assert.equal(result.fileCount, 1);
  assert.equal(fs.existsSync(path.join(destination, 'data', 'prompts', 'coding.json')), true);
  assert.equal(fs.existsSync(path.join(destination, 'data', 'ignore.js')), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(destination, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.files.map((file) => file.path), ['data/prompts/coding.json']);
  assert.equal(manifest.repository, 'https://example.invalid/tweakcc');
  assert.equal(manifest.revision, 'abc123');
  assert.equal(fs.existsSync(path.join(destination, 'LICENSE')), true);
});

test('private imported prompts become searchable Harness entries and expose only the selected inert text', () => {
  assert.equal(typeof listPresetEntries, 'function', 'preset library must list imported entries');
  assert.equal(typeof readPresetEntry, 'function', 'preset library must read one selected entry');
  if (!listPresetEntries || !readPresetEntry) return;

  const dataDir = temp('subchain-preset-library-');
  const sourceDir = path.join(dataDir, 'presets', 'fixture');
  fs.mkdirSync(path.join(sourceDir, 'data', 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'plain.md'), 'plain fixture prompt', 'utf8');
  fs.writeFileSync(path.join(sourceDir, 'data', 'prompts', 'prompts.json'), JSON.stringify({
    prompts: [{ id: 'fixture-prompt', name: 'Fixture prompt', description: 'A test prompt', pieces: ['first ', 'second'] }],
  }), 'utf8');
  fs.writeFileSync(path.join(sourceDir, 'manifest.json'), JSON.stringify({
    source: 'fixture', repository: 'https://example.invalid/fixture', revision: 'test', fileCount: 2,
    files: [{ path: 'plain.md' }, { path: 'data/prompts/prompts.json' }],
  }), 'utf8');
  fs.writeFileSync(path.join(dataDir, 'presets', 'index.json'), JSON.stringify({
    schemaVersion: 1, sources: [{ source: 'fixture', fileCount: 2 }],
  }), 'utf8');

  const listed = listPresetEntries({ dataDir, limit: 10 });
  assert.equal(listed.total, 2);
  assert.deepEqual(listed.items.map((entry) => entry.title), ['Fixture prompt', 'plain.md']);
  assert.equal(listPresetEntries({ dataDir, query: 'fixture', limit: 10 }).total, 1);
  const selected = readPresetEntry({ dataDir, id: listed.items[0].id });
  assert.equal(selected.content, 'first second');
  assert.equal(selected.source, 'fixture');
});
