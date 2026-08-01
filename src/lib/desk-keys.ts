// Desk keyboard control plane — primary interaction model for Grok Deck.
// Vim / tmux muscle memory: chords, roster motion, terminal prefix, global go-to.
// One capture-phase listener; surfaces register handlers; overlays own the keys while open.

export type DeskSurface =
  | 'deck'
  | 'dash'
  | 'term'
  | 'chat'
  | 'settings'
  | 'system'
  | 'other';

export interface DeskBinding {
  /** Display string, e.g. "g d", "j", "ctrl-b n", "mod+k" */
  keys: string;
  /** Where this applies. Omit / empty = global. */
  surface?: DeskSurface | DeskSurface[];
  description: string;
  /** Group for help overlay */
  group: 'global' | 'deck' | 'dash' | 'term' | 'chat' | 'overlays';
}

export interface DeskKeyController {
  navigate(hash: string): void;
  getSurface(): DeskSurface;
  /** Optional: focus search / dispatch on dash, etc. */
  onAction?(action: string, payload?: unknown): void;
}

export type SurfaceKeyHandler = (ev: KeyboardEvent, ctx: DeskKeyRuntime) => boolean | void;

export interface DeskKeyRuntime {
  surface: DeskSurface;
  navigate: (hash: string) => void;
  openPalette: () => void;
  openHelp: () => void;
  closeOverlays: () => void;
  /** True when a multi-key chord is waiting for its second key */
  pendingChord: string | null;
  /** True when tmux-style ctrl-b prefix is armed */
  termPrefix: boolean;
  isEditableTarget: (t: EventTarget | null) => boolean;
  isTerminalTarget: (t: EventTarget | null) => boolean;
}

const CHORD_WINDOW_MS = 900;
const TERM_PREFIX_MS = 1200;

const GO_TARGETS: Record<string, { hash: string; label: string }> = {
  d: { hash: '#/deck', label: 'Deck' },
  h: { hash: '#/deck', label: 'Deck (home)' },
  a: { hash: '#/dash', label: 'Dash' },
  b: { hash: '#/dash', label: 'Dash (board)' },
  t: { hash: '#/term', label: 'Terminal' },
  c: { hash: '#/chats', label: 'Chats' },
  s: { hash: '#/settings', label: 'Settings' },
};

/** Canonical bindings for help + docs. Runtime may implement more. */
export const DESK_BINDINGS: DeskBinding[] = [
  // Global
  { keys: 'mod+k', description: 'Command palette', group: 'global' },
  { keys: ':', description: 'Command palette (vim)', group: 'global' },
  { keys: '?', description: 'Keyboard help', group: 'global' },
  { keys: 'g d', description: 'Go to Deck', group: 'global' },
  { keys: 'g a', description: 'Go to Dash', group: 'global' },
  { keys: 'g t', description: 'Go to Terminal', group: 'global' },
  { keys: 'g c', description: 'Go to Chats', group: 'global' },
  { keys: 'g s', description: 'Go to Settings', group: 'global' },
  { keys: 'mod+1', description: 'Go to Deck', group: 'global' },
  { keys: 'mod+2', description: 'Go to Dash', group: 'global' },
  { keys: 'mod+3', description: 'Go to Terminal', group: 'global' },
  { keys: 'mod+4', description: 'Go to Chats', group: 'global' },
  { keys: 'esc', description: 'Close overlay / clear selection', group: 'global' },

  // Deck
  { keys: 'j / k', description: 'Next / previous card', group: 'deck', surface: 'deck' },
  { keys: 'h / l', description: 'Previous / next card', group: 'deck', surface: 'deck' },
  { keys: '1–4', description: 'Jump to card', group: 'deck', surface: 'deck' },
  { keys: 'enter / o', description: 'Primary action on focused card', group: 'deck', surface: 'deck' },
  { keys: 'shift+enter / O', description: 'Secondary action on focused card', group: 'deck', surface: 'deck' },
  { keys: 'gg / G', description: 'First / last card', group: 'deck', surface: 'deck' },

  // Dash
  { keys: 'j / k', description: 'Move roster selection', group: 'dash', surface: 'dash' },
  { keys: 'enter', description: 'Open selected agent', group: 'dash', surface: 'dash' },
  { keys: 'o', description: 'Open selected agent', group: 'dash', surface: 'dash' },
  { keys: 'p', description: 'Focus peek reply', group: 'dash', surface: 'dash' },
  { keys: '/', description: 'Focus search', group: 'dash', surface: 'dash' },
  { keys: 'n', description: 'Focus dispatch bar', group: 'dash', surface: 'dash' },
  { keys: 'r', description: 'Rename selected', group: 'dash', surface: 'dash' },
  { keys: 'x', description: 'Cancel in-flight turn', group: 'dash', surface: 'dash' },
  { keys: 'gg / G', description: 'First / last agent', group: 'dash', surface: 'dash' },
  { keys: 'esc', description: 'Clear selection / blur', group: 'dash', surface: 'dash' },

  // Term (tmux-style prefix)
  { keys: 'ctrl-b', description: 'Terminal prefix (tmux)', group: 'term', surface: 'term' },
  { keys: 'ctrl-b n / p', description: 'Next / previous tab', group: 'term', surface: 'term' },
  { keys: 'ctrl-b j / k', description: 'Next / previous tab', group: 'term', surface: 'term' },
  { keys: 'ctrl-b c', description: 'New shell tab', group: 'term', surface: 'term' },
  { keys: 'ctrl-b g', description: 'New grok tab', group: 'term', surface: 'term' },
  { keys: 'ctrl-b d', description: 'New dash (grok dashboard) tab', group: 'term', surface: 'term' },
  { keys: 'ctrl-b x', description: 'Close active tab', group: 'term', surface: 'term' },
  { keys: 'ctrl-b 1–9', description: 'Select tab by index', group: 'term', surface: 'term' },
  { keys: 'ctrl-b ?', description: 'Keyboard help', group: 'term', surface: 'term' },
  { keys: 'ctrl-shift-t', description: 'New shell (no prefix)', group: 'term', surface: 'term' },
  { keys: 'ctrl-shift-w', description: 'Close tab (no prefix)', group: 'term', surface: 'term' },
  { keys: 'ctrl-tab', description: 'Next tab', group: 'term', surface: 'term' },
  { keys: 'ctrl-shift-tab', description: 'Previous tab', group: 'term', surface: 'term' },

  // Chat (nav mode — editable targets keep ordinary typing)
  { keys: 'j / k', description: 'Next / previous session in sidebar', group: 'chat', surface: 'chat' },
  { keys: 'enter / i / a', description: 'Focus composer (insert)', group: 'chat', surface: 'chat' },
  { keys: 'o', description: 'Focus conversation pane', group: 'chat', surface: 'chat' },
  { keys: 'esc', description: 'Blur composer / leave insert · close drawer', group: 'chat', surface: 'chat' },
];

