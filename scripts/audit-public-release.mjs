// Fail closed when the staged public release appears to contain a secret or a private machine path.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const output = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const files = new Set([
  ...output(['ls-files']).split(/\r?\n/),
  ...output(['diff', '--cached', '--name-only']).split(/\r?\n/),
  ...output(['ls-files', '--others', '--exclude-standard']).split(/\r?\n/),
].filter(Boolean));

const checks = [
  { label: 'machine-specific secret directory', expression: /D:\\secrets\\/i },
  { label: 'private Windows user profile path', expression: /[A-Za-z]:\\Users\\[^\\\s]+\\/i },
  { label: 'private POSIX user profile path', expression: /\/home\/[^/\s]+\//i },
  { label: 'raw email address', expression: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  { label: 'unsupported ChatGPT consumer backend', expression: /chatgpt\.com\/backend-api/i },
  { label: 'possible API key', expression: /(?:sk|sc)-[A-Za-z0-9_-]{16,}/ },
  { label: 'possible Google API key', expression: /AIza[A-Za-z0-9_-]{24,}/ },
  { label: 'possible GitHub token', expression: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { label: 'possible npm token', expression: /npm_[A-Za-z0-9]{30,}/ },
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
