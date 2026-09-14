// A separate home and deterministic ACP fixture keep this demo away from real sessions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demoHome = path.join(root, '.mvp/demo-home');
fs.mkdirSync(demoHome, { recursive: true, mode: 0o700 });
const fixture = path.join(root, 'test/fixtures/private-desk-agent.mjs');
fs.chmodSync(fixture, 0o755);
const child = spawn(process.execPath, [path.join(root, 'build/server.js')], {
  cwd: root,
  env: { PATH: process.env.PATH, HOME: demoHome, TMPDIR: process.env.TMPDIR || '/tmp', PORT: process.env.PORT || '8777', HOST: '127.0.0.1', GROK_BIN: fixture, GROK_REMOTE_DEMO: '1' },
  stdio: 'inherit',
});
console.log('Deterministic demo: no model calls. Access key is in .mvp/demo-home/.grok-remote/access-key.');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code || 0; });
