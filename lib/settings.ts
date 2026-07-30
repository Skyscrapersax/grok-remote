// Persist server-side settings under ~/.grok-remote/settings.json.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.join(os.homedir(), '.grok-remote');
const FILE = path.join(ROOT, 'settings.json');

export interface Settings {
  defaultModel: string | null;
  defaultCwd:   string | null;
  autoApprove:  boolean;
  retentionDays: number;
  theme:        string;
  debug:        boolean;
  /** Set after one-shot dark→atelier craft migration so explicit dark sticks. */
  craftThemeAligned?: boolean;
  [key: string]: unknown;
}

const DEFAULTS: Settings = {
  defaultModel: null,
  defaultCwd: null,
  autoApprove: true,
  retentionDays: 30,
  /** Craft desk default — keep in sync with client themes.ts DEFAULT_THEME */
  theme: 'atelier',
  debug: false,
  craftThemeAligned: true,
};

function ensureRoot(): void {
  fs.mkdirSync(ROOT, { recursive: true });
}

/**
 * One-shot craft migration: promote legacy server default `dark` → `atelier`.
 * After craftThemeAligned is set, an explicit user choice of `dark` is kept.
 */
function migrateTheme(s: Settings): Settings {
  if (s.craftThemeAligned === true) return s;
  const next: Settings = {
    ...s,
    craftThemeAligned: true,
    theme: (!s.theme || s.theme === 'dark') ? 'atelier' : s.theme,
  };
  try {
    fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  } catch { /* ignore */ }
  return next;
}

export function load(): Settings {
  ensureRoot();
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return migrateTheme({ ...DEFAULTS, ...parsed });
  } catch {
    return { ...DEFAULTS };
  }
}

export function save(next: Partial<Settings>): Settings {
  ensureRoot();
  const merged: Settings = { ...load(), ...next, craftThemeAligned: true };
  fs.writeFileSync(FILE, JSON.stringify(merged, null, 2));
  return merged;
}

export function paths(): { root: string; file: string } {
  return { root: ROOT, file: FILE };
}
