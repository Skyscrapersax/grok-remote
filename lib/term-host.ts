// Multi-tab PTY host for Grok Deck — shell / grok / custom commands.
// Browser talks over WebSocket; we keep real PTYs server-side (node-pty).

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pty from 'node-pty';

export type TermKind = 'shell' | 'grok' | 'grok-dashboard' | 'custom';

export interface TermRecord {
  id: string;
  name: string;
  kind: TermKind;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: string;
  lastActivity: string;
  pid: number;
  alive: boolean;
  cmd: string;
}

interface LiveTerm {
  record: TermRecord;
  proc: pty.IPty;
  buffer: string; // recent scrollback for reconnect
}

const MAX_BUFFER = 80_000;

function defaultShell(): string {
  if (process.env['SHELL']) return process.env['SHELL'];
  if (process.platform === 'win32') return process.env['COMSPEC'] || 'cmd.exe';
  return '/bin/zsh';
}

function whichGrok(): string {
  const home = os.homedir();
  const candidates = [
    path.join(home, '.local', 'bin', 'grok'),
    path.join(home, '.grok', 'bin', 'grok'),
    '/usr/local/bin/grok',
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch { /* ignore */ }
  }
  return 'grok';
}

export class TermHost extends EventEmitter {
  private terms = new Map<string, LiveTerm>();

  list(): TermRecord[] {
    return [...this.terms.values()].map((t) => ({ ...t.record }));
  }

  get(id: string): TermRecord | null {
    const t = this.terms.get(id);
    return t ? { ...t.record } : null;
  }

  spawn(opts: {
    kind?: TermKind;
    name?: string;
    cwd?: string;
    cols?: number;
    rows?: number;
    cmd?: string;
    args?: string[];
  } = {}): TermRecord {
    const kind: TermKind = opts.kind || 'shell';
    const cwd = opts.cwd || process.env['HOME'] || os.homedir();
    const cols = opts.cols || 120;
    const rows = opts.rows || 32;
    const id = randomUUID();

    let file: string;
    let args: string[] = [];
    let name = opts.name || '';

    if (kind === 'shell') {
      file = defaultShell();
      args = process.platform === 'darwin' || process.platform === 'linux' ? ['-l'] : [];
      name = name || 'shell';
    } else if (kind === 'grok') {
      file = whichGrok();
      args = opts.args || [];
      name = name || 'grok';
    } else if (kind === 'grok-dashboard') {
      file = whichGrok();
      args = ['dashboard'];
      name = name || 'dashboard';
    } else {
      file = opts.cmd || defaultShell();
      args = opts.args || [];
      name = name || path.basename(file);
    }

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      // Allow color in child even if parent has NO_COLOR
    };
    delete env['NO_COLOR'];

    let proc: pty.IPty;
    try {
      proc = pty.spawn(file, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to open PTY (${msg}). Embedded terminals need a normal local environment with PTY support. `
        + `Use Deck → Launch GrokTerm / Native TUI, or run \`gd grokterm\` / \`gd tui\`.`,
      );
    }

    const record: TermRecord = {
      id,
      name,
      kind,
      cwd,
      cols,
      rows,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      pid: proc.pid,
      alive: true,
      cmd: [file, ...args].join(' '),
    };

    const live: LiveTerm = { record, proc, buffer: '' };
    this.terms.set(id, live);

    proc.onData((data: string) => {
      live.record.lastActivity = new Date().toISOString();
      live.buffer += data;
      if (live.buffer.length > MAX_BUFFER) {
        live.buffer = live.buffer.slice(-MAX_BUFFER);
      }
      this.emit(`data:${id}`, data);
      this.emit('activity', { id, kind: 'data' });
    });

    proc.onExit(({ exitCode, signal }) => {
      live.record.alive = false;
      this.emit(`exit:${id}`, { exitCode, signal });
      this.emit('activity', { id, kind: 'exit', exitCode, signal });
      // Keep record briefly so UI can show exit; drop after delay
      setTimeout(() => {
        this.terms.delete(id);
        this.emit('list_changed');
      }, 30_000);
      this.emit('list_changed');
    });

    this.emit('list_changed');
    this.emit('spawned', record);
    return { ...record };
  }

  write(id: string, data: string): boolean {
    const t = this.terms.get(id);
    if (!t || !t.record.alive) return false;
    t.proc.write(data);
    t.record.lastActivity = new Date().toISOString();
    return true;
  }

  resize(id: string, cols: number, rows: number): boolean {
    const t = this.terms.get(id);
    if (!t || !t.record.alive) return false;
    const c = Math.max(20, Math.min(500, cols | 0));
    const r = Math.max(5, Math.min(200, rows | 0));
    t.proc.resize(c, r);
    t.record.cols = c;
    t.record.rows = r;
    return true;
  }

  kill(id: string): boolean {
    const t = this.terms.get(id);
    if (!t) return false;
    try { t.proc.kill(); } catch { /* ignore */ }
    t.record.alive = false;
    this.terms.delete(id);
    this.emit('list_changed');
    return true;
  }

  /** Scrollback snapshot for reconnecting clients */
  snapshot(id: string): string {
    return this.terms.get(id)?.buffer || '';
  }

  subscribe(
    id: string,
    handlers: {
      onData?: (data: string) => void;
      onExit?: (info: { exitCode: number; signal?: number }) => void;
    },
  ): () => void {
    const onData = (d: string) => handlers.onData?.(d);
    const onExit = (info: { exitCode: number; signal?: number }) => handlers.onExit?.(info);
    this.on(`data:${id}`, onData);
    this.on(`exit:${id}`, onExit);
    return () => {
      this.off(`data:${id}`, onData);
      this.off(`exit:${id}`, onExit);
    };
  }

  shutdownAll(): void {
    for (const id of [...this.terms.keys()]) {
      this.kill(id);
    }
  }
}
