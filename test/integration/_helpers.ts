// Shared boot/shutdown for Phase 9 integration tests. NOT a test file: the
// glob `test/integration/*.test.ts` skips it because of the missing
// `.test.ts` suffix, so node:test won't try to discover tests in it.

import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const ENABLED = process.env['RUN_LOCAL_INTEGRATION'] === '1';
export const SKIP_REASON = 'set RUN_LOCAL_INTEGRATION=1 to enable';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const homes = new Map<ChildProcess, { home: string; base: string }>();
const keys = new Map<string, string>();

export function fetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const key = keys.get(new URL(url).origin);
  if (key) headers.set('Authorization', `Bearer ${key}`);
  return globalThis.fetch(url, { ...init, headers });
}

// Random high port so concurrent integration suites don't collide and we
// stay clear of :7910 (live dashboard) and :7911 (vite dev).
function freshPort(): string {
  return String(17910 + Math.floor(Math.random() * 1000));
}

export interface BootedServer {
  proc: ChildProcess;
  base: string;
  port: string;
}

export async function bootServer(): Promise<BootedServer> {
  const port = freshPort();
  const base = `http://127.0.0.1:${port}`;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-integration-'));
  const proc = spawn(
    process.execPath,
    ['--import', 'tsx', path.join(ROOT, 'server.ts')],
    {
      cwd: ROOT,
      env: { PATH: process.env.PATH, HOME: home, PORT: port, HOST: '127.0.0.1', GROK_BIN: path.join(ROOT, 'test/fixtures/private-desk-agent.mjs') },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  homes.set(proc, { home, base });
  proc.stdout?.on('data', () => { /* swallow */ });
  proc.stderr?.on('data', () => { /* swallow */ });

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) {
        keys.set(base, fs.readFileSync(path.join(home, '.grok-remote/access-key'), 'utf8').trim());
        return { proc, base, port };
      }
    } catch { /* not up yet */ }
    await delay(200);
  }
  await shutdown(proc);
  throw new Error(`server did not respond at ${base}/api/health within 10s`);
}

export async function shutdown(proc: ChildProcess | null): Promise<void> {
  if (!proc) return;
  await new Promise<void>((resolve) => {
    if (proc.exitCode != null) { resolve(); return; }
    proc.once('exit', () => { clearTimeout(t); resolve(); });
    proc.kill('SIGTERM');
    // Hard kill backstop in case SIGTERM hangs.
    const t = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* ignore */ } resolve(); }, 2000);
    t.unref();
  });
  const record = homes.get(proc);
  if (record) { fs.rmSync(record.home, { recursive: true, force: true }); keys.delete(record.base); homes.delete(proc); }
}
