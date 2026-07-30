// Grok Dash — multi-agent ops board for Grok Remote.
// Inspired by the official Grok Build Agent Dashboard (`grok dashboard`):
// state-grouped roster, peek + reply, live SSE, dispatch bar, quick actions.

import { api } from '../lib/api.js';
import { el } from '../lib/render.js';
import { fmtTokens } from '../lib/format.js';
import { fetchVoiceStatus } from '../lib/voice.js';
import {
  getDashCollapsed,
  getDashGroupMode,
  getDashSearch,
  rememberDashCollapsed,
  rememberDashGroupMode,
  rememberDashSearch,
} from '../lib/desk-furniture.js';

export interface DashAgent {
  id: string;
  name?: string;
  model?: string | null;
  status?: string;
  connected?: boolean;
  cwd?: string | null;
  createdAt?: string;
  lastSeen?: string;
  starred?: boolean;
  archived?: boolean;
  totalTokens?: number;
  inFlight?: number;
  lastError?: string | null;
  sessionId?: string | null;
  [k: string]: unknown;
}

type GroupKey = 'needs' | 'working' | 'starting' | 'idle' | 'disconnected' | 'archived';
type GroupMode = 'state' | 'cwd';

interface GroupDef {
  key: GroupKey;
  label: string;
}

const GROUPS: GroupDef[] = [
  { key: 'needs', label: 'Needs attention' },
  { key: 'working', label: 'Working' },
  { key: 'starting', label: 'Starting' },
  { key: 'idle', label: 'Idle' },
  { key: 'disconnected', label: 'Disconnected' },
  { key: 'archived', label: 'Archived' },
];

function loadCollapsed(): Set<string> {
  const fromDesk = getDashCollapsed();
  if (fromDesk.length) return new Set(fromDesk);
  return new Set(['archived']);
}

function saveCollapsed(set: Set<string>): void {
  rememberDashCollapsed([...set]);
}

function loadSearch(): string {
  return getDashSearch();
}
function saveSearch(v: string): void {
  rememberDashSearch(v);
}

function loadGroupMode(): GroupMode {
  return getDashGroupMode();
}
function saveGroupMode(m: GroupMode): void {
  rememberDashGroupMode(m);
}

function classify(a: DashAgent): GroupKey {
  if (a.archived) return 'archived';
  const st = String(a.status || '');
  if (st === 'errored' || a.lastError) return 'needs';
  if (st === 'running' || (typeof a.inFlight === 'number' && a.inFlight > 0)) return 'working';
  if (st === 'starting') return 'starting';
  if (st === 'disconnected' || st === 'exited' || st === 'killed') return 'disconnected';
  if (a.connected === false) return 'disconnected';
  if (st === 'idle' || !st) return 'idle';
  return 'idle';
}

function relTime(iso?: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 45) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function activityLine(a: DashAgent): string {
  const st = String(a.status || 'unknown');
  if (st === 'errored' || a.lastError) {
    return String(a.lastError || 'error').slice(0, 80);
  }
  const cwd = String(a.cwd || '');
  const isDemo = /deck-demos|dashboard-demo/.test(cwd);
  if (typeof a.inFlight === 'number' && a.inFlight > 0) {
    if (isDemo) return 'heartbeat running · tool in flight';
    return `${a.inFlight} tool${a.inFlight === 1 ? '' : 's'} in flight`;
  }
  if (st === 'running') return isDemo ? 'demo turn running' : 'turn running';
  if (st === 'starting') return 'starting agent…';
  if (st === 'disconnected' || st === 'exited' || st === 'killed') return st;
  if (a.totalTokens) return `${fmtTokens(a.totalTokens)} tokens`;
  return st || 'idle';
}