export function isEditableTarget(t: EventTarget | null): boolean {
  if (!t || !(t instanceof Element)) return false;
  const el = t as HTMLElement;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  if (el.closest?.('[contenteditable="true"]')) return true;
  return false;
}

export function isTerminalTarget(t: EventTarget | null): boolean {
  if (!t || !(t instanceof Element)) return false;
  return !!(t as HTMLElement).closest?.('.xterm, .term-surface, .term-host, .term-view');
}

export function parseRouteSurface(hash: string = typeof location !== 'undefined' ? location.hash : ''): DeskSurface {
  const h = (hash || '#/').replace(/^#/, '');
  const parts = h.split('/').filter(Boolean);
  const head = parts[0] || 'deck';
  if (head === 'deck' || head === 'home' || !parts.length) return 'deck';
  if (head === 'dash' || head === 'dashboard') return 'dash';
  if (head === 'term' || head === 'terminal' || head === 'tty') return 'term';
  if (head === 'chats' || head === 'chat' || head === 'agents') return 'chat';
  if (head === 'settings') return 'settings';
  return 'system';
}

function isMod(ev: KeyboardEvent): boolean {
  return ev.metaKey || ev.ctrlKey;
}

function chordLetter(ev: KeyboardEvent): string | null {
  if (ev.key.length === 1) return ev.key;
  return null;
}

export interface InstallDeskKeysOptions {
  controller: DeskKeyController;
  openPalette: () => void;
  openHelp: () => void;
  closeOverlays: () => void;
  isOverlayOpen: () => boolean;
}

/**
 * Install the global capture-phase keyboard router.
 * Returns dispose + registerSurface for view lifecycle.
 */
export function installDeskKeys(opts: InstallDeskKeysOptions): {
  dispose: () => void;
  registerSurface: (surface: DeskSurface, handler: SurfaceKeyHandler) => () => void;
  runtime: DeskKeyRuntime;
  /** Flash a brief chord / prefix indicator */
  getStatus: () => { chord: string | null; termPrefix: boolean };
} {
  const surfaceHandlers = new Map<DeskSurface, SurfaceKeyHandler>();
  let pendingChord: string | null = null;
  let chordTimer: ReturnType<typeof setTimeout> | null = null;
  let termPrefix = false;
  let termPrefixTimer: ReturnType<typeof setTimeout> | null = null;
  let gFirstPending = false; // for "gg"

  function clearChord(): void {
    pendingChord = null;
    gFirstPending = false;
    if (chordTimer) {
      clearTimeout(chordTimer);
      chordTimer = null;
    }
    paintBodyFlags();
  }

  function armChord(label: string): void {
    pendingChord = label;
    if (chordTimer) clearTimeout(chordTimer);
    chordTimer = setTimeout(() => clearChord(), CHORD_WINDOW_MS);
    paintBodyFlags();
  }

  function clearTermPrefix(): void {
    termPrefix = false;
    if (termPrefixTimer) {
      clearTimeout(termPrefixTimer);
      termPrefixTimer = null;
    }
    paintBodyFlags();
  }

  function armTermPrefix(): void {
    termPrefix = true;
    if (termPrefixTimer) clearTimeout(termPrefixTimer);
    termPrefixTimer = setTimeout(() => clearTermPrefix(), TERM_PREFIX_MS);
    paintBodyFlags();
  }

  function paintBodyFlags(): void {
    try {
      const b = document.body;
      if (pendingChord) b.setAttribute('data-desk-chord', pendingChord);
      else b.removeAttribute('data-desk-chord');
      if (termPrefix) b.setAttribute('data-desk-term-prefix', '');
      else b.removeAttribute('data-desk-term-prefix');
    } catch { /* ignore */ }
  }

  const runtime: DeskKeyRuntime = {
    get surface() {
      return opts.controller.getSurface();
    },
    navigate: (hash) => opts.controller.navigate(hash),
    openPalette: () => opts.openPalette(),
    openHelp: () => opts.openHelp(),
    closeOverlays: () => opts.closeOverlays(),
    get pendingChord() {
      return pendingChord;
    },
    get termPrefix() {
      return termPrefix;
    },
    isEditableTarget,
    isTerminalTarget,
  };

  function onKeydown(ev: KeyboardEvent): void {
    if (ev.defaultPrevented) return;
    if (ev.isComposing) return;

    const surface = opts.controller.getSurface();
    const editable = isEditableTarget(ev.target);
    const inTerm = surface === 'term' && isTerminalTarget(ev.target);
    const overlayOpen = opts.isOverlayOpen();

    // ── Overlay owns keys (except esc handled inside overlay) ──────────
    if (overlayOpen) return;

    // ── Always-on modifiers (work even over xterm / inputs) ────────────
    if (isMod(ev) && !ev.altKey && (ev.key === 'k' || ev.key === 'K')) {
      // mod+k — palette (skip when pure ctrl+k might be kill-line in term:
      // use meta on mac, and on other platforms still use ctrl+k for palette
      // when NOT in term insert — but user asked for primary model: always palette)
      if (ev.metaKey || (ev.ctrlKey && !inTerm) || (ev.ctrlKey && ev.shiftKey)) {
        ev.preventDefault();
        ev.stopPropagation();
        clearChord();
        clearTermPrefix();
        opts.openPalette();
        return;
      }
    }

    // mod+1..4 surface jump (always)
    if (isMod(ev) && !ev.altKey && !ev.shiftKey && /^[1-4]$/.test(ev.key)) {
      ev.preventDefault();
      ev.stopPropagation();
      clearChord();
      clearTermPrefix();
      const map: Record<string, string> = {
        '1': '#/deck',
        '2': '#/dash',
        '3': '#/term',
        '4': '#/chats',
      };
      opts.controller.navigate(map[ev.key]!);
      return;
    }

    // mod+/ → help
    if (isMod(ev) && (ev.key === '/' || ev.key === '?')) {
      ev.preventDefault();
      ev.stopPropagation();
      clearChord();
      clearTermPrefix();
      opts.openHelp();
      return;
    }

    // ── Terminal prefix: Ctrl-b (capture before xterm) ──────────────────
    if (surface === 'term' && ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.shiftKey && (ev.key === 'b' || ev.key === 'B')) {
      ev.preventDefault();
      ev.stopPropagation();
      clearChord();
      armTermPrefix();
      return;
    }

    // Term prefix follow-up — surface handler wins; onAction is fallback only
    if (termPrefix && surface === 'term') {
      ev.preventDefault();
      ev.stopPropagation();
      const key = ev.key;
      clearTermPrefix();
      const handler = surfaceHandlers.get('term');
      if (handler) {
        (ev as KeyboardEvent & { deskTermPrefixKey?: string }).deskTermPrefixKey = key;
        handler(ev, runtime);
      } else {
        opts.controller.onAction?.('term.prefix', { key, shift: ev.shiftKey });
      }
      return;
    }

    // Term always-on tab keys — one path only (handler or onAction)
    if (surface === 'term' && ev.ctrlKey && !ev.metaKey) {
      if (ev.key === 'Tab') {
        ev.preventDefault();
        ev.stopPropagation();
        const handler = surfaceHandlers.get('term');
        if (handler) handler(ev, runtime);
        else opts.controller.onAction?.('term.tab', { dir: ev.shiftKey ? -1 : 1 });
        return;
      }
      if (ev.shiftKey && (ev.key === 'T' || ev.key === 't')) {
        ev.preventDefault();
        ev.stopPropagation();
        const handler = surfaceHandlers.get('term');
        if (handler) handler(ev, runtime);
        else opts.controller.onAction?.('term.new', { kind: 'shell' });
        return;
      }
      if (ev.shiftKey && (ev.key === 'W' || ev.key === 'w')) {
        ev.preventDefault();
        ev.stopPropagation();
        const handler = surfaceHandlers.get('term');
        if (handler) handler(ev, runtime);
        else opts.controller.onAction?.('term.close', {});
        return;
      }
    }

    // ── Editable fields: only Esc bubbles to desk ──────────────────────
    if (editable && !inTerm) {
      if (ev.key === 'Escape') {
        (ev.target as HTMLElement)?.blur?.();
        // let surface handle clear-selection
        surfaceHandlers.get(surface)?.(ev, runtime);
      }
      return;
    }

    // When focus is inside xterm and no prefix: leave keys to the shell,
    // except Escape which blurs into "nav mode" for the term chrome.
    if (inTerm && !termPrefix) {
      if (ev.key === 'Escape') {
        // Don't preventDefault — vim needs esc. Double-esc or ctrl-b for desk.
        return;
      }
      return;
    }

    // ── Chord leader: g ────────────────────────────────────────────────
    if (pendingChord === 'g') {
      const letter = chordLetter(ev);
      if (letter && GO_TARGETS[letter.toLowerCase()]) {
        ev.preventDefault();
        ev.stopPropagation();
        const target = GO_TARGETS[letter.toLowerCase()]!;
        clearChord();
        opts.controller.navigate(target.hash);
        return;
      }
      // gg on deck/dash handled as second g with gFirstPending
      if (letter === 'g' || letter === 'G') {
        ev.preventDefault();
        ev.stopPropagation();
        clearChord();
        opts.controller.onAction?.('motion.gg', {});
        surfaceHandlers.get(surface)?.(ev, runtime);
        return;
      }
      clearChord();
      // fall through with this key as a fresh press
    }

    // Start "g …" chord
    if (!pendingChord && !ev.metaKey && !ev.ctrlKey && !ev.altKey && (ev.key === 'g')) {
      ev.preventDefault();
      ev.stopPropagation();
      armChord('g');
      gFirstPending = true;
      return;
    }

    // G → last item (surface)
    if (!pendingChord && !ev.metaKey && !ev.ctrlKey && !ev.altKey && ev.key === 'G') {
      ev.preventDefault();
      ev.stopPropagation();
      opts.controller.onAction?.('motion.G', {});
      surfaceHandlers.get(surface)?.(ev, runtime);
      return;
    }

    // ── Global single keys (nav mode only) ─────────────────────────────
    if (!ev.metaKey && !ev.ctrlKey && !ev.altKey) {
      if (ev.key === '?' ) {
        ev.preventDefault();
        ev.stopPropagation();
        opts.openHelp();
        return;
      }
      if (ev.key === ':' && surface !== 'term') {
        ev.preventDefault();
        ev.stopPropagation();
        opts.openPalette();
        return;
      }
    }

    // Escape globally
    if (ev.key === 'Escape') {
      clearChord();
      clearTermPrefix();
      opts.closeOverlays();
      if (document.body.hasAttribute('data-drawer-open')) {
        document.dispatchEvent(new CustomEvent('grok-remote:close-drawer'));
      }
      surfaceHandlers.get(surface)?.(ev, runtime);
      return;
    }

    // ── Surface handler ────────────────────────────────────────────────
    const handler = surfaceHandlers.get(surface);
    if (handler) {
      const handled = handler(ev, runtime);
      if (handled) {
        ev.preventDefault();
        ev.stopPropagation();
      }
    }
  }

  document.addEventListener('keydown', onKeydown, true);

  return {
    dispose: () => {
      document.removeEventListener('keydown', onKeydown, true);
      clearChord();
      clearTermPrefix();
    },
    registerSurface: (surface, handler) => {
      surfaceHandlers.set(surface, handler);
      return () => {
        if (surfaceHandlers.get(surface) === handler) surfaceHandlers.delete(surface);
      };
    },
    runtime,
    getStatus: () => ({ chord: pendingChord, termPrefix }),
  };
}

/** Normalize key for display in help */
export function formatBindingKeys(keys: string): string {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
  return keys
    .replace(/mod\+/g, isMac ? '⌘' : 'Ctrl+')
    .replace(/ctrl-b/g, 'Ctrl-b')
    .replace(/ctrl-/g, 'Ctrl+')
    .replace(/shift\+/gi, 'Shift+');
}
