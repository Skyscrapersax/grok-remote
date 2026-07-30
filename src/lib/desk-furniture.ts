// Desk furniture — browser cache + server ~/.grok-remote/desk.json via /api/desk.
// localStorage for instant cold paint; server file is host-level source of truth.

import { api } from './api.js';

const STORAGE_KEY = 'grok-remote.desk';
const VERSION = 1 as const;

const LEGACY = {
  theme: 'grok-remote.theme',
  rail: 'grok-remote.rail.system',
  dashCollapsed: 'grok-remote.dash.collapsed',
  dashGroup: 'grok-remote.dash.group',
  dashSearch: 'grok-remote.dash.search',
  termLastKind: 'grok-remote.term.lastKind',
} as const;

export interface DeskTermIntent {
  kind: string;
  cwd?: string;
  name?: string;
}

export interface DeskDashState {
  collapsed?: string[];
  groupMode?: string;
  search?: string;
}

export interface DeskFurniture {
  version?: number;
  lastHash?: string;
  lastAgentId?: string | null;
  railSystemOpen?: boolean;
  theme?: string;
  chatTab?: string;
  toolsCollapsed?: boolean;
  termTabs?: DeskTermIntent[];
  termLastKind?: string;
  dash?: DeskDashState;
  split?: { sizes?: number[]; collapsed?: boolean };
  updatedAt?: number;
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;

function readLegacyDash(): DeskDashState {
  const out: DeskDashState = {};
  try {
    const g = localStorage.getItem(LEGACY.dashGroup);
    if (g) out.groupMode = g;
  } catch { /* ignore */ }
  try {
    const raw = localStorage.getItem(LEGACY.dashCollapsed);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) out.collapsed = parsed.map(String);
    }
  } catch { /* ignore */ }
  try {
    const s = localStorage.getItem(LEGACY.dashSearch);
    if (s != null) out.search = s;
  } catch { /* ignore */ }
  return out;
}

function readRaw(): DeskFurniture {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DeskFurniture;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Hydrate empty/partial desk bag from legacy localStorage keys. */
function hydrateFromLegacy(base: DeskFurniture): DeskFurniture {
  const out: DeskFurniture = { ...base };
  let dirty = false;

  try {
    if (!out.theme) {
      const t = localStorage.getItem(LEGACY.theme);
      if (t) { out.theme = t; dirty = true; }
    }
    if (typeof out.railSystemOpen !== 'boolean') {
      const r = localStorage.getItem(LEGACY.rail);
      if (r === '1' || r === '0') {
        out.railSystemOpen = r === '1';
        dirty = true;
      }
    }
    if (!out.termLastKind) {
      const k = localStorage.getItem(LEGACY.termLastKind);
      if (k) { out.termLastKind = k; dirty = true; }
    }
    if (!Array.isArray(out.termTabs) || !out.termTabs.length) {
      try {
        const raw = localStorage.getItem('grok-remote.term.tabs');
        if (raw) {
          const parsed = JSON.parse(raw) as DeskTermIntent[];
          if (Array.isArray(parsed) && parsed.length) {
            out.termTabs = parsed.map((t) => ({
              kind: String(t?.kind || 'shell'),
              cwd: t?.cwd ? String(t.cwd) : undefined,
              name: t?.name ? String(t.name) : undefined,
            }));
            dirty = true;
          }
        }
      } catch { /* ignore */ }
    }

    const legacyDash = readLegacyDash();
    const dash: DeskDashState = { ...(out.dash || {}) };
    let dashDirty = false;
    if (!dash.groupMode && legacyDash.groupMode) {
      dash.groupMode = legacyDash.groupMode;
      dashDirty = true;
    }
    if ((!Array.isArray(dash.collapsed) || !dash.collapsed.length) && legacyDash.collapsed?.length) {
      dash.collapsed = legacyDash.collapsed;
      dashDirty = true;
    }
    if (dash.search == null && legacyDash.search != null) {
      dash.search = legacyDash.search;
      dashDirty = true;
    }
    if (dashDirty) {
      out.dash = dash;
      dirty = true;
    }
  } catch { /* ignore */ }

  if (out.version == null) out.version = VERSION;

  if (dirty) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ...out,
        version: VERSION,
        updatedAt: out.updatedAt || Date.now(),
      }));
    } catch { /* ignore */ }
  }
  return out;
}

