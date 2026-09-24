// Grok Deck — premium unified home for Dash + Terminal + Remote + native hosts.
// Keyboard-first: j/k · h/l · 1–4 · Enter/o · Shift+Enter · gg/G

import { el } from '../lib/render.js';
import { api } from '../lib/api.js';
import { fetchVoiceStatus } from '../lib/voice.js';
import type { SurfaceKeyHandler } from '../lib/desk-keys.js';
import { playDeckMotion } from '../lib/shell-motion.js';

interface DeckStatus {
  ok?: boolean;
  remote?: {
    url?: string;
    agents?: number;
    connected?: number;
    working?: number;
    errored?: number;
  };
  terminals?: number;
  voice?: { ok?: boolean; source?: string | null; hint?: string };
  native?: {
    groktermApp?: boolean;
    groktermCli?: boolean;
    grokCli?: boolean;
  };
  features?: Record<string, boolean>;
}

type LaunchTarget = 'grokterm' | 'grok-dashboard';

type CardId = 'dash' | 'term' | 'remote' | 'grokterm';

interface CardDef {
  id: CardId;
  tone: string;
  icon: string;
  kicker: string;
  title: string;
  body: Array<string | HTMLElement>;
  primary: () => void;
  secondary: () => void;
  primaryLabel: string;
  secondaryLabel: string;
}

const ICONS = {
  dash: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="6.5" height="6.5" rx="1.5"/><rect x="11" y="2.5" width="6.5" height="6.5" rx="1.5"/><rect x="2.5" y="11" width="6.5" height="6.5" rx="1.5"/><rect x="11" y="11" width="6.5" height="6.5" rx="1.5"/></svg>`,
  term: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M6 8.5l2.5 2L6 12.5"/><path d="M10.5 12.5H14"/></svg>`,
  remote: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 10a6.5 6.5 0 0 1 13 0"/><path d="M6 10a4 4 0 0 1 8 0"/><circle cx="10" cy="13.5" r="1.3" fill="currentColor" stroke="none"/></svg>`,
  grokterm: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5h12a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 15.5H4A1.5 1.5 0 0 1 2.5 14V7A1.5 1.5 0 0 1 4 5.5z"/><path d="M7 17.5h6"/><circle cx="10" cy="10" r="1.8"/></svg>`,
};

function icon(html: string): HTMLElement {
  return el('div', { class: 'deck-card-icon', html });
}

export class DeckView {
  root: HTMLElement;
  private statusEl!: HTMLElement;
  private panelsEl!: HTMLElement;
  private keyHintEl!: HTMLElement;
  private pulseTimer: ReturnType<typeof setInterval> | null = null;
  private focusIdx = 0;
  private cards: CardDef[] = [];
  private cardEls: HTMLElement[] = [];

