// Fail closed when the staged public release appears to contain a secret or a private machine path.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const output = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const files = new Set([
  ...output(['ls-files']).split(/\r?\n/),
  ...output(['diff', '--cached', '--name-only']).split(/\r?\n/),
].filter(Boolean));

const checks = [
  { label: 'machine-specific secret directory', expression: /D:\\secrets\\/i },
  { label: 'private user profile path', expression: /C:\\Users\\Burgboy\\/i },
  { label: 'unsupported ChatGPT consumer backend', expression: /chatgpt\.com\/backend-api/i },
  { label: 'possible API key', expression: /(?:sk|sc)-[A-Za-z0-9_-]{16,}/ },
  { label: 'possible bearer token', expression: /eyJ[A-Za-z0-9_-]{20,}/ },
  { label: 'private key block', expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

const findings = [];
for (const relative of files) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
  const content = fs.readFileSync(file, 'utf8');
  for (const check of checks) {
    if (check.expression.test(content)) findings.push(`${relative}: ${check.label}`);
  }
}

if (findings.length) {
  console.error('Public-release audit failed:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`Public-release audit passed for ${files.size} tracked or staged files.`);
}