function historySnippet(events: unknown[]): { role: string; text: string }[] {
  const out: { role: string; text: string }[] = [];
  let userBuf = '';
  let asstBuf = '';
  let thoughtBuf = '';

  const flushAsst = () => {
    const t = (asstBuf || thoughtBuf).trim();
    if (t) out.push({ role: 'assistant', text: t.slice(0, 400) });
    asstBuf = '';
    thoughtBuf = '';
  };
  const flushUser = () => {
    const t = userBuf.trim();
    if (t) out.push({ role: 'user', text: t.slice(0, 400) });
    userBuf = '';
  };

  for (const raw of events) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    const ev = String(e['event'] || e['type'] || '');
    const data = (e['data'] && typeof e['data'] === 'object') ? e['data'] as Record<string, unknown> : e;

    // User prompts may appear as various event names / stream chunks
    if (
      ev === 'user_message' || ev === 'prompt' || ev === 'user'
      || ev === 'user_message_chunk' || ev === 'user_prompt_chunk'
    ) {
      const t = extractText(data) || extractText(e);
      if (ev.endsWith('_chunk')) {
        if (t) userBuf += t;
        continue;
      }
      flushAsst();
      if (t) {
        userBuf = t;
        flushUser();
      }
      continue;
    }
    if (ev === 'agent_message_chunk' || ev === 'message_chunk') {
      const t = extractText(data) || extractText(e);
      if (t) asstBuf += t;
      continue;
    }
    if (ev === 'agent_thought_chunk') {
      const t = extractText(data) || extractText(e);
      if (t) thoughtBuf += t;
      continue;
    }
    // Surface tool activity so peek shows heartbeats / long-running commands
    if (ev === 'tool_call' || ev === 'tool_call_update') {
      flushUser();
      flushAsst();
      const title = extractToolTitle(data) || extractToolTitle(e);
      if (title) out.push({ role: 'tool', text: title.slice(0, 400) });
      continue;
    }
    if (ev === 'prompt_complete' || ev === 'agent_status') {
      flushUser();
      flushAsst();
      continue;
    }
    // Some histories store composed user text on prompt accept debug lines
    if (ev === 'prompt_accepted' || ev === 'user_prompt') {
      flushAsst();
      const t = String(data['text'] || data['composedText'] || '').trim();
      if (t) {
        userBuf = t;
        flushUser();
      }
    }
  }
  flushUser();
  flushAsst();
  return out.slice(-10);
}

function extractToolTitle(obj: Record<string, unknown>): string {
  const update = (obj['update'] && typeof obj['update'] === 'object')
    ? obj['update'] as Record<string, unknown>
    : obj;
  const title = update['title'];
  if (typeof title === 'string' && title.trim()) return title.trim();
  const raw = update['rawInput'];
  if (raw && typeof raw === 'object') {
    const cmd = (raw as { command?: unknown }).command;
    if (typeof cmd === 'string' && cmd.trim()) return `Run \`${cmd.trim()}\``;
  }
  const meta = update['_meta'];
  if (meta && typeof meta === 'object') {
    const tool = (meta as { 'x.ai/tool'?: { input?: { command?: string }; label?: string } })['x.ai/tool'];
    if (tool?.input?.command) return `Run \`${tool.input.command}\``;
    if (tool?.label) return tool.label;
  }
  return '';
}

function extractText(obj: Record<string, unknown>): string {
  if (typeof obj['text'] === 'string') return obj['text'];
  const content = obj['content'];
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object') {
    const c = content as Record<string, unknown>;
    if (typeof c['text'] === 'string') return c['text'];
  }
  const update = obj['update'];
  if (update && typeof update === 'object') {
    const u = update as Record<string, unknown>;
    const c = u['content'];
    if (c && typeof c === 'object' && typeof (c as { text?: string }).text === 'string') {
      return (c as { text: string }).text;
    }
    if (Array.isArray(c)) {
      const parts: string[] = [];
      for (const item of c) {
        if (!item || typeof item !== 'object') continue;
        const block = item as { type?: string; content?: { type?: string; text?: string }; text?: string };
        if (typeof block.text === 'string') parts.push(block.text);
        else if (block.content && typeof block.content.text === 'string') parts.push(block.content.text);
      }
      if (parts.length) return parts.join('');
    }
    if (typeof u['text'] === 'string') return u['text'];
  }
  return '';
}

export class DashView {
  root: HTMLElement;
  private boardEl!: HTMLElement;
  private listEl!: HTMLElement;
  private peekEl!: HTMLElement;
  private peekBody!: HTMLElement;
  private peekTitle!: HTMLElement;
  private peekReply!: HTMLTextAreaElement;
  private headerMeta!: HTMLElement;
  private voiceChip!: HTMLElement;
  private dispatchTa!: HTMLTextAreaElement;
  private dispatchCwd!: HTMLInputElement;
  private dispatchName!: HTMLInputElement;
  private searchInput!: HTMLInputElement;
  private groupBtn!: HTMLButtonElement;
  private agents: DashAgent[] = [];
  private collapsed = loadCollapsed();
  private search = loadSearch();
  private groupMode: GroupMode = loadGroupMode();
  private selectedId: string | null = null;
  private onAgentsRefresh: (ev: Event) => void;
  private toastEl: HTMLElement | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private es: EventSource | null = null;
  private peekLoading = false;