  constructor() {
    this.statusEl = el('div', { class: 'deck-status-grid' },
      el('div', { class: 'deck-pill deck-pill--idle' },
        el('span', { class: 'deck-pill-label' }, 'Status'),
        el('span', { class: 'deck-pill-detail' }, 'Loading…'),
      ),
    );

    this.keyHintEl = el('div', { class: 'deck-key-hint' },
      el('kbd', {}, 'j/k'),
      ' cards · ',
      el('kbd', {}, '1–4'),
      ' jump · ',
      el('kbd', {}, 'enter'),
      ' open · ',
      el('kbd', {}, 'g d'),
      ' / ',
      el('kbd', {}, 'g a'),
      ' / ',
      el('kbd', {}, 'g t'),
      ' go · ',
      el('kbd', {}, '?'),
      ' help',
    );

    this.cards = [
      {
        id: 'dash',
        tone: 'dash',
        icon: ICONS.dash,
        kicker: '01  Dash',
        title: 'Agent board',
        body: [
          'Grouped roster with peek and reply. Same job as ',
          el('code', {}, 'grok dashboard'),
          ', in the browser.',
        ],
        primaryLabel: 'Open Dash',
        secondaryLabel: 'Native TUI',
        primary: () => { location.hash = '#/dash'; },
        secondary: () => { void this.launch('grok-dashboard'); },
      },
      {
        id: 'term',
        tone: 'term',
        icon: ICONS.term,
        kicker: '02  Terminal',
        title: 'Shell tabs',
        body: [
          'Browser PTYs for shell or interactive ',
          el('code', {}, 'grok'),
          '. Falls back to macOS Terminal if the host blocks PTY.',
        ],
        primaryLabel: 'Open Terminal',
        secondaryLabel: 'New shell',
        primary: () => { location.hash = '#/term'; },
        secondary: () => {
          location.hash = '#/term';
          queueMicrotask(() => {
            document.dispatchEvent(new CustomEvent('grok-desk:term', {
              detail: { action: 'new', kind: 'shell' },
            }));
          });
        },
      },
      {
        id: 'remote',
        tone: 'remote',
        icon: ICONS.remote,
        kicker: '03  Sessions',
        title: 'Sessions',
        body: [
          'Chat, tools, files, and voice against ',
          el('code', {}, 'grok agent'),
          ' sessions.',
        ],
        primaryLabel: 'Open chats',
        secondaryLabel: 'Agents',
        primary: () => { location.hash = '#/chats'; },
        secondary: () => { location.hash = '#/agents'; },
      },
      {
        id: 'grokterm',
        tone: 'grokterm',
        icon: ICONS.grokterm,
        kicker: '04  GrokTerm',
        title: 'Native host',
        body: [
          'Desktop multi-tab terminal with voice. Use when you want the full app, not the browser.',
        ],
        primaryLabel: 'Launch GrokTerm',
        secondaryLabel: 'Native dash',
        primary: () => { void this.launch('grokterm'); },
        secondary: () => { void this.launch('grok-dashboard'); },
      },
    ];

    this.panelsEl = el('section', {
      class: 'deck-panels',
      role: 'listbox',
      'aria-label': 'Desk surfaces',
    });
    this.cardEls = this.cards.map((c, i) => this.renderCard(c, i));
    for (const node of this.cardEls) this.panelsEl.appendChild(node);

    this.root = el('div', { class: 'deck', tabindex: '0' },
      el('section', { class: 'deck-hero' },
        el('div', { class: 'deck-hero-top' },
          el('div', { class: 'deck-hero-badge' }, 'Local desk'), // stamped kicker; CSS uppercases
        ),
        el('h1', { class: 'deck-hero-title' }, 'Grok Deck'),
        el('p', { class: 'deck-hero-sub' },
          'Workbench for agents, shell, and chat. Wood, brass, and keys — ',
          el('strong', {}, 'Dash'),
          ', ',
          el('strong', {}, 'Terminal'),
          ', ',
          el('strong', {}, 'Sessions'),
          ', ',
          el('strong', {}, 'GrokTerm'),
          '.',
        ),
        this.statusEl,
        this.keyHintEl,
      ),
      this.panelsEl,
      el('section', { class: 'deck-lower' },
        el('div', { class: 'deck-flow' },
          el('h3', { class: 'deck-flow-title' }, 'Workflow'),
          el('ol', { class: 'deck-flow-list' },
            this.flowStep(1, el('strong', {}, 'Deck'), ' — status and entry points'),
            this.flowStep(2, el('strong', {}, 'Dash'), ' — run and watch agents'),
            this.flowStep(3, el('strong', {}, 'Terminal'), ' — shell or interactive TUI'),
            this.flowStep(4, el('strong', {}, 'Sessions'), ' — chat and voice'),
            this.flowStep(5, el('strong', {}, 'GrokTerm'), ' — native desk when needed'),
          ),
        ),
        el('div', { class: 'deck-shortcuts-panel' },
          el('h3', { class: 'deck-shortcuts-title' }, 'Keys'),
          el('div', { class: 'deck-shortcuts' },
            el('div', { class: 'deck-shortcut' }, el('kbd', {}, 'g d'), ' deck'),
            el('div', { class: 'deck-shortcut' }, el('kbd', {}, 'g a'), ' dash'),
            el('div', { class: 'deck-shortcut' }, el('kbd', {}, 'g t'), ' term'),
            el('div', { class: 'deck-shortcut' }, el('kbd', {}, 'g c'), ' chats'),
            el('div', { class: 'deck-shortcut' }, el('kbd', {}, 'mod+k'), ' palette'),
            el('div', { class: 'deck-shortcut' }, el('kbd', {}, '?'), ' help'),
          ),
        ),
      ),
      el('footer', { class: 'deck-colophon' },
        el('span', { class: 'deck-colophon-mark' }, 'Atelier desk'),
        el('span', { class: 'deck-colophon-meta' }, 'local · brass · ink'),
      ),
    );

    this.paintFocus();
  }