function read(): DeskFurniture {
  return hydrateFromLegacy(readRaw());
}

function write(next: DeskFurniture): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...next,
      version: VERSION,
      updatedAt: next.updatedAt ?? Date.now(),
    }));
  } catch { /* ignore quota */ }
}

export function loadDeskFurniture(): DeskFurniture {
  return read();
}

export function saveDeskFurniture(patch: Partial<DeskFurniture>): DeskFurniture {
  const cur = read();
  const next: DeskFurniture = {
    ...cur,
    ...patch,
    version: VERSION,
    updatedAt: Date.now(),
  };
  if (patch.dash) {
    next.dash = { ...(cur.dash || {}), ...patch.dash };
  }
  if (patch.split) {
    next.split = { ...(cur.split || {}), ...patch.split };
  }
  write(next);
  scheduleServerSync(next);
  return next;
}

function scheduleServerSync(state: DeskFurniture): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void pushDeskToServer(state);
  }, 280);
}

async function pushDeskToServer(state: DeskFurniture): Promise<void> {
  try {
    const body: Record<string, unknown> = { version: VERSION };
    if (state.lastHash) body['lastHash'] = state.lastHash;
    if (state.lastAgentId !== undefined) body['lastAgentId'] = state.lastAgentId;
    if (typeof state.railSystemOpen === 'boolean') body['railSystemOpen'] = state.railSystemOpen;
    if (state.theme) body['theme'] = state.theme;
    if (state.chatTab) body['chatTab'] = state.chatTab;
    if (typeof state.toolsCollapsed === 'boolean') body['toolsCollapsed'] = state.toolsCollapsed;
    if (state.split) body['split'] = state.split;
    if (state.dash) body['dash'] = state.dash;
    if (state.termLastKind) body['termLastKind'] = state.termLastKind;
    if (state.termTabs) body['termTabs'] = state.termTabs;
    if (state.updatedAt) body['updatedAt'] = state.updatedAt;
    await api.patchDesk(body);
  } catch {
    /* server offline — local cache still works */
  }
}

function unwrapDesk(payload: unknown): DeskFurniture {
  if (!payload || typeof payload !== 'object') return {};
  const p = payload as Record<string, unknown>;
  const raw = (p['desk'] && typeof p['desk'] === 'object')
    ? p['desk'] as Record<string, unknown>
    : p;
  const out: DeskFurniture = { version: VERSION };
  if (typeof raw['lastHash'] === 'string') out.lastHash = raw['lastHash'];
  if (raw['lastAgentId'] === null || typeof raw['lastAgentId'] === 'string') {
    out.lastAgentId = raw['lastAgentId'] as string | null;
  }
  if (typeof raw['railSystemOpen'] === 'boolean') out.railSystemOpen = raw['railSystemOpen'];
  if (typeof raw['theme'] === 'string') out.theme = raw['theme'];
  if (typeof raw['chatTab'] === 'string') out.chatTab = raw['chatTab'];
  if (typeof raw['toolsCollapsed'] === 'boolean') out.toolsCollapsed = raw['toolsCollapsed'];
  if (raw['split'] && typeof raw['split'] === 'object') {
    out.split = raw['split'] as DeskFurniture['split'];
  }
  if (raw['dash'] && typeof raw['dash'] === 'object') {
    out.dash = raw['dash'] as DeskDashState;
  }
  if (typeof raw['termLastKind'] === 'string') out.termLastKind = raw['termLastKind'];
  if (Array.isArray(raw['termTabs'])) {
    out.termTabs = raw['termTabs'] as DeskTermIntent[];
  }
  if (typeof raw['updatedAt'] === 'number') out.updatedAt = raw['updatedAt'];
  return out;
}

