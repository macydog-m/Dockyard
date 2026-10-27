import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { root } from './version.mjs';

const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
const files = [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean))];
const hasCommits = execFileSync('git', ['rev-list', '--all', '--count'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim() !== '0';
const isPublicIdentity = value => value.endsWith('@users.noreply.github.com') || value === 'noreply@github.com';
const emails = [...new Set((hasCommits ? git(['log', '--all', '--format=%ae%n%ce']) : '').split('\n').map(value => value.trim()).filter(value => value.includes('@') && !isPublicIdentity(value)))];
const patterns = [
  ['credential token', /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{15,})/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['personal home path', /(?:[A-Z]:[\\/]+Users[\\/]+[^\s/\\"'<>]+|\/Users\/[^\s/]+|\/home\/[^\s/]+)/i],
];
const findings = [];
for (const file of files) {
  if (/(^|\/)(?:\.env(?:\..*)?|\.npmrc|auth\.json|id_rsa|id_ed25519)$|\.(?:pfx|p12|pem|key|keystore)$/i.test(file) && !/\.env\.(example|sample)$/.test(file)) findings.push({ file, reason: 'credential filename' });
  let bytes;
  try { bytes = await readFile(path.join(root, file)); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  if (bytes.includes(0)) continue;
  for (const [index, line] of bytes.toString('utf8').split('\n').entries()) {
    for (const [reason, pattern] of patterns) if (pattern.test(line)) findings.push({ file, line: index + 1, reason });
    if (emails.some(email => line.includes(email))) findings.push({ file, line: index + 1, reason: 'personal commit email in file' });
  }
}
// Do not print matching contents: the check itself must not leak credentials.
console.log(JSON.stringify({ scope: 'current tracked and non-ignored files plus commit identities; not historical file or binary contents', files: files.length, nonPrivateCommitIdentities: emails.length === 0, findings }, null, 2));
if (findings.length || emails.length) process.exitCode = 1;