  /** Surface key handler for the desk router */
  handleKey: SurfaceKeyHandler = (ev) => {
    if (!this.root.isConnected) return false;

    // motion.gg / G via key after global router
    if (ev.key === 'g' || ev.key === 'G') {
      // only when router re-dispatches after chord — gg handled in onAction
      return false;
    }

    if (ev.key === 'j' || ev.key === 'ArrowDown' || ev.key === 'l' || ev.key === 'ArrowRight') {
      this.moveFocus(1);
      return true;
    }
    if (ev.key === 'k' || ev.key === 'ArrowUp' || ev.key === 'h' || ev.key === 'ArrowLeft') {
      this.moveFocus(-1);
      return true;
    }
    if (ev.key >= '1' && ev.key <= '4') {
      const idx = Number(ev.key) - 1;
      this.focusIdx = idx;
      this.paintFocus();
      this.activatePrimary();
      return true;
    }
    if (ev.key === 'Enter') {
      if (ev.shiftKey) this.activateSecondary();
      else this.activatePrimary();
      return true;
    }
    if (ev.key === 'o') {
      this.activatePrimary();
      return true;
    }
    if (ev.key === 'O') {
      this.activateSecondary();
      return true;
    }
    return false;
  };

  onDeskAction(action: string): void {
    if (action === 'motion.gg') {
      this.focusIdx = 0;
      this.paintFocus();
    } else if (action === 'motion.G') {
      this.focusIdx = this.cards.length - 1;
      this.paintFocus();
    }
  }

  private renderCard(def: CardDef, index: number): HTMLElement {
    const primaryBtn = el('button', {
      class: 'btn btn--primary',
      type: 'button',
      onclick: (ev: Event) => {
        ev.stopPropagation();
        def.primary();
      },
    }, def.primaryLabel);
    const secondaryBtn = el('button', {
      class: 'btn btn--ghost',
      type: 'button',
      onclick: (ev: Event) => {
        ev.stopPropagation();
        def.secondary();
      },
    }, def.secondaryLabel);

    const plate = String(index + 1).padStart(2, '0');
    const article = el('article', {
      class: `deck-card deck-card--${def.tone}`,
      role: 'option',
      tabindex: '-1',
      'data-card-index': String(index),
      'data-card-id': def.id,
      'aria-label': `${def.title}. ${def.primaryLabel}`,
      onclick: () => {
        this.focusIdx = index;
        this.paintFocus();
      },
      ondblclick: () => {
        this.focusIdx = index;
        this.paintFocus();
        def.primary();
      },
    },
      el('span', { class: 'deck-card-index', 'aria-hidden': 'true' }, plate),
      icon(def.icon),
      el('div', { class: 'deck-card-kicker' }, def.kicker),
      el('h2', { class: 'deck-card-title' }, def.title),
      el('p', { class: 'deck-card-body' }, ...def.body),
      el('div', { class: 'deck-card-actions' }, primaryBtn, secondaryBtn),
    );
    return article;
  }

  private moveFocus(delta: number): void {
    const n = this.cards.length;
    this.focusIdx = (this.focusIdx + delta + n) % n;
    this.paintFocus();
  }

