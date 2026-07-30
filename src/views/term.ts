// Embedded multi-tab terminal (xterm.js ↔ node-pty via /api/term).
// Keyboard: tmux-style Ctrl-b prefix, Ctrl+Tab, Ctrl+Shift+T/W.

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { el } from '../lib/render.js';
import { api } from '../lib/api.js';
import { iconHtml } from '../lib/icons.js';
import { copyToClipboard } from '../lib/copy.js';
import type { SurfaceKeyHandler } from '../lib/desk-keys.js';
import {
  rememberTermLastKind,
  rememberTermTabs,
  getTermTabs,
  getTermLastKind,
  type DeskTermIntent,
} from '../lib/desk-furniture.js';

export interface TermInfo {
  id: string;
  name: string;
  kind: string;
  cwd: string;
  alive: boolean;
  pid: number;
  cmd?: string;
}

interface TabState {
  info: TermInfo;
  term: Terminal;
  fit: FitAddon;
  ws: WebSocket | null;
  mountEl: HTMLElement;
  disposed: boolean;
}

type TermKind = 'shell' | 'grok' | 'grok-dashboard';

const KIND_META: Record<string, { icon: string; label: string; short: string }> = {
  shell: { icon: 'terminal', label: 'Shell', short: 'shell' },
  grok: { icon: 'spark', label: 'Grok', short: 'grok' },
  'grok-dashboard': { icon: 'dash', label: 'Dash', short: 'dash' },
};

function kindMeta(kind: string) {
  return KIND_META[kind] || { icon: 'terminal', label: kind, short: kind };
}

function shortenPath(cwd: string): string {
  if (!cwd) return '';
  const home = typeof cwd === 'string' && cwd.startsWith('/Users/')
    ? cwd.replace(/^\/Users\/[^/]+/, '~')
    : cwd;
  if (home.length <= 48) return home;
  const parts = home.split('/');
  if (parts.length <= 3) return home;
  return `…/${parts.slice(-2).join('/')}`;
}

export class TermView {
  root: HTMLElement;
  private tabsEl!: HTMLElement;
  private hostEl!: HTMLElement;
  private metaEl!: HTMLElement;
  private actionsEl!: HTMLElement;
  private prefixHintEl!: HTMLElement;
  private tabs = new Map<string, TabState>();
  private activeId: string | null = null;
  private onResize: () => void;
  private onDeskTerm: (ev: Event) => void;
  private restoring = false;
  private restoreNoteEl: HTMLElement | null = null;

  constructor() {
    this.onResize = () => {
      const t = this.activeId ? this.tabs.get(this.activeId) : null;
      if (t && !t.disposed) {
        try {
          t.fit.fit();
          const dims = t.fit.proposeDimensions();
          if (dims && t.ws?.readyState === WebSocket.OPEN) {
            t.ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
          }
        } catch { /* ignore */ }
      }
    };

    this.onDeskTerm = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { action?: string; kind?: string } | undefined;
      if (!detail?.action) return;
      if (detail.action === 'new') {
        const kind: TermKind = (detail.kind === 'grok' || detail.kind === 'grok-dashboard')
          ? detail.kind
          : 'shell';
        void this.create(kind);
      } else if (detail.action === 'close') {
        void this.closeActive();
      } else if (detail.action === 'next') {
        this.cycleTab(1);
      } else if (detail.action === 'prev') {
        this.cycleTab(-1);
      }
    };