  constructor() {
    this.onAgentsRefresh = (ev: Event) => {
      const list = ((ev as CustomEvent).detail || []) as DashAgent[];
      if (Array.isArray(list)) {
        this.agents = list;
        this.render();
      }
    };

    this.root = el('div', { class: 'dash' });

    this.headerMeta = el('div', { class: 'dash-header-meta' }, 'Loading…');
    this.voiceChip = el('button', {
      class: 'dash-voice-chip',
      type: 'button',
      title: 'Voice status — open a chat and use the voice button for speech',
      onclick: () => { void this.showVoiceHint(); },
    }, 'Voice · …') as HTMLButtonElement;

    const header = el('div', { class: 'dash-header' },
      el('div', { class: 'dash-title-row' },
        el('h1', { class: 'dash-title' }, 'Grok Dash'),
        this.headerMeta,
        this.voiceChip,
      ),
      el('p', { class: 'dash-sub' },
        'Web twin of ',
        el('code', {}, 'grok dashboard'),
        '. ',
        el('kbd', {}, 'j/k'),
        ' move · ',
        el('kbd', {}, 'enter/o'),
        ' open · ',
        el('kbd', {}, '/'),
        ' search · ',
        el('kbd', {}, 'n'),
        ' dispatch · ',
        el('kbd', {}, 'p'),
        ' reply · ',
        el('kbd', {}, 'x'),
        ' cancel · ',
        el('kbd', {}, '?'),
        ' help.',
      ),
    );

    this.searchInput = el('input', {
      class: 'dash-search',
      type: 'search',
      placeholder: 'Search agents by name, model, or path…',
      value: this.search,
      oninput: (ev: Event) => {
        this.search = (ev.target as HTMLInputElement).value;
        saveSearch(this.search);
        this.renderList();
      },
    }) as HTMLInputElement;

    this.groupBtn = el('button', {
      class: 'btn btn--ghost dash-group-btn',
      type: 'button',
      title: 'Toggle grouping: state ↔ working directory',
      onclick: () => {
        this.groupMode = this.groupMode === 'state' ? 'cwd' : 'state';
        saveGroupMode(this.groupMode);
        this.groupBtn.textContent = this.groupMode === 'state' ? 'Group · State' : 'Group · Path';
        this.renderList();
      },
    }, this.groupMode === 'state' ? 'Group · State' : 'Group · Path') as HTMLButtonElement;

    this.listEl = el('div', { class: 'dash-list' });

    this.peekTitle = el('div', { class: 'dash-peek-title' }, 'Peek panel');
    this.peekBody = el('div', { class: 'dash-peek-body' },
      el('div', { class: 'dash-peek-empty' }, 'no agent · j/k to move'),
    );
    this.peekReply = el('textarea', {
      class: 'dash-peek-reply',
      rows: '2',
      placeholder: 'Reply to the selected agent… Enter to send',
      onkeydown: (ev: KeyboardEvent) => {
        if (ev.key === 'Enter' && !ev.shiftKey) {
          ev.preventDefault();
          void this.replySelected();
        }
      },
    }) as HTMLTextAreaElement;

    this.peekEl = el('aside', { class: 'dash-peek' },
      this.peekTitle,
      this.peekBody,
      el('div', { class: 'dash-peek-actions' },
        el('button', {
          class: 'btn btn--ghost',
          type: 'button',
          onclick: () => {
            if (this.selectedId) location.hash = `#/agents/${encodeURIComponent(this.selectedId)}`;
          },
        }, 'Open full'),
        el('button', {
          class: 'btn btn--ghost',
          type: 'button',
          onclick: () => {
            const a = this.agents.find((x) => x.id === this.selectedId);
            if (a) void this.cancel(a);
          },
        }, 'Cancel turn'),
        el('button', {
          class: 'btn btn--primary',
          type: 'button',
          onclick: () => { void this.replySelected(); },
        }, 'Send reply'),
      ),
      this.peekReply,
    );

    this.boardEl = el('div', { class: 'dash-board' },
      el('div', { class: 'dash-board-list' }, this.listEl),
      this.peekEl,
    );

    this.dispatchName = el('input', {
      class: 'dash-dispatch-name',
      type: 'text',
      placeholder: 'name (optional)',
    }) as HTMLInputElement;
    this.dispatchCwd = el('input', {
      class: 'dash-dispatch-cwd',
      type: 'text',
      placeholder: 'cwd (optional, default from settings)',
    }) as HTMLInputElement;
    this.dispatchTa = el('textarea', {
      class: 'dash-dispatch-input',
      rows: '2',
      placeholder: 'Dispatch a new agent — describe the task and press Enter (Shift+Enter for newline)',
      onkeydown: (ev: KeyboardEvent) => {
        if (ev.key === 'Enter' && !ev.shiftKey) {
          ev.preventDefault();
          void this.dispatch();
        }
      },
    }) as HTMLTextAreaElement;

    const dispatchBar = el('div', { class: 'dash-dispatch' },
      el('div', { class: 'dash-dispatch-meta' },
        this.dispatchName,
        this.dispatchCwd,
      ),
      this.dispatchTa,
      el('div', { class: 'dash-dispatch-actions' },
        el('button', {
          class: 'btn btn--ghost',
          type: 'button',
          onclick: () => { void this.refresh(); },
        }, 'Refresh'),
        el('button', {
          class: 'btn btn--primary',
          type: 'button',
          onclick: () => { void this.dispatch(); },
        }, 'Dispatch'),
      ),
    );

    this.root.append(
      header,
      el('div', { class: 'dash-toolbar' }, this.searchInput, this.groupBtn),
      this.boardEl,
      dispatchBar,
    );
  }