function applyLegacyMirrors(merged: DeskFurniture): void {
  try {
    if (typeof merged.railSystemOpen === 'boolean') {
      localStorage.setItem(LEGACY.rail, merged.railSystemOpen ? '1' : '0');
    }
    if (merged.theme) localStorage.setItem(LEGACY.theme, merged.theme);
    if (merged.termLastKind) localStorage.setItem(LEGACY.termLastKind, merged.termLastKind);
    if (merged.dash?.collapsed) {
      localStorage.setItem(LEGACY.dashCollapsed, JSON.stringify(merged.dash.collapsed));
    }
    if (merged.dash?.groupMode) {
      localStorage.setItem(LEGACY.dashGroup, merged.dash.groupMode);
    }
    if (merged.dash?.search != null) {
      localStorage.setItem(LEGACY.dashSearch, merged.dash.search);
    }
  } catch { /* ignore */ }
}

/** Pull desk.json from server into localStorage. Server wins on known fields. */
export async function syncDeskFromServer(): Promise<DeskFurniture> {
  try {
    const remote = unwrapDesk(await api.getDesk());
    const hasRemote = Object.keys(remote).some((k) => k !== 'version' && remote[k as keyof DeskFurniture] != null);
    if (!hasRemote) return read();
    const local = read();
    const merged: DeskFurniture = {
      ...local,
      ...remote,
      dash: { ...(local.dash || {}), ...(remote.dash || {}) },
      split: { ...(local.split || {}), ...(remote.split || {}) },
      version: VERSION,
    };
    write(merged);
    applyLegacyMirrors(merged);
    return merged;
  } catch {
    return read();
  }
}

/** Boot: sync server desk.json then restore last surface hash. */
export async function bootstrapDesk(): Promise<DeskFurniture> {
  const desk = await syncDeskFromServer();
  restoreDeskHashIfEmpty();
  return desk;
}

/** Alias used by older main.ts boot path */
export const hydrateDeskFromServer = syncDeskFromServer;

export function rememberDeskHash(hash: string = location.hash): void {
  const h = String(hash || '').trim();
  if (!h || h === '#' || h === '#/') return;
  if (!h.startsWith('#/')) return;
  saveDeskFurniture({ lastHash: h });
}

export function restoreDeskHashIfEmpty(): string | null {
  const cur = String(location.hash || '').trim();
  if (cur && cur !== '#' && cur !== '#/') return null;
  const { lastHash } = read();
  if (!lastHash || lastHash === cur) return null;
  if (!lastHash.startsWith('#/')) return null;
  location.hash = lastHash;
  return lastHash;
}

export function rememberRailSystemOpen(open: boolean): void {
  saveDeskFurniture({ railSystemOpen: open });
  try {
    localStorage.setItem(LEGACY.rail, open ? '1' : '0');
  } catch { /* ignore */ }
}

export function isRailSystemOpen(): boolean {
  const desk = read();
  if (typeof desk.railSystemOpen === 'boolean') return desk.railSystemOpen;
  try {
    return localStorage.getItem(LEGACY.rail) === '1';
  } catch {
    return false;
  }
}

export function rememberDeskTheme(theme: string | null | undefined): void {
  const t = String(theme || '').trim();
  if (!t) return;
  saveDeskFurniture({ theme: t });
  try { localStorage.setItem(LEGACY.theme, t); } catch { /* ignore */ }
}

export function getDeskTheme(): string | null {
  const desk = read();
  if (desk.theme) return desk.theme;
  try {
    return localStorage.getItem(LEGACY.theme);
  } catch {
    return null;
  }
}

export function rememberLastAgent(id: string | null | undefined): void {
  if (id == null || id === '') {
    saveDeskFurniture({ lastAgentId: null });
    return;
  }
  saveDeskFurniture({ lastAgentId: String(id) });
}