    this.tabsEl = el('div', { class: 'term-tabs', role: 'tablist', 'aria-label': 'Terminal sessions' });
    this.hostEl = el('div', { class: 'term-host' });
    this.metaEl = el('div', { class: 'term-meta' });
    this.prefixHintEl = el('div', {
      class: 'term-prefix-hint',
      hidden: true,
      'aria-live': 'polite',
    },
      el('kbd', {}, 'Ctrl-b'),
      ' prefix · n/p tabs · c shell · g grok · d dash · x close · 1–9',
    );
    this.actionsEl = el('div', { class: 'term-actions' },
      el('span', {
        class: 'term-key-chip',
        title: 'tmux-style prefix for tab control while the PTY has focus',
      },
        el('kbd', {}, 'C-b'),
        ' prefix',
      ),
      this.actionBtn({
        kind: 'shell',
        title: 'New shell (Ctrl-b c · Ctrl+Shift+T)',
        icon: 'terminal',
        label: 'shell',
        primary: true,
      }),
      this.actionBtn({
        kind: 'grok',
        title: 'New Grok Build session (Ctrl-b g)',
        icon: 'spark',
        label: 'grok',
      }),
      this.actionBtn({
        kind: 'grok-dashboard',
        title: 'Open official Agent Dashboard inside an embedded terminal (Ctrl-b d)',
        icon: 'dash',
        label: 'dash',
      }),
      el('span', { class: 'term-actions-sep', 'aria-hidden': 'true' }),
      el('button', {
        class: 'term-action term-action--danger',
        type: 'button',
        title: 'Close active tab (Ctrl-b x · Ctrl+Shift+W)',
        'aria-label': 'Close active tab',
        onclick: () => { void this.closeActive(); },
      },
        el('span', { class: 'term-action-ico', html: iconHtml('x') }),
        el('span', { class: 'term-action-label' }, 'close'),
      ),
    );

    this.root = el('div', { class: 'term-view' },
      el('div', { class: 'term-toolbar' },
        el('div', { class: 'term-toolbar-brand' },
          el('span', { class: 'term-toolbar-mark', html: iconHtml('terminal') }),
          el('div', { class: 'term-toolbar-titles' },
            el('span', { class: 'term-toolbar-title' }, 'Terminal'),
            el('span', { class: 'term-toolbar-sub' }, 'ink shell · keys first'),
          ),
        ),
        el('div', { class: 'term-toolbar-main' },
          el('div', { class: 'term-toolbar-left' }, this.tabsEl),
          el('div', { class: 'term-toolbar-right' }, this.actionsEl),
        ),
        this.metaEl,
      ),
      this.prefixHintEl,
      this.hostEl,
    );