  /** Surface key handler for the desk router (nav mode only). */
  handleKey = (ev: KeyboardEvent): boolean => {
    if (!this.root.isConnected) return false;
    const flat = this.flatVisible();

    if (ev.key === 'Escape') {
      if (this.selectedId) {
        this.selectedId = null;
        this.renderList();
        this.renderPeek();
        return true;
      }
      return false;
    }

    if (ev.key === '/' && !ev.metaKey && !ev.ctrlKey) {
      this.searchInput.focus();
      this.searchInput.select();
      return true;
    }
    if (ev.key === 'n' && !ev.metaKey && !ev.ctrlKey) {
      this.dispatchTa.focus();
      return true;
    }
    if (ev.key === 'p' && !ev.metaKey && !ev.ctrlKey && this.selectedId) {
      this.peekReply.focus();
      return true;
    }

    if (!flat.length) return false;
    let idx = flat.findIndex((a) => a.id === this.selectedId);
    if (idx < 0) idx = 0;

    if (ev.key === 'j' || ev.key === 'ArrowDown') {
      const next = flat[Math.min(flat.length - 1, (this.selectedId ? idx + 1 : 0))];
      if (next) this.select(next.id);
      return true;
    }
    if (ev.key === 'k' || ev.key === 'ArrowUp') {
      const prev = flat[Math.max(0, this.selectedId ? idx - 1 : 0)];
      if (prev) this.select(prev.id);
      return true;
    }
    if ((ev.key === 'Enter' || ev.key === 'o') && this.selectedId) {
      location.hash = `#/agents/${encodeURIComponent(this.selectedId)}`;
      return true;
    }
    if (ev.key === 'r' && this.selectedId) {
      const a = this.agents.find((x) => x.id === this.selectedId);
      if (a) void this.rename(a);
      return true;
    }
    if (ev.key === 'x' && this.selectedId) {
      const a = this.agents.find((x) => x.id === this.selectedId);
      if (a && (a.status === 'running' || (a.inFlight && a.inFlight > 0))) void this.cancel(a);
      return true;
    }
    if (ev.key === 'g' || ev.key === 'G') {
      // gg / G delivered via onDeskAction when chord resolves
      return false;
    }
    return false;
  };