  private paintFocus(): void {
    this.cardEls.forEach((node, i) => {
      const on = i === this.focusIdx;
      node.classList.toggle('deck-card--focused', on);
      node.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const focused = this.cardEls[this.focusIdx];
    focused?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  private activatePrimary(): void {
    this.cards[this.focusIdx]?.primary();
  }

  private activateSecondary(): void {
    this.cards[this.focusIdx]?.secondary();
  }

  private flowStep(n: number, ...rest: Array<string | HTMLElement>): HTMLElement {
    return el('li', {},
      el('span', { class: 'deck-flow-step' }, String(n)),
      el('span', {}, ...rest),
    );
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.root);
    playDeckMotion(this.root);
    void this.refresh();
    this.pulseTimer = setInterval(() => { void this.refresh(); }, 8000);
    // Prefer focus on deck for immediate keys without click
    requestAnimationFrame(() => {
      try { this.root.focus({ preventScroll: true }); } catch { /* ignore */ }
    });
  }

  unmount(): void {
    if (this.pulseTimer) {
      clearInterval(this.pulseTimer);
      this.pulseTimer = null;
    }
    try { this.root.remove(); } catch { /* ignore */ }
  }

  private async refresh(): Promise<void> {
    let deck: DeckStatus = {};
    let voiceOk = false;
    try {
      deck = await api.deck.status() as DeckStatus;
    } catch {
      deck = {};
    }
    try {
      const v = await fetchVoiceStatus();
      voiceOk = !!v.ok;
    } catch { /* ignore */ }

    const remoteOk = !!deck.remote;
    const agents = deck.remote?.agents ?? 0;
    const connected = deck.remote?.connected ?? 0;
    const working = deck.remote?.working ?? 0;
    const errored = deck.remote?.errored ?? 0;
    const terms = deck.terminals ?? 0;
    const native = deck.native || {};

    const remoteDetail = remoteOk
      ? (working > 0
        ? `${working} working · ${connected}/${agents} live`
        : `${connected}/${agents} live`)
      : 'down';
    const remoteKind = !remoteOk ? 'bad' : (errored > 0 ? 'warn' : (connected > 0 ? 'ok' : 'idle'));

    this.statusEl.replaceChildren(
      this.pill('Remote', remoteKind, remoteDetail),
      this.pill(
        'Agents',
        working > 0 ? 'ok' : (connected > 0 ? 'ok' : 'idle'),
        working > 0 ? `${working} active` : (connected > 0 ? `${connected} connected` : 'none live'),
      ),
      this.pill(
        'Voice',
        voiceOk || deck.voice?.ok ? 'ok' : 'warn',
        voiceOk || deck.voice?.ok ? (deck.voice?.source || 'ready') : 'auth needed',
      ),
      this.pill('Terminals', terms > 0 ? 'ok' : 'idle', `${terms} open`),
      this.pill('Grok CLI', native.grokCli ? 'ok' : 'warn', native.grokCli ? 'ready' : 'missing'),
      this.pill(
        'GrokTerm',
        (native.groktermApp || native.groktermCli) ? 'ok' : 'warn',
        native.groktermApp ? 'app ready' : (native.groktermCli ? 'cli ready' : 'missing'),
      ),
    );
  }

  private pill(label: string, kind: string, detail: string): HTMLElement {
    return el('div', { class: `deck-pill deck-pill--${kind}` },
      el('span', { class: 'deck-pill-label' }, label),
      el('span', { class: 'deck-pill-detail' }, detail),
    );
  }

  private async launch(target: LaunchTarget): Promise<void> {
    try {
      const res = await api.deck.launch(target) as { ok?: boolean; message?: string; error?: string };
      if (res.ok) this.flash(res.message || 'Launched');
      else this.flash(res.message || res.error || 'Launch failed', true);
    } catch (err) {
      this.flash(err instanceof Error ? err.message : String(err), true);
    }
  }

  private flash(msg: string, warn = false): void {
    const t = el('div', { class: `deck-toast${warn ? ' deck-toast--warn' : ''}` }, msg);
    this.root.appendChild(t);
    setTimeout(() => { try { t.remove(); } catch { /* ignore */ } }, 3200);
  }
}