    this.renderMeta();
  }

  /** Surface key handler for the desk router. */
  handleKey: SurfaceKeyHandler = (ev) => {
    if (!this.root.isConnected) return false;

    const prefixKey = (ev as KeyboardEvent & { deskTermPrefixKey?: string }).deskTermPrefixKey;
    if (prefixKey != null) {
      return this.handlePrefixKey(prefixKey);
    }

    if (ev.ctrlKey && !ev.metaKey && ev.key === 'Tab') {
      this.cycleTab(ev.shiftKey ? -1 : 1);
      return true;
    }
    if (ev.ctrlKey && ev.shiftKey && (ev.key === 'T' || ev.key === 't')) {
      void this.create('shell');
      return true;
    }
    if (ev.ctrlKey && ev.shiftKey && (ev.key === 'W' || ev.key === 'w')) {
      void this.closeActive();
      return true;
    }
    return false;
  };

  onDeskAction(action: string, payload?: unknown): void {
    const p = (payload || {}) as { key?: string; dir?: number; kind?: string };
    if (action === 'term.prefix' && p.key) {
      this.handlePrefixKey(p.key);
      return;
    }
    if (action === 'term.tab') {
      this.cycleTab(p.dir === -1 ? -1 : 1);
      return;
    }
    if (action === 'term.new') {
      const kind: TermKind = (p.kind === 'grok' || p.kind === 'grok-dashboard') ? p.kind : 'shell';
      void this.create(kind);
      return;
    }
    if (action === 'term.close') {
      void this.closeActive();
    }
  }

  setPrefixArmed(armed: boolean): void {
    this.prefixHintEl.hidden = !armed;
  }

  private handlePrefixKey(key: string): boolean {
    this.setPrefixArmed(false);
    if (key === 'n' || key === 'j' || key === 'ArrowDown' || key === 'ArrowRight') {
      this.cycleTab(1);
      return true;
    }
    if (key === 'p' || key === 'k' || key === 'ArrowUp' || key === 'ArrowLeft') {
      this.cycleTab(-1);
      return true;
    }
    if (key === 'c') {
      void this.create('shell');
      return true;
    }
    if (key === 'g') {
      void this.create('grok');
      return true;
    }
    if (key === 'd') {
      void this.create('grok-dashboard');
      return true;
    }
    if (key === 'x' || key === 'w' || key === '&') {
      void this.closeActive();
      return true;
    }
    if (key >= '1' && key <= '9') {
      this.activateByIndex(Number(key) - 1);
      return true;
    }
    if (key === '?') {
      document.dispatchEvent(new CustomEvent('grok-desk:help'));
      return true;
    }
    if (key === 'l') {
      this.focusActive();
      return true;
    }
    return true;
  }

  private tabIds(): string[] {
    return [...this.tabs.keys()];
  }

  private cycleTab(dir: number): void {
    const ids = this.tabIds();
    if (!ids.length) return;
    const cur = this.activeId ? ids.indexOf(this.activeId) : -1;
    const next = cur < 0
      ? (dir > 0 ? 0 : ids.length - 1)
      : (cur + dir + ids.length) % ids.length;
    this.activate(ids[next]!);
  }

  private activateByIndex(index: number): void {
    const ids = this.tabIds();
    const id = ids[index];
    if (id) this.activate(id);
  }

  private focusActive(): void {
    const t = this.activeId ? this.tabs.get(this.activeId) : null;
    if (t && !t.disposed) {
      try { t.term.focus(); } catch { /* ignore */ }
    }
  }

  private actionBtn(opts: {
    kind: TermKind;
    title: string;
    icon: string;
    label: string;
    primary?: boolean;
  }): HTMLElement {
    return el('button', {
      class: `term-action${opts.primary ? ' term-action--primary' : ''}`,
      type: 'button',
      title: opts.title,
      'aria-label': opts.title,
      onclick: () => { void this.create(opts.kind); },
    },
      el('span', { class: 'term-action-ico', html: iconHtml(opts.icon) }),
      el('span', { class: 'term-action-label' }, opts.label),
    );
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.root);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('grok-desk:term', this.onDeskTerm);
    void this.hydrate();
  }

  unmount(): void {
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('grok-desk:term', this.onDeskTerm);
    for (const id of [...this.tabs.keys()]) this.disposeTab(id);
    try { this.root.remove(); } catch { /* ignore */ }
  }

  private async hydrate(): Promise<void> {
    try {
      // 1) Reattach live PTYs still held by the server process
      const data = await api.term.list() as { terminals?: TermInfo[] };
      const live = (data.terminals || []).filter((t) => t && t.alive);
      for (const t of live) {
        await this.attach(t);
      }

      // 2) Recreate missing intents from desk.json / localStorage
      const intents = getTermTabs();
      const covered = new Set(
        live.map((t) => this.intentKey(t.kind, t.cwd)),
      );
      const missing = intents.filter(
        (i) => !covered.has(this.intentKey(i.kind || 'shell', i.cwd || '')),
      );

      if (missing.length > 0) {
        await this.restoreIntents(missing);
      } else if (live.length === 0 && intents.length === 0) {
        // Fresh desk: seed nothing — empty state is intentional craft voice.
        // termLastKind is kept for "new session" defaults only.
        void getTermLastKind();
      }

      if (!this.activeId) {
        const first = this.tabs.keys().next().value as string | undefined;
        if (first) this.activate(first);
      }
      this.renderTabs();
      this.persistIntents();
      this.renderMeta();
    } catch (err) {
      console.error('[term] hydrate failed', err);
      this.renderTabs();
      this.renderMeta();
    }
  }

  private intentKey(kind: string, cwd: string): string {
    return `${String(kind || 'shell')}::${String(cwd || '')}`;
  }

  private normalizeKind(kind?: string): TermKind {
    if (kind === 'grok' || kind === 'grok-dashboard' || kind === 'shell') return kind;
    return 'shell';
  }

  private showRestoreNote(n: number): void {
    this.clearRestoreNote();
    this.restoreNoteEl = el('div', { class: 'term-restore-note' },
      el('span', { class: 'term-restore-note-ico', html: iconHtml('terminal') }),
      el('span', {}, `Restoring ${n} session${n === 1 ? '' : 's'} from desk…`),
    );
    this.hostEl.prepend(this.restoreNoteEl);
  }

  private clearRestoreNote(): void {
    if (this.restoreNoteEl) {
      try { this.restoreNoteEl.remove(); } catch { /* ignore */ }
      this.restoreNoteEl = null;
    }
  }

  /** Recreate PTY tabs from persisted intents (after restart / missing live). */
  private async restoreIntents(intents: DeskTermIntent[]): Promise<void> {
    if (this.restoring || !intents.length) return;
    this.restoring = true;
    const batch = intents.slice(0, 8);
    this.showRestoreNote(batch.length);
    try {
      for (const intent of batch) {
        const kind = this.normalizeKind(intent.kind);
        await this.create(kind, intent.cwd, { fromRestore: true });
      }
    } finally {
      this.restoring = false;
      this.clearRestoreNote();
    }
  }

  /**
   * Dual-write live tab intents to localStorage + desk.json.
   * When empty: only clear stored intents if allowEmpty (user closed last tab).
   * Mid-restore / native-fallback must not wipe desk termTabs.
   */
  private persistIntents(opts: { allowEmpty?: boolean } = {}): void {
    const alive = [...this.tabs.values()].filter((t) => t.info.alive);
    if (!alive.length) {
      if (opts.allowEmpty && !this.restoring) {
        rememberTermTabs([]);
      }
      return;
    }
    rememberTermTabs(alive.map((tab) => ({
      kind: tab.info.kind || 'shell',
      cwd: tab.info.cwd || undefined,
      name: tab.info.name || undefined,
    })));
    if (this.activeId) {
      const active = this.tabs.get(this.activeId);
      if (active?.info.kind) rememberTermLastKind(active.info.kind);
    } else if (alive[0]?.info.kind) {
      rememberTermLastKind(alive[0].info.kind);
    }
  }

  private renderTabs(): void {
    this.tabsEl.replaceChildren();
    for (const [id, tab] of this.tabs) {
      const meta = kindMeta(tab.info.kind);
      const active = id === this.activeId;
      const btn = el('button', {
        class: [
          'term-tab',
          active ? 'term-tab--active' : '',
          tab.info.alive ? '' : 'term-tab--dead',
          `term-tab--${meta.short}`,
        ].filter(Boolean).join(' '),
        type: 'button',
        role: 'tab',
        'aria-selected': active ? 'true' : 'false',
        title: `${tab.info.name}${tab.info.cwd ? ` · ${tab.info.cwd}` : ''}${tab.info.alive ? '' : ' (exited)'}`,
        onclick: () => this.activate(id),
      },
        el('span', {
          class: `term-tab-status${tab.info.alive ? ' term-tab-status--live' : ' term-tab-status--dead'}`,
          'aria-hidden': 'true',
        }),
        el('span', { class: 'term-tab-kind', html: iconHtml(meta.icon), 'aria-hidden': 'true' }),
        el('span', { class: 'term-tab-name' }, tab.info.name),
      );
      this.tabsEl.appendChild(btn);
    }
    if (!this.tabs.size) {
      this.tabsEl.appendChild(
        el('div', { class: 'term-tabs-empty' },
          el('span', { class: 'term-tabs-empty-ico', html: iconHtml('terminal') }),
          el('span', { class: 'term-tabs-empty-text' }, 'no sessions — c shell · g grok · d dash'),
        ),
      );
    }
  }

  private renderMeta(): void {
    this.metaEl.replaceChildren();
    const tab = this.activeId ? this.tabs.get(this.activeId) : null;
    if (!tab) {
      this.metaEl.classList.add('term-meta--empty');
      this.metaEl.append(
        el('span', { class: 'term-meta-hint' }, 'Ready · choose a session type on the right'),
      );
      return;
    }
    this.metaEl.classList.remove('term-meta--empty');
    const meta = kindMeta(tab.info.kind);
    const live = tab.info.alive;
    this.metaEl.append(
      el('span', { class: `term-meta-pill term-meta-pill--${live ? 'live' : 'dead'}` },
        el('span', { class: 'term-meta-dot', 'aria-hidden': 'true' }),
        live ? 'live' : 'exited',
      ),
      el('span', { class: 'term-meta-kind' },
        el('span', { class: 'term-meta-kind-ico', html: iconHtml(meta.icon) }),
        meta.label,
      ),
      el('span', { class: 'term-meta-sep', 'aria-hidden': 'true' }, '·'),
      el('button', {
        class: 'term-meta-cwd',
        type: 'button',
        title: tab.info.cwd ? `${tab.info.cwd} — click to copy` : '',
        disabled: !tab.info.cwd,
        onclick: async () => {
          const path = tab.info.cwd;
          if (!path) return;
          const ok = await copyToClipboard(path);
          if (!ok) return;
          const node = this.metaEl.querySelector('.term-meta-cwd');
          if (!node) return;
          node.classList.add('is-copied');
          const pathEl = node.querySelector('.term-meta-cwd-path');
          const prev = pathEl?.textContent || '';
          if (pathEl) pathEl.textContent = 'copied';
          setTimeout(() => {
            node.classList.remove('is-copied');
            if (pathEl) pathEl.textContent = prev;
          }, 1200);
        },
      },
        el('span', { class: 'term-meta-cwd-ico', html: iconHtml('folder') }),
        el('span', { class: 'term-meta-cwd-path' }, shortenPath(tab.info.cwd) || '—'),
      ),
      ...(tab.info.pid
        ? [el('span', { class: 'term-meta-pid', title: 'Process id' }, `pid ${tab.info.pid}`)]
        : []),
    );
  }

  private activate(id: string): void {
    this.activeId = id;
    for (const [tid, tab] of this.tabs) {
      tab.mountEl.hidden = tid !== id;
    }
    this.renderTabs();
    this.renderMeta();
    const t = this.tabs.get(id);
    if (t) {
      requestAnimationFrame(() => {
        try {
          t.fit.fit();
          t.term.focus();
          const dims = t.fit.proposeDimensions();
          if (dims && t.ws?.readyState === WebSocket.OPEN) {
            t.ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
          }
        } catch { /* ignore */ }
      });
    }
  }

  async create(
    kind: TermKind,
    cwd?: string,
    opts: { fromRestore?: boolean } = {},
  ): Promise<void> {
    const dims = { cols: 120, rows: 32 };
    if (!opts.fromRestore) rememberTermLastKind(kind);
    try {
      const res = await api.term.create({ kind, cwd, ...dims }) as {
        terminal?: TermInfo;
        native?: boolean;
        message?: string;
        ok?: boolean;
      };
      if (res.native) {
        // Embedded PTY unavailable — opened macOS Terminal instead
        const note = el('div', { class: 'term-native-note' },
          el('span', { class: 'term-native-note-ico', html: iconHtml('terminal') }),
          el('span', {}, res.message || 'Opened in macOS Terminal (embedded PTY unavailable in this environment).'),
        );
        this.hostEl.appendChild(note);
        setTimeout(() => { try { note.remove(); } catch { /* ignore */ } }, 5000);
        // Still remember the intent so a later PTY-capable host can restore
        if (!opts.fromRestore) {
          const prev = getTermTabs();
          rememberTermTabs([
            ...prev.filter((t) => this.intentKey(t.kind || 'shell', t.cwd || '')
              !== this.intentKey(kind, cwd || '')),
            { kind, cwd, name: kind },
          ]);
        }
        return;
      }
      if (!res.terminal) throw new Error('no terminal returned');
      await this.attach(res.terminal);
      this.activate(res.terminal.id);
      this.persistIntents();
    } catch (err) {
      console.error(err);
      if (!opts.fromRestore) {
        alert(err instanceof Error ? err.message : String(err));
      }
    }
  }

  private async attach(info: TermInfo): Promise<void> {
    if (this.tabs.has(info.id)) return;

    const mountEl = el('div', { class: 'term-surface' });
    this.hostEl.appendChild(mountEl);

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.3,
      theme: {
        // Craft-desk Atelier: wood well, warm ink, brass cursor
        background: '#161310',
        foreground: '#f0e8d8',
        cursor: '#c9a66a',
        cursorAccent: '#1a140c',
        selectionBackground: 'rgba(201, 166, 106, 0.28)',
        selectionForeground: '#f0e8d8',
        black: '#0f0d0b',
        red: '#c47a6a',
        green: '#8f9f7a',
        yellow: '#d4a85a',
        blue: '#8a9eae',
        magenta: '#9a8f9e',
        cyan: '#a89878',
        white: '#e6dcc8',
        brightBlack: '#5e574d',
        brightRed: '#d49080',
        brightGreen: '#a3b38e',
        brightYellow: '#e0bc74',
        brightBlue: '#a8b8c6',
        brightMagenta: '#b0a4b4',
        brightCyan: '#c4b090',
        brightWhite: '#f0e8d8',
      },
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(mountEl);
    try { fit.fit(); } catch { /* ignore */ }

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/term/ws?id=${encodeURIComponent(info.id)}`);

    const tab: TabState = { info, term, fit, ws, mountEl, disposed: false };
    this.tabs.set(info.id, tab);

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as { type: string; data?: string };
        if (msg.type === 'snapshot' || msg.type === 'data') {
          if (msg.data) term.write(msg.data);
        } else if (msg.type === 'exit') {
          term.writeln('\r\n\x1b[90m[process exited]\x1b[0m');
          tab.info.alive = false;
          this.renderTabs();
          this.renderMeta();
        } else if (msg.type === 'error') {
          term.writeln(`\r\n\x1b[31m[error] ${String((msg as { message?: string }).message || '')}\x1b[0m`);
        }
      } catch { /* ignore */ }
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    ws.onopen = () => {
      try {
        fit.fit();
        const d = fit.proposeDimensions();
        if (d) ws.send(JSON.stringify({ type: 'resize', cols: d.cols, rows: d.rows }));
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      tab.info.alive = false;
      this.renderTabs();
      this.persistIntents();
      this.renderMeta();
    };

    mountEl.hidden = this.activeId !== null && this.activeId !== info.id;
    this.renderTabs();
    this.renderMeta();
  }

  private disposeTab(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    tab.disposed = true;
    try { tab.ws?.close(); } catch { /* ignore */ }
    try { tab.term.dispose(); } catch { /* ignore */ }
    try { tab.mountEl.remove(); } catch { /* ignore */ }
    this.tabs.delete(id);
    const empty = this.tabs.size === 0;
    this.persistIntents({ allowEmpty: empty });
    if (this.activeId === id) {
      this.activeId = this.tabs.keys().next().value || null;
      if (this.activeId) this.activate(this.activeId);
      else {
        this.renderTabs();
        this.renderMeta();
      }
    } else {
      this.renderTabs();
      this.renderMeta();
    }
  }

  private async closeActive(): Promise<void> {
    if (!this.activeId) return;
    const id = this.activeId;
    try { await api.term.kill(id); } catch { /* ignore */ }
    this.disposeTab(id);
  }
}