  onDeskAction(action: string): void {
    const flat = this.flatVisible();
    if (!flat.length) return;
    if (action === 'motion.gg') this.select(flat[0]!.id);
    else if (action === 'motion.G') this.select(flat[flat.length - 1]!.id);
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.root);
    document.addEventListener('grok-remote:agents-refresh', this.onAgentsRefresh);
    this.openStream();
    void this.refresh();
    void this.refreshVoiceChip();
    this.pollTimer = setInterval(() => { void this.refresh(true); }, 12000);
  }

  unmount(): void {
    document.removeEventListener('grok-remote:agents-refresh', this.onAgentsRefresh);
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.es) {
      try { this.es.close(); } catch { /* ignore */ }
      this.es = null;
    }
    try { this.root.remove(); } catch { /* ignore */ }
  }

  private openStream(): void {
    if (this.es) return;
    try {
      const es = new EventSource(api.agentsStreamUrl());
      this.es = es;
      es.addEventListener('agents_snapshot', (ev: MessageEvent) => {
        try {
          const d = JSON.parse(String(ev.data)) as { agents?: DashAgent[] };
          if (Array.isArray(d.agents)) {
            this.agents = d.agents;
            document.dispatchEvent(new CustomEvent('grok-remote:agents-refresh', { detail: this.agents }));
            this.render();
          }
        } catch { /* ignore */ }
      });
      const onMutation = (): void => { void this.refresh(true); };
      for (const name of ['agent_added', 'agent_removed', 'agent_updated', 'agent_status'] as const) {
        es.addEventListener(name, onMutation);
      }
      es.addEventListener('agent_tokens', (ev: MessageEvent) => {
        try {
          const d = JSON.parse(String(ev.data)) as { id?: string; totalTokens?: number };
          if (!d?.id || typeof d.totalTokens !== 'number') return;
          const idx = this.agents.findIndex((a) => a.id === d.id);
          if (idx < 0) return;
          this.agents[idx] = { ...this.agents[idx]!, totalTokens: d.totalTokens };
          this.render();
        } catch { /* ignore */ }
      });
      es.addEventListener('agent_inflight', (ev: MessageEvent) => {
        try {
          const d = JSON.parse(String(ev.data)) as { id?: string; inFlight?: number };
          if (!d?.id || typeof d.inFlight !== 'number') return;
          const idx = this.agents.findIndex((a) => a.id === d.id);
          if (idx < 0) return;
          this.agents[idx] = { ...this.agents[idx]!, inFlight: d.inFlight };
          this.render();
        } catch { /* ignore */ }
      });
    } catch { /* ignore */ }
  }

  private async refreshVoiceChip(): Promise<void> {
    try {
      const st = await fetchVoiceStatus();
      this.voiceChip.textContent = st.ok ? `Voice · ready (${st.source || 'auth'})` : 'Voice · auth missing';
      this.voiceChip.classList.toggle('dash-voice-chip--ok', !!st.ok);
      this.voiceChip.classList.toggle('dash-voice-chip--bad', !st.ok);
      this.voiceChip.title = st.hint || 'Voice status';
    } catch {
      this.voiceChip.textContent = 'Voice · unreachable';
      this.voiceChip.classList.add('dash-voice-chip--bad');
    }
  }

  private async showVoiceHint(): Promise<void> {
    await this.refreshVoiceChip();
    if (this.selectedId) {
      this.toast('Open the agent chat and click voice for speech control');
      location.hash = `#/agents/${encodeURIComponent(this.selectedId)}`;
    } else {
      this.toast('Open any agent chat, then click the voice button in the composer');
    }
  }

  private toast(msg: string, kind: 'ok' | 'warn' = 'ok'): void {
    if (this.toastEl) {
      try { this.toastEl.remove(); } catch { /* ignore */ }
    }
    const t = el('div', { class: `dash-toast dash-toast--${kind}` }, msg);
    this.root.appendChild(t);
    this.toastEl = t;
    setTimeout(() => {
      try { t.remove(); } catch { /* ignore */ }
      if (this.toastEl === t) this.toastEl = null;
    }, 3200);
  }

  async refresh(quiet = false): Promise<void> {
    try {
      const list = await api.listAgents() as DashAgent[];
      this.agents = Array.isArray(list) ? list : [];
      document.dispatchEvent(new CustomEvent('grok-remote:agents-refresh', { detail: this.agents }));
      this.render();
    } catch (err) {
      if (!quiet) {
        this.toast(err instanceof Error ? err.message : String(err), 'warn');
      }
    }
  }

  private filtered(): DashAgent[] {
    const q = this.search.trim().toLowerCase();
    let list = this.agents.slice();
    if (q) {
      list = list.filter((a) => {
        const hay = [a.name, a.model, a.cwd, a.status, a.id, a.lastError]
          .map((x) => String(x || '').toLowerCase())
          .join(' ');
        return hay.includes(q);
      });
    }
    return list;
  }

  private flatVisible(): DashAgent[] {
    const list = this.filtered();
    if (this.groupMode === 'cwd') {
      return list
        .filter((a) => !a.archived || this.search)
        .sort((a, b) => {
          const ca = String(a.cwd || '');
          const cb = String(b.cwd || '');
          if (ca !== cb) return ca.localeCompare(cb);
          return String(b.lastSeen || '').localeCompare(String(a.lastSeen || ''));
        });
    }
    const out: DashAgent[] = [];
    for (const g of GROUPS) {
      if (this.collapsed.has(g.key) && !this.search) continue;
      const rows = list.filter((a) => classify(a) === g.key);
      rows.sort((a, b) => {
        if (!!b.starred !== !!a.starred) return a.starred ? -1 : 1;
        return String(b.lastSeen || b.createdAt || '').localeCompare(String(a.lastSeen || a.createdAt || ''));
      });
      out.push(...rows);
    }
    return out;
  }

  private select(id: string): void {
    this.selectedId = id;
    this.renderList();
    void this.renderPeek();
    const row = this.listEl.querySelector(`.dash-row[data-id="${CSS.escape(id)}"]`);
    if (row && 'scrollIntoView' in row) {
      (row as HTMLElement).scrollIntoView({ block: 'nearest' });
    }
  }

  private render(): void {
    const all = this.agents.filter((a) => !a.archived);
    const working = all.filter((a) => classify(a) === 'working').length;
    const needs = all.filter((a) => classify(a) === 'needs').length;
    this.headerMeta.textContent =
      `${all.length} agent${all.length === 1 ? '' : 's'}`
      + (working ? ` · ${working} working` : '')
      + (needs ? ` · ${needs} need attention` : '');
    this.renderList();
    void this.renderPeek();
  }

  private renderList(): void {
    const list = this.filtered();
    this.listEl.replaceChildren();

    if (this.groupMode === 'cwd') {
      const map = new Map<string, DashAgent[]>();
      for (const a of list) {
        if (a.archived && !this.search) continue;
        const key = String(a.cwd || '(no cwd)');
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(a);
      }
      const keys = [...map.keys()].sort((a, b) => a.localeCompare(b));
      if (!keys.length) {
        this.listEl.appendChild(this.emptyEl());
        return;
      }
      for (const key of keys) {
        const rows = map.get(key)!;
        rows.sort((a, b) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')));
        const collapsed = this.collapsed.has(`cwd:${key}`);
        const section = el('section', { class: 'dash-section dash-section--cwd' });
        section.appendChild(el('button', {
          class: 'dash-section-title',
          type: 'button',
          onclick: () => {
            const k = `cwd:${key}`;
            if (this.collapsed.has(k)) this.collapsed.delete(k);
            else this.collapsed.add(k);
            saveCollapsed(this.collapsed);
            this.renderList();
          },
        },
          el('span', { class: 'dash-section-chevron' }, collapsed ? '▸' : '▾'),
          el('span', { class: 'dash-section-label' }, key),
          el('span', { class: 'dash-section-count' }, String(rows.length)),
        ));
        if (!collapsed) {
          const body = el('div', { class: 'dash-section-body' });
          for (const a of rows) body.appendChild(this.rowEl(a));
          section.appendChild(body);
        }
        this.listEl.appendChild(section);
      }
      return;
    }

    let any = false;
    for (const g of GROUPS) {
      const rows = list.filter((a) => classify(a) === g.key);
      if (!rows.length) continue;
      if (g.key === 'archived' && !this.search && this.collapsed.has('archived') === false) {
        // still show
      }
      any = true;
      rows.sort((a, b) => {
        if (!!b.starred !== !!a.starred) return a.starred ? -1 : 1;
        return String(b.lastSeen || b.createdAt || '').localeCompare(String(a.lastSeen || a.createdAt || ''));
      });
      const collapsed = this.collapsed.has(g.key);
      const section = el('section', {
        class: `dash-section dash-section--${g.key}${collapsed ? ' dash-section--collapsed' : ''}`,
      });
      section.appendChild(el('button', {
        class: 'dash-section-title',
        type: 'button',
        onclick: () => {
          if (this.collapsed.has(g.key)) this.collapsed.delete(g.key);
          else this.collapsed.add(g.key);
          saveCollapsed(this.collapsed);
          this.renderList();
        },
      },
        el('span', { class: 'dash-section-chevron' }, collapsed ? '▸' : '▾'),
        el('span', { class: 'dash-section-label' }, g.label),
        el('span', { class: 'dash-section-count' }, String(rows.length)),
      ));
      if (!collapsed) {
        const body = el('div', { class: 'dash-section-body' });
        for (const a of rows) body.appendChild(this.rowEl(a));
        section.appendChild(body);
      }
      this.listEl.appendChild(section);
    }
    if (!any) this.listEl.appendChild(this.emptyEl());
  }

  private emptyEl(): HTMLElement {
    return el('div', { class: 'dash-empty' },
      this.search
        ? 'No agents match that filter.'
        : 'No agents yet. Dispatch a task below to spawn your first coding agent.',
    );
  }

  private rowEl(a: DashAgent): HTMLElement {
    const group = classify(a);
    const selected = this.selectedId === a.id;
    const row = el('div', {
      class: `dash-row dash-row--${group}${selected ? ' dash-row--selected' : ''}${a.starred ? ' dash-row--starred' : ''}`,
      role: 'button',
      tabindex: '0',
      'data-id': a.id,
      onclick: (ev: MouseEvent) => {
        const t = ev.target as HTMLElement;
        if (t.closest('.dash-row-actions')) return;
        this.select(a.id);
      },
      ondblclick: () => { location.hash = `#/agents/${encodeURIComponent(a.id)}`; },
    });

    const working = group === 'working';
    const actions = el('div', { class: 'dash-row-actions' },
      el('button', {
        class: 'btn btn--ghost dash-act',
        type: 'button',
        title: 'Open chat',
        onclick: (ev: Event) => {
          ev.stopPropagation();
          location.hash = `#/agents/${encodeURIComponent(a.id)}`;
        },
      }, 'open'),
      working ? el('button', {
        class: 'btn btn--ghost dash-act dash-act--danger',
        type: 'button',
        title: 'Cancel in-flight turn',
        onclick: (ev: Event) => {
          ev.stopPropagation();
          void this.cancel(a);
        },
      }, 'cancel') : null,
      el('button', {
        class: 'btn btn--ghost dash-act',
        type: 'button',
        title: a.starred ? 'Unstar' : 'Star / pin',
        onclick: (ev: Event) => {
          ev.stopPropagation();
          void this.patch(a.id, { starred: !a.starred });
        },
      }, a.starred ? 'unstar' : 'star'),
      el('button', {
        class: 'btn btn--ghost dash-act',
        type: 'button',
        title: a.connected ? 'Disconnect' : 'Connect',
        onclick: (ev: Event) => {
          ev.stopPropagation();
          void this.toggleConnect(a);
        },
      }, a.connected ? 'disconnect' : 'connect'),
      el('button', {
        class: 'btn btn--ghost dash-act dash-act--danger',
        type: 'button',
        title: a.archived ? 'Restore' : 'Archive',
        onclick: (ev: Event) => {
          ev.stopPropagation();
          void this.patch(a.id, { archived: !a.archived });
        },
      }, a.archived ? 'restore' : 'archive'),
    );

    row.append(
      el('span', {
        class: `dash-dot dash-dot--${group}`,
        title: String(a.status || group),
      }, group === 'working' ? '·' : (group === 'needs' ? '●' : '○')),
      el('div', { class: 'dash-row-main' },
        el('div', { class: 'dash-row-title' },
          a.starred ? el('span', { class: 'dash-star', title: 'starred' }, '★') : null,
          el('span', { class: 'dash-name' }, a.name || a.id.slice(0, 8)),
          a.model ? el('span', { class: 'dash-model' }, String(a.model)) : null,
        ),
        el('div', { class: 'dash-row-activity' }, activityLine(a)),
        el('div', { class: 'dash-row-meta' },
          a.cwd
            ? el('span', { class: 'dash-cwd', title: String(a.cwd) }, String(a.cwd))
            : el('span', { class: 'dash-cwd dash-cwd--empty' }, 'no cwd'),
          el('span', { class: 'dash-time' }, relTime(a.lastSeen || a.createdAt)),
        ),
      ),
      actions,
    );
    return row;
  }

  private async renderPeek(): Promise<void> {
    const a = this.agents.find((x) => x.id === this.selectedId) || null;
    if (!a) {
      this.peekTitle.textContent = 'Peek';
      this.peekBody.replaceChildren(
        el('div', { class: 'dash-peek-empty' }, 'no agent · j/k to move'),
      );
      this.peekReply.disabled = true;
      return;
    }
    this.peekTitle.textContent = a.name || a.id.slice(0, 8);
    this.peekReply.disabled = false;
    if (this.peekLoading) return;
    this.peekLoading = true;
    this.peekBody.replaceChildren(el('div', { class: 'dash-peek-empty' }, 'Loading history…'));
    try {
      const hist = await api.history(a.id, { turns: 30 });
      const lines = historySnippet(hist.events);
      this.peekBody.replaceChildren();
      this.peekBody.appendChild(el('div', { class: 'dash-peek-status' },
        `${a.status || '?'}${a.connected ? '' : ' · offline'} · ${activityLine(a)}`,
      ));
      if (!lines.length) {
        this.peekBody.appendChild(el('div', { class: 'dash-peek-empty' }, 'No transcript snippets yet.'));
      } else {
        for (const line of lines) {
          const roleLabel = line.role === 'tool' ? 'tool' : line.role;
          this.peekBody.appendChild(el('div', {
            class: `dash-peek-line dash-peek-line--${line.role === 'tool' ? 'tool' : line.role}`,
          },
            el('div', { class: 'dash-peek-role' }, roleLabel),
            el('div', { class: 'dash-peek-text' }, line.text),
          ));
        }
      }
      this.peekBody.scrollTop = this.peekBody.scrollHeight;
    } catch (err) {
      this.peekBody.replaceChildren(
        el('div', { class: 'dash-peek-empty' },
          err instanceof Error ? err.message : 'Failed to load history'),
      );
    } finally {
      this.peekLoading = false;
    }
  }

  private async replySelected(): Promise<void> {
    const id = this.selectedId;
    const text = this.peekReply.value.trim();
    if (!id || !text) {
      this.toast('Select an agent and type a reply', 'warn');
      return;
    }
    try {
      const a = this.agents.find((x) => x.id === id);
      if (a && !a.connected) await api.connect(id);
      await api.prompt(id, text);
      this.peekReply.value = '';
      this.toast('Reply sent');
      await this.refresh(true);
      await this.renderPeek();
    } catch (err) {
      this.toast(err instanceof Error ? err.message : String(err), 'warn');
    }
  }

  private async cancel(a: DashAgent): Promise<void> {
    try {
      await api.cancel(a.id);
      this.toast('Cancel requested');
      await this.refresh(true);
    } catch (err) {
      this.toast(err instanceof Error ? err.message : String(err), 'warn');
    }
  }

  private async patch(id: string, body: Record<string, unknown>): Promise<void> {
    try {
      await api.updateAgent(id, body);
      await this.refresh();
    } catch (err) {
      this.toast(err instanceof Error ? err.message : String(err), 'warn');
    }
  }

  private async toggleConnect(a: DashAgent): Promise<void> {
    try {
      if (a.connected) await api.disconnect(a.id);
      else await api.connect(a.id);
      await this.refresh();
      this.toast(a.connected ? 'Disconnected' : 'Connected');
    } catch (err) {
      this.toast(err instanceof Error ? err.message : String(err), 'warn');
    }
  }

  private async rename(a: DashAgent): Promise<void> {
    const name = window.prompt('Rename agent', a.name || '');
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    await this.patch(a.id, { name: trimmed });
  }

  private async dispatch(): Promise<void> {
    const text = this.dispatchTa.value.trim();
    if (!text) {
      this.toast('Type a task to dispatch', 'warn');
      return;
    }
    const name = this.dispatchName.value.trim() || undefined;
    const cwd = this.dispatchCwd.value.trim() || undefined;
    try {
      this.toast('Spawning agent…');
      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (cwd) body.cwd = cwd;
      const agent = await api.createAgent(body) as DashAgent;
      try {
        await api.prompt(agent.id, text);
      } catch {
        await new Promise((r) => setTimeout(r, 1500));
        await api.prompt(agent.id, text);
      }
      this.dispatchTa.value = '';
      await this.refresh();
      this.select(agent.id);
      this.toast(`Dispatched → ${agent.name || agent.id.slice(0, 8)}`);
    } catch (err) {
      this.toast(err instanceof Error ? err.message : String(err), 'warn');
    }
  }
}

export function mount(host: HTMLElement): DashView {
  const view = new DashView();
  view.mount(host);
  return view;
}