export function getLastAgentId(): string | null {
  const id = read().lastAgentId;
  return typeof id === 'string' && id ? id : null;
}

export function rememberDeskSplit(sizes: number[], collapsed: boolean): void {
  saveDeskFurniture({
    split: { sizes: sizes.slice(0, 4), collapsed },
  });
}

export function rememberTermTabs(tabs: DeskTermIntent[]): void {
  const termTabs = (tabs || [])
    .filter((t) => t && (t.kind || t.cwd || t.name))
    .slice(0, 12)
    .map((t) => ({
      kind: String(t.kind || 'shell'),
      cwd: t.cwd ? String(t.cwd) : undefined,
      name: t.name ? String(t.name) : undefined,
    }));
  saveDeskFurniture({ termTabs });
  try {
    localStorage.setItem('grok-remote.term.tabs', JSON.stringify(termTabs));
  } catch { /* ignore */ }
}

export function getTermTabs(): DeskTermIntent[] {
  const fromDesk = read().termTabs;
  if (Array.isArray(fromDesk) && fromDesk.length) {
    return fromDesk.map((t) => ({
      kind: String(t.kind || 'shell'),
      cwd: t.cwd ? String(t.cwd) : undefined,
      name: t.name ? String(t.name) : undefined,
    }));
  }
  try {
    const raw = localStorage.getItem('grok-remote.term.tabs');
    if (raw) {
      const parsed = JSON.parse(raw) as DeskTermIntent[];
      if (Array.isArray(parsed)) {
        return parsed.map((t) => ({
          kind: String(t?.kind || 'shell'),
          cwd: t?.cwd ? String(t.cwd) : undefined,
          name: t?.name ? String(t.name) : undefined,
        }));
      }
    }
  } catch { /* ignore */ }
  return [];
}

// ── Dash board chrome ──────────────────────────────────────────────────────

export function rememberDashCollapsed(ids: string[]): void {
  const collapsed = ids.map(String).slice(0, 24);
  saveDeskFurniture({ dash: { collapsed } });
  try {
    localStorage.setItem(LEGACY.dashCollapsed, JSON.stringify(collapsed));
  } catch { /* ignore */ }
}

export function getDashCollapsed(): string[] {
  const d = read().dash?.collapsed;
  if (Array.isArray(d) && d.length) return d.map(String);
  return readLegacyDash().collapsed || [];
}

export function rememberDashGroupMode(mode: string): void {
  const groupMode = String(mode || 'state');
  saveDeskFurniture({ dash: { groupMode } });
  try { localStorage.setItem(LEGACY.dashGroup, groupMode); } catch { /* ignore */ }
}

export function getDashGroupMode(): 'state' | 'cwd' {
  const fromDesk = read().dash?.groupMode;
  if (fromDesk === 'cwd' || fromDesk === 'state') return fromDesk;
  const legacy = readLegacyDash().groupMode;
  if (legacy === 'cwd' || legacy === 'state') return legacy;
  return 'state';
}

export function rememberDashSearch(q: string): void {
  const search = String(q ?? '');
  saveDeskFurniture({ dash: { search } });
  try { localStorage.setItem(LEGACY.dashSearch, search); } catch { /* ignore */ }
}

export function getDashSearch(): string {
  const s = read().dash?.search;
  if (typeof s === 'string') return s;
  return readLegacyDash().search || '';
}

// ── Term ───────────────────────────────────────────────────────────────────

export function rememberTermLastKind(kind: string): void {
  const termLastKind = String(kind || '').trim() || 'shell';
  saveDeskFurniture({ termLastKind });
  try { localStorage.setItem(LEGACY.termLastKind, termLastKind); } catch { /* ignore */ }
}

export function getTermLastKind(): string {
  const fromDesk = read().termLastKind;
  if (fromDesk) return String(fromDesk);
  try {
    return localStorage.getItem(LEGACY.termLastKind) || 'shell';
  } catch {
    return 'shell';
  }
}
