// Launch native companion apps (GrokTerm, Grok Dashboard in Terminal).
// Bound to localhost-only control plane; never accept arbitrary commands.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface LaunchResult {
  ok: boolean;
  action: string;
  message: string;
  pid?: number;
}

function exists(p: string): boolean {
  try { return fs.existsSync(p); } catch { return false; }
}

export function probeNative(): {
  groktermApp: boolean;
  groktermCli: boolean;
  grokCli: boolean;
  paths: Record<string, string | null>;
} {
  const home = os.homedir();
  const groktermApp = '/Applications/GrokTerm.app';
  const groktermCli = path.join(home, '.local', 'bin', 'grokterm');
  const grokCli = path.join(home, '.local', 'bin', 'grok');
  const grokBin = path.join(home, '.grok', 'bin', 'grok');
  return {
    groktermApp: exists(groktermApp),
    groktermCli: exists(groktermCli),
    grokCli: exists(grokCli) || exists(grokBin),
    paths: {
      groktermApp: exists(groktermApp) ? groktermApp : null,
      groktermCli: exists(groktermCli) ? groktermCli : null,
      grokCli: exists(grokCli) ? grokCli : (exists(grokBin) ? grokBin : null),
    },
  };
}

export function launchGrokTerm(cwd?: string): LaunchResult {
  const p = probeNative();
  const home = os.homedir();
  const work = cwd || path.join(home, 'Projects', 'grok');
  // Prefer the polished local launcher when present (configures cwd + Grok tab).
  const launcher = path.join(home, '.local', 'bin', 'grokterm-app');
  if (exists(launcher) && process.platform === 'darwin') {
    const child = spawn(launcher, [], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, GROKTERM_PROJECT: work, PATH: `${path.join(home, '.local', 'bin')}:${process.env.PATH || ''}` },
    });
    child.unref();
    return { ok: true, action: 'grokterm-app-launcher', message: 'Launched GrokTerm (playground Grok tab)', pid: child.pid };
  }
  if (p.groktermApp && process.platform === 'darwin') {
    const child = spawn('open', ['-na', 'GrokTerm', '--args', '--grok', '-C', work], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return { ok: true, action: 'grokterm-app', message: 'Launched GrokTerm.app with Grok tab', pid: child.pid };
  }
  if (p.paths.groktermCli) {
    const child = spawn(p.paths.groktermCli, ['-C', work, '--grok'], {
      detached: true,
      stdio: 'ignore',
      cwd: work,
    });
    child.unref();
    return { ok: true, action: 'grokterm-cli', message: 'Launched grokterm CLI', pid: child.pid };
  }
  return {
    ok: false,
    action: 'grokterm',
    message: 'GrokTerm not found. Install from https://www.grokterm.com/',
  };
}

export function launchGrokDashboard(): LaunchResult {
  const p = probeNative();
  const grok = p.paths.grokCli;
  if (!grok) {
    return { ok: false, action: 'grok-dashboard', message: 'grok CLI not found' };
  }
  const home = os.homedir();
  const work = path.join(home, 'local-agent-stack', 'playground');
  const workDir = exists(work) ? work : home;
  if (process.platform === 'darwin') {
    // Single clean Terminal tab: export PATH, cd playground, open dashboard only.
    const cmd = [
      `export PATH="${path.join(home, '.local', 'bin')}:${path.join(home, '.grok', 'bin')}:$PATH"`,
      `cd ${JSON.stringify(workDir)}`,
      `${JSON.stringify(grok)} dashboard`,
    ].join(' && ');
    const script = `tell application "Terminal"\nactivate\ndo script ${JSON.stringify(cmd)}\nend tell`;
    const child = spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true, action: 'grok-dashboard', message: 'Opened grok dashboard in Terminal', pid: child.pid };
  }
  const child = spawn(grok, ['dashboard'], {
    detached: true,
    stdio: 'ignore',
    cwd: workDir,
    env: { ...process.env, PATH: `${path.join(home, '.local', 'bin')}:${path.join(home, '.grok', 'bin')}:${process.env.PATH || ''}` },
  });
  child.unref();
  return { ok: true, action: 'grok-dashboard', message: 'Spawned grok dashboard', pid: child.pid };
}

/** Open a shell or grok in macOS Terminal.app (fallback when embedded PTY is unavailable). */
export function launchMacTerminal(kind: 'shell' | 'grok' | 'grok-dashboard' = 'shell', cwd?: string): LaunchResult {
  if (process.platform !== 'darwin') {
    return { ok: false, action: 'mac-terminal', message: 'macOS Terminal launch only available on Darwin' };
  }
  const p = probeNative();
  const dir = (cwd || os.homedir()).replace(/"/g, '\\"');
  let cmd = `cd "${dir}" && exec "$SHELL" -l`;
  if (kind === 'grok' && p.paths.grokCli) {
    cmd = `cd "${dir}" && ${p.paths.grokCli.replace(/"/g, '\\"')}`;
  } else if (kind === 'grok-dashboard' && p.paths.grokCli) {
    cmd = `cd "${dir}" && ${p.paths.grokCli.replace(/"/g, '\\"')} dashboard`;
  }
  const script = `tell application "Terminal" to do script "${cmd.replace(/"/g, '\\"')}"`;
  const child = spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' });
  child.unref();
  return { ok: true, action: 'mac-terminal', message: `Opened ${kind} in Terminal.app`, pid: child.pid };
}
