import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeskSurface } from '../src/lib/desk-keys.js';

// Minimal browser shims before importing desk-keys.
type Listener = (ev: KeyboardEvent) => void;
const listeners = new Map<string, Set<Listener>>();
const bodyAttrs = new Map<string, string>();

class FakeElement {
  tagName: string;
  isContentEditable = false;
  private xterm = false;
  constructor(tagName: string, opts?: { contentEditable?: boolean; xterm?: boolean }) {
    this.tagName = tagName.toUpperCase();
    this.isContentEditable = !!opts?.contentEditable;
    this.xterm = !!opts?.xterm;
  }
  closest(sel: string): FakeElement | null {
    if (this.xterm && /xterm|term-surface|term-host|term-view/.test(sel)) return this;
    if (this.isContentEditable && sel.includes('contenteditable')) return this;
    return null;
  }
}

(globalThis as unknown as { Element: typeof FakeElement }).Element = FakeElement;
(globalThis as unknown as { HTMLElement: typeof FakeElement }).HTMLElement = FakeElement;

(globalThis as unknown as {
  document: {
    body: {
      setAttribute: (k: string, v: string) => void;
      removeAttribute: (k: string) => void;
      hasAttribute: (k: string) => boolean;
      getAttribute: (k: string) => string | null;
    };
    addEventListener: (type: string, fn: Listener, opts?: unknown) => void;
    removeEventListener: (type: string, fn: Listener, opts?: unknown) => void;
    dispatchEvent: (ev: Event) => boolean;
  };
  location: { hash: string };
}).document = {
  body: {
    setAttribute: (k, v) => { bodyAttrs.set(k, v); },
    removeAttribute: (k) => { bodyAttrs.delete(k); },
    hasAttribute: (k) => bodyAttrs.has(k),
    getAttribute: (k) => bodyAttrs.has(k) ? bodyAttrs.get(k)! : null,
  },
  addEventListener: (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(fn);
  },
  removeEventListener: (type, fn) => {
    listeners.get(type)?.delete(fn);
  },
  dispatchEvent: (ev) => {
    const set = listeners.get(ev.type);
    if (set) for (const fn of set) fn(ev as KeyboardEvent);
    return true;
  },
};
(globalThis as unknown as { location: { hash: string } }).location = { hash: '#/deck' };

const desk = await import('../src/lib/desk-keys.js');

interface FakeKeyEv {
  type: string;
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
  isComposing: boolean;
  target: unknown;
  preventDefault: () => void;
  stopPropagation: () => void;
}

function fireKey(partial: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target?: unknown;
}): FakeKeyEv {
  const ev: FakeKeyEv = {
    type: 'keydown',
    key: partial.key,
    metaKey: !!partial.metaKey,
    ctrlKey: !!partial.ctrlKey,
    altKey: !!partial.altKey,
    shiftKey: !!partial.shiftKey,
    defaultPrevented: false,
    isComposing: false,
    target: partial.target ?? new FakeElement('body'),
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {},
  };
  document.dispatchEvent(ev as unknown as Event);
  return ev;
}

test('parseRouteSurface maps deck/dash/term and aliases', () => {
  assert.equal(desk.parseRouteSurface('#/'), 'deck');
  assert.equal(desk.parseRouteSurface('#/deck'), 'deck');
  assert.equal(desk.parseRouteSurface('#/home'), 'deck');
  assert.equal(desk.parseRouteSurface('#/dash'), 'dash');
  assert.equal(desk.parseRouteSurface('#/dashboard'), 'dash');
  assert.equal(desk.parseRouteSurface('#/term'), 'term');
  assert.equal(desk.parseRouteSurface('#/terminal'), 'term');
  assert.equal(desk.parseRouteSurface('#/tty'), 'term');
  assert.equal(desk.parseRouteSurface('#/chats'), 'chat');
  assert.equal(desk.parseRouteSurface('#/agents/abc'), 'chat');
  assert.equal(desk.parseRouteSurface('#/settings/mcp'), 'settings');
  assert.equal(desk.parseRouteSurface('#/memory'), 'system');
});

test('isEditableTarget recognizes form controls', () => {
  assert.equal(desk.isEditableTarget(new FakeElement('input') as unknown as EventTarget), true);
  assert.equal(desk.isEditableTarget(new FakeElement('div') as unknown as EventTarget), false);
  assert.equal(desk.isEditableTarget(null), false);
});

test('isTerminalTarget matches xterm hosts', () => {
  assert.equal(
    desk.isTerminalTarget(new FakeElement('div', { xterm: true }) as unknown as EventTarget),
    true,
  );
  assert.equal(
    desk.isTerminalTarget(new FakeElement('div') as unknown as EventTarget),
    false,
  );
});

test('DESK_BINDINGS cover deck j/k, dash j/k, and term prefix', () => {
  const keys = desk.DESK_BINDINGS.map((b) => `${b.group}:${b.keys}`);
  assert.ok(keys.some((k) => k.startsWith('deck:') && k.includes('j / k')));
  assert.ok(keys.some((k) => k.startsWith('dash:') && k.includes('j / k')));
  assert.ok(keys.some((k) => k.startsWith('term:') && k.includes('ctrl-b')));
  assert.ok(keys.some((k) => k.startsWith('global:') && k.includes('g d')));
});

test('installDeskKeys routes j/k on deck to the registered surface handler', () => {
  const handled: string[] = [];
  let surface: DeskSurface = 'deck';

  const api = desk.installDeskKeys({
    controller: {
      navigate: () => {},
      getSurface: () => surface,
    },
    openPalette: () => {},
    openHelp: () => {},
    closeOverlays: () => {},
    isOverlayOpen: () => false,
  });

  const unreg = api.registerSurface('deck', (ev) => {
    handled.push(ev.key);
    return true;
  });

  fireKey({ key: 'j' });
  fireKey({ key: 'k' });
  assert.deepEqual(handled, ['j', 'k']);

  // Wrong surface → no call
  surface = 'dash';
  fireKey({ key: 'j' });
  assert.deepEqual(handled, ['j', 'k']);

  unreg();
  surface = 'deck';
  fireKey({ key: 'j' });
  assert.deepEqual(handled, ['j', 'k']);

  api.dispose();
});

test('installDeskKeys navigates on g d chord and mod+2', () => {
  const nav: string[] = [];
  const api = desk.installDeskKeys({
    controller: {
      navigate: (hash) => { nav.push(hash); },
      getSurface: () => 'deck',
    },
    openPalette: () => {},
    openHelp: () => {},
    closeOverlays: () => {},
    isOverlayOpen: () => false,
  });

  fireKey({ key: 'g' });
  assert.equal(api.getStatus().chord, 'g');
  fireKey({ key: 'd' });
  assert.equal(nav.at(-1), '#/deck');
  assert.equal(api.getStatus().chord, null);

  fireKey({ key: '2', metaKey: true });
  assert.equal(nav.at(-1), '#/dash');

  fireKey({ key: '3', metaKey: true });
  assert.equal(nav.at(-1), '#/term');

  api.dispose();
});

test('formatBindingKeys expands mod+', () => {
  const s = desk.formatBindingKeys('mod+k');
  assert.ok(s.includes('⌘') || s.includes('Ctrl+'));
});
