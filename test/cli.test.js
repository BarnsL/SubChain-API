import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('CLI documents journal controls and defaults persistence to private application data', () => {
  const cli = fileURLToPath(new URL('../bin/subchain.mjs', import.meta.url));
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--log <path>/);
  assert.match(help.stdout, /--no-log/);

  const source = fs.readFileSync(cli, 'utf8');
  assert.match(source, /path\.join\(resolveDataDir\(\),\s*'logs',\s*'requests\.jsonl'\)/);
  assert.match(source, /new RequestJournal\(\{ filePath: logPath, enabled: persistJournal \}\)/);
  assert.match(source, /journal,/);
});
