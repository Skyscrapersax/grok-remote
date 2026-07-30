// Persist desk continuity under ~/.grok-remote/desk.json
// Source of truth for route, agent, chrome, dash, and term tab intents.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.join(os.homedir(), '.grok-remote');
const FILE = path.join(ROOT, 'desk.json');
const VERSION = 1 as const;

export interface DeskTermIntent {
  kind: string;
  cwd?: string;
  name?: string;
}

export interface DeskSplit {
  sizes?: number[];
  collapsed?: boolean;
}

export interface DeskDashState {
  collapsed?: string[];
  groupMode?: string;
  search?: string;
}

export interface DeskState {
  version: number;
  lastHash?: string;
  lastAgentId?: string | null;
  chatTab?: string;
  toolsCollapsed?: boolean;
  railSystemOpen?: boolean;
  theme?: string;
  termTabs?: DeskTermIntent[];
  termLastKind?: string;
  dash?: DeskDashState;
  split?: DeskSplit;
  updatedAt?: number;
  [key: string]: unknown;
}

const DEFAULTS: DeskState = {
  version: VERSION,
  lastHash: undefined,
  lastAgentId: null,
  chatTab: 'conversation',
  toolsCollapsed: false,
  railSystemOpen: false,
  theme: 'atelier',
  termTabs: [],
  split: undefined,
};

function ensureRoot(): void {
  fs.mkdirSync(ROOT, { recursive: true });
}

function isHash(h: unknown): h is string {
  return typeof h === 'string' && h.startsWith('#/') && h.length > 2 && h !== '#/';
}

function normalize(raw: Partial<DeskState> | null | undefined): DeskState {
  const r = raw && typeof raw === 'object' ? raw : {};
  const termTabs = Array.isArray(r.termTabs)
    ? r.termTabs
      .filter((t) => t && typeof t === 'object')
      .map((t) => ({
        kind: String((t as DeskTermIntent).kind || 'shell'),
        cwd: (t as DeskTermIntent).cwd ? String((t as DeskTermIntent).cwd) : undefined,
        name: (t as DeskTermIntent).name ? String((t as DeskTermIntent).name) : undefined,
      }))
    : [];

  let split: DeskSplit | undefined;
  if (r.split && typeof r.split === 'object') {
    const s = r.split as DeskSplit;
    split = {};
    if (Array.isArray(s.sizes) && s.sizes.every((n) => typeof n === 'number')) {
      split.sizes = s.sizes.slice(0, 4);
    }
    if (typeof s.collapsed === 'boolean') split.collapsed = s.collapsed;
    if (!Object.keys(split).length) split = undefined;
  }

  let dash: DeskDashState | undefined;
  if (r.dash && typeof r.dash === 'object') {
    const d = r.dash as DeskDashState;
    dash = {};
    if (Array.isArray(d.collapsed)) dash.collapsed = d.collapsed.map(String).slice(0, 24);
    if (typeof d.groupMode === 'string') dash.groupMode = d.groupMode;
    if (typeof d.search === 'string') dash.search = d.search.slice(0, 200);
    if (!Object.keys(dash).length) dash = undefined;
  }

  // Only accept real surface hashes (#/deck, #/dash, …) — never empty "#/"
  const lastHash = isHash(r.lastHash) ? r.lastHash : undefined;

  return {
    ...DEFAULTS,
    ...r,
    version: VERSION,
    lastHash,
    termTabs,
    termLastKind: typeof r.termLastKind === 'string' ? r.termLastKind : undefined,
    dash,
    split,
    lastAgentId: r.lastAgentId === undefined ? DEFAULTS.lastAgentId : r.lastAgentId,
  };
}

/** Unwrap `{ desk: {...} }` bodies from clients that wrap. */
function unwrapPatch(patch: Record<string, unknown> | null | undefined): Partial<DeskState> {
  if (!patch || typeof patch !== 'object') return {};
  if (patch['desk'] && typeof patch['desk'] === 'object' && !Array.isArray(patch['desk'])) {
    return patch['desk'] as Partial<DeskState>;
  }
  return patch as Partial<DeskState>;
}

export function load(): DeskState {
  ensureRoot();
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    return normalize(JSON.parse(raw) as Partial<DeskState>);
  } catch {
    return normalize({});
  }
}

export function save(patch: Record<string, unknown> | Partial<DeskState>): DeskState {
  ensureRoot();
  const body = unwrapPatch(patch as Record<string, unknown>);
  const current = load();
  // Invalid lastHash in a partial patch must not wipe the stored route.
  if ('lastHash' in body && !isHash(body.lastHash)) {
    delete body.lastHash;
  }
  const merged = normalize({ ...current, ...body, updatedAt: Date.now() });
  // If normalize dropped lastHash, restore current
  if (!merged.lastHash && current.lastHash) merged.lastHash = current.lastHash;
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2));
  fs.renameSync(tmp, FILE);
  return merged;
}

export function paths(): { root: string; file: string } {
  return { root: ROOT, file: FILE };
}

// Aliases used by older tests / callers
export const loadDeskState = load;
export const saveDeskState = save;
export const deskPaths = paths;
