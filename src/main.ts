// grok-remote dashboard entry point.

import './styles/premium.css';
import './styles/craft-layer.css';
import Split from 'split.js';
import { api } from './lib/api.js';
import { AgentsSidebar } from './views/agents.js';
import { ChatView } from './views/chat.js';
import { SettingsView } from './views/settings.js';
import { DashView } from './views/dash.js';
import { DeckView } from './views/deck.js';
import { TermView } from './views/term.js';
import { el } from './lib/render.js';
import { registerPwa } from './lib/pwa.js';
import { applyTheme, getTheme, nextTheme, getThemeMeta, setTheme } from './lib/themes.js';
import { installVersionFooter } from './lib/version-footer.js';
import { SYSTEM_PAGES, getSystemPage } from './views/system/index.js';
import { iconHtml } from './lib/icons.js';
import {
  rememberDeskHash,
  restoreDeskHashIfEmpty,
  isRailSystemOpen,
  rememberRailSystemOpen,
  rememberDeskTheme,
  getDeskTheme,
  bootstrapDesk,
  rememberLastAgent,
  rememberDeskSplit,
} from './lib/desk-furniture.js';
import {
  installDeskKeys,
  parseRouteSurface,
  type DeskSurface,
} from './lib/desk-keys.js';
import {
  defaultDeskCommands,
  installDeskOverlays,
} from './lib/desk-overlays.js';

interface Agent {
  id: string;
  name?: string;
  status?: string;
  inFlight?: number;
  [k: string]: unknown;
}

type Route =
  | { name: 'home' }
  | { name: 'deck' }
  | { name: 'dash' }
  | { name: 'term' }
  | { name: 'chat'; agentId: string }
  | { name: 'settings'; sub: string }
  | { name: 'system'; area: string; parts: string[] }
  | { name: 'redirect'; to: string };

interface SystemPageRef {
  area: string;
  module?: { mount?: (host: HTMLElement, route?: unknown) => void; unmount?: () => void };
}

/**
 * Theme resolution (craft desk):
 * 1) desk.json / local theme if user already chose
 * 2) else server settings.theme (default atelier)
 * 3) else atelier
 * Legacy "dark" from either side promotes to atelier once.
 */
function resolveInitialTheme(): string {
  const fromDesk = getDeskTheme() || (() => {
    try { return localStorage.getItem('grok-remote.theme') || ''; } catch { return ''; }
  })();
  if (fromDesk && fromDesk !== 'dark' && fromDesk !== 'aurora' && fromDesk !== 'nebula') {
    return fromDesk;
  }
  return 'atelier';
}

applyTheme(resolveInitialTheme());
rememberDeskTheme(getTheme());

/** Pull server settings theme; only apply if client still on default-ish atelier/dark. */
async function syncThemeFromServer(): Promise<void> {
  try {
    const s = await api.getSettings() as { theme?: string };
    const serverTheme = typeof s?.theme === 'string' ? s.theme : '';
    if (!serverTheme) return;
    const cur = getTheme();
    // Prefer server when client is still on craft default or legacy dark
    if (cur === 'atelier' || cur === 'dark' || !cur) {
      const next = serverTheme === 'dark' ? 'atelier' : serverTheme;
      setTheme(next);
      rememberDeskTheme(next);
      syncThemeToggle(next);
    }
    // If server still dark, push atelier up so drift cannot return
    if (serverTheme === 'dark') {
      void api.patchSettings({ theme: 'atelier' }).catch(() => { /* ignore */ });
    }
  } catch { /* offline / first paint */ }
}

function syncThemeToggle(name: string): void {
  const meta = getThemeMeta(name);
  const dot   = document.getElementById('theme-toggle-dot');
  const label = document.getElementById('theme-toggle-label');
  const btn   = document.getElementById('theme-toggle');
  if (dot)   dot.style.background = meta.accent;
  if (label) label.textContent = meta.label;
  if (btn)   btn.title = `theme: ${meta.label} (click to cycle)`;
}

window.addEventListener('storage', (ev: StorageEvent) => {
  if (ev.key === 'grok-remote.theme') {
    applyTheme(getTheme());
    syncThemeToggle(getTheme());
  }
});
window.addEventListener('grok-remote:theme-change', () => {
  syncThemeToggle(getTheme());
});

function setStatus(kind: string, text: string): void {
  const pill = document.getElementById('status-pill');
  const txt  = document.getElementById('status-text');
  if (!pill || !txt) return;
  pill.className = 'status-pill';
  pill.classList.add(`status-pill--${kind}`);
  pill.textContent = kind === 'ok' ? '●' : (kind === 'fail' ? '×' : (kind === 'warn' ? '!' : '·'));
  txt.textContent = text;
}

async function pingHello(): Promise<void> {
  try {
    const data = await api.hello() as { tailscale?: { backend?: string } };
    const ts = data && data.tailscale;
    if (ts && ts.backend === 'Running') setStatus('ok', 'tailnet up');
    else if (ts) setStatus('warn', `tailscale: ${ts.backend || 'unknown'}`);
    else setStatus('warn', 'no tailscale identity');
  } catch {
    setStatus('fail', 'api unreachable');
  }
}

const SYSTEM_AREAS = new Set(SYSTEM_PAGES.map((p) => p.area));

const SETTINGS_AREAS = new Set([
  'general',
  'skills', 'subagents', 'hooks', 'plugins', 'marketplaces',
  'mcp', 'lsp', 'models', 'worktrees', 'import', 'setup',
]);

function parseRoute(): Route {
  const h = (location.hash || '#/').replace(/^#/, '');
  const parts = h.split('/').filter(Boolean);
  // Default home is the unified Deck
  if (!parts.length) return { name: 'deck' };
  if (parts[0] === 'deck' || parts[0] === 'home') return { name: 'deck' };
  if (parts[0] === 'dash' || parts[0] === 'dashboard') return { name: 'dash' };
  if (parts[0] === 'term' || parts[0] === 'terminal' || parts[0] === 'tty') return { name: 'term' };
  if (parts[0] === 'chats' || parts[0] === 'chat') return { name: 'home' };
  if (parts[0] === 'agents' && parts[1]) return { name: 'chat', agentId: parts[1] };
  if (parts[0] === 'agents' && !parts[1]) return { name: 'home' };
  if (parts[0] === 'settings') {
    return { name: 'settings', sub: parts[1] || 'general' };
  }
  if (parts[0] && SYSTEM_AREAS.has(parts[0])) return { name: 'system', area: parts[0], parts };
  if (parts[0] && SETTINGS_AREAS.has(parts[0])) {
    return { name: 'redirect', to: `#/settings/${parts[0]}` };
  }
  return { name: 'deck' };
}

function navigate(hash: string): void {
  if (location.hash === hash) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = hash;
  }
  rememberDeskHash(hash);
}

function openDrawer(): void {
  document.body.setAttribute('data-drawer-open', '');
  const btn = document.getElementById('hamburger-btn');
  if (btn) btn.setAttribute('aria-expanded', 'true');
  const bd = document.getElementById('drawer-backdrop') as HTMLElement | null;
  if (bd) bd.hidden = false;
}
function closeDrawer(): void {
  document.body.removeAttribute('data-drawer-open');
  const btn = document.getElementById('hamburger-btn');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  const bd = document.getElementById('drawer-backdrop') as HTMLElement | null;
  if (bd) bd.hidden = true;
}
function toggleDrawer(): void {
  if (document.body.hasAttribute('data-drawer-open')) closeDrawer();
  else openDrawer();
}

interface RailIconOpts {
  href: string;
  title: string;
  area: string;
  iconName?: string;
  label?: string;
}

function makeRailIcon({ href, title, area, iconName, label }: RailIconOpts): HTMLElement {
  const a = el('a', {
    class: 'left-rail-item',
    href,
    title,
    'aria-label': title,
    'data-area': area,
  });
  const icon = document.createElement('span');
  icon.className = 'left-rail-icon';
  icon.innerHTML = iconHtml(iconName || '');
  a.appendChild(icon);
  const lbl = el('span', { class: 'left-rail-label' }, label || title);
  a.appendChild(lbl);
  return a;
}

function buildLeftRail(): HTMLElement {
  const rail = el('nav', { class: 'left-rail', 'aria-label': 'top-level navigation' });

  // Primary workbench surfaces (craft desk spine)
  const primary = el('div', { class: 'left-rail-primary' });
  primary.appendChild(makeRailIcon({
    href: '#/deck', title: 'Grok Deck — unified home', area: 'deck', iconName: 'home', label: 'deck',
  }));
  primary.appendChild(makeRailIcon({
    href: '#/dash', title: 'agent dashboard', area: 'dash', iconName: 'leaders', label: 'dash',
  }));
  primary.appendChild(makeRailIcon({
    href: '#/term', title: 'embedded terminal', area: 'term', iconName: 'flow', label: 'term',
  }));
  primary.appendChild(makeRailIcon({
    href: '#/chats', title: 'conversations', area: 'home', iconName: 'skills', label: 'chats',
  }));
  rail.appendChild(primary);

  // System pages demoted under "more" so the rail reads as a workbench
  const system = el('div', { class: 'left-rail-system' });
  const systemItems = el('div', {
    class: 'left-rail-system-items',
    id: 'left-rail-system-items',
    hidden: true,
  });
  for (const p of SYSTEM_PAGES) {
    systemItems.appendChild(makeRailIcon({
      href: `#/${p.area}`, title: p.label, area: p.area, iconName: p.iconName, label: p.label,
    }));
  }
  const moreBtn = el('button', {
    class: 'left-rail-more',
    type: 'button',
    id: 'left-rail-more',
    title: 'System pages (memory, leaders, sessions, health)',
    'aria-label': 'Show system pages',
    'aria-expanded': 'false',
    'aria-controls': 'left-rail-system-items',
    onclick: () => {
      const open = systemItems.hasAttribute('hidden');
      if (open) systemItems.removeAttribute('hidden');
      else systemItems.setAttribute('hidden', '');
      moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      moreBtn.setAttribute('aria-label', open ? 'Hide system pages' : 'Show system pages');
      rememberRailSystemOpen(open);
    },
  },
    el('span', { class: 'left-rail-icon', html: iconHtml('settings') }),
    el('span', { class: 'left-rail-more-label' }, 'more'),
  );
  system.appendChild(moreBtn);
  system.appendChild(systemItems);
  rail.appendChild(system);

  // Restore expanded state; auto-expand is handled in updateRailHighlight
  if (isRailSystemOpen()) {
    systemItems.removeAttribute('hidden');
    moreBtn.setAttribute('aria-expanded', 'true');
    moreBtn.setAttribute('aria-label', 'Hide system pages');
  }

  return rail;
}

function updateRailHighlight(route: Route): void {
  const rail = document.querySelector('.left-rail');
  if (!rail) return;
  let activeArea = 'deck';
  if (route.name === 'chat' || route.name === 'home') activeArea = 'home';
  else if (route.name === 'deck') activeArea = 'deck';
  else if (route.name === 'dash') activeArea = 'dash';
  else if (route.name === 'term') activeArea = 'term';
  else if (route.name === 'system') activeArea = route.area;
  for (const item of rail.querySelectorAll<HTMLElement>('.left-rail-item')) {
    item.classList.toggle('left-rail-item--active', item.dataset.area === activeArea);
  }

  // Auto-expand system group when a system page is active
  if (route.name === 'system') {
    const systemItems = document.getElementById('left-rail-system-items');
    const moreBtn = document.getElementById('left-rail-more');
    if (systemItems?.hasAttribute('hidden')) {
      systemItems.removeAttribute('hidden');
      moreBtn?.setAttribute('aria-expanded', 'true');
      moreBtn?.setAttribute('aria-label', 'Hide system pages');
    }
  }
}

function mountDashboard(): void {
  const host = document.getElementById('app');
  if (!host) return;
  host.replaceChildren();

  let currentAgent: Agent | null = null;
  let activeSystemPage: SystemPageRef | null = null;
  let activeDash: DashView | null = null;
  let activeDeck: DeckView | null = null;
  let activeTerm: TermView | null = null;
  let unregSurface: (() => void) | null = null;
  const chat     = new ChatView();
  const settings = new SettingsView();
  const sidebar  = new AgentsSidebar({
    onSelect: (id: string) => {
      rememberLastAgent(id);
      chat.focusConversation();
      navigate(`#/agents/${encodeURIComponent(id)}`);
    },
    onCreate: () => { chat.focusConversation(); },
    onDelete: (id: string) => {
      if (currentAgent && currentAgent.id === id) {
        currentAgent = null;
        navigate('#/chats');
      }
    },
  });

  // Chat surface j/k roster motion
  document.addEventListener('grok-desk:sidebar-move', ((ev: CustomEvent<{ delta?: number }>) => {
    const delta = Number(ev.detail?.delta || 0);
    if (!delta) return;
    sidebar.moveSelection(delta);
  }) as EventListener);

  // ── Desk keyboard control plane (primary interaction model) ──────────
  const overlays = installDeskOverlays(document.body);
  overlays.setCommands(defaultDeskCommands(navigate));

  const deskKeys = installDeskKeys({
    controller: {
      navigate,
      getSurface: (): DeskSurface => parseRouteSurface(location.hash),
      onAction: (action, payload) => {
        if (activeDeck) activeDeck.onDeskAction(action);
        if (activeDash) activeDash.onDeskAction(action);
        if (activeTerm) activeTerm.onDeskAction(action, payload);
      },
    },
    openPalette: () => overlays.openPalette(),
    openHelp: () => overlays.openHelp(parseRouteSurface(location.hash)),
    closeOverlays: () => overlays.close(),
    isOverlayOpen: () => overlays.isOpen(),
  });

  document.addEventListener('grok-desk:help', () => {
    overlays.openHelp(parseRouteSurface(location.hash));
  });

  // Chord / prefix status chip in the topbar (subtle)
  const statusText = document.getElementById('status-text');
  const chordObserver = new MutationObserver(() => {
    if (!statusText) return;
    if (document.body.hasAttribute('data-desk-term-prefix')) {
      statusText.textContent = 'term prefix (ctrl-b)…';
      activeTerm?.setPrefixArmed(true);
    } else if (document.body.getAttribute('data-desk-chord') === 'g') {
      statusText.textContent = 'g…';
      activeTerm?.setPrefixArmed(false);
    } else {
      activeTerm?.setPrefixArmed(false);
    }
  });
  try {
    chordObserver.observe(document.body, { attributes: true, attributeFilter: ['data-desk-chord', 'data-desk-term-prefix'] });
  } catch { /* ignore */ }

  function clearSurfaceKeys(): void {
    if (unregSurface) {
      unregSurface();
      unregSurface = null;
    }
  }

  /** Register the active surface's j/k + shortcut handler with the desk router. */
  function bindSurfaceKeys(surface: DeskSurface): void {
    clearSurfaceKeys();
    if (surface === 'deck' && activeDeck) {
      unregSurface = deskKeys.registerSurface('deck', activeDeck.handleKey);
    } else if (surface === 'dash' && activeDash) {
      unregSurface = deskKeys.registerSurface('dash', activeDash.handleKey);
    } else if (surface === 'term' && activeTerm) {
      unregSurface = deskKeys.registerSurface('term', activeTerm.handleKey);
    } else if (surface === 'chat') {
      unregSurface = deskKeys.registerSurface('chat', chat.handleKey);
    }
  }

  const mainHost = el('div', { class: 'main-pane' });
  const railHost = buildLeftRail();
  const shell = el('div', { class: 'dashboard dashboard--with-rail' });
  host.appendChild(shell);
  shell.appendChild(railHost);

  const splitHost   = el('div', { class: 'split-host' });
  const sidebarPane = el('div', { class: 'sidebar-pane' });
  const mainPane    = el('div', { class: 'main-pane-wrap' });
  sidebar.mount(sidebarPane);
  mainPane.appendChild(mainHost);
  splitHost.appendChild(sidebarPane);
  splitHost.appendChild(mainPane);
  shell.appendChild(splitHost);

  installOuterSplit(splitHost, sidebarPane, mainPane);
  installToolsToggle();

  const settingsBtn = document.getElementById('open-settings');
  if (settingsBtn) {
    settingsBtn.innerHTML = iconHtml('settings');
    settingsBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      navigate('#/settings');
      closeDrawer();
    });
  }
  const brandLink = document.getElementById('brand-link');
  if (brandLink) {
    const name = brandLink.querySelector('.brand-name');
    if (name) name.textContent = 'Grok Deck';
    brandLink.addEventListener('click', (ev) => {
      ev.preventDefault();
      navigate('#/deck');
      closeDrawer();
    });
  }

  const brandActive = document.getElementById('brand-active') as HTMLElement | null;
  const baseTitle = document.title;
  document.addEventListener('grok-remote:agents-refresh', (ev: Event) => {
    const list = ((ev as CustomEvent).detail || []) as Agent[];
    const active = list.some((a) =>
      (typeof a?.inFlight === 'number' && a.inFlight > 0) ||
      (a?.status === 'running')
    );
    if (brandActive) brandActive.hidden = !active;
    const wantTitle = active ? `(*) ${baseTitle}` : baseTitle;
    if (document.title !== wantTitle) document.title = wantTitle;
  });

  installBgTracker();

  shell.addEventListener('click', (ev) => {
    if (!document.body.hasAttribute('data-drawer-open')) return;
    const target = ev.target as Element | null;
    if (target && target.closest && target.closest('.sidebar .agent-item')) {
      closeDrawer();
    }
  });

  let activeSettings = false;

  function unmountActiveSystemPage(): void {
    if (!activeSystemPage) return;
    try { activeSystemPage.module?.unmount?.(); } catch { /* ignore */ }
    activeSystemPage = null;
  }
  function unmountActiveSettings(): void {
    if (!activeSettings) return;
    try { settings.unmount(); } catch { /* ignore */ }
    activeSettings = false;
  }
  function unmountActiveDash(): void {
    if (!activeDash) return;
    try { activeDash.unmount(); } catch { /* ignore */ }
    activeDash = null;
    clearSurfaceKeys();
  }
  function unmountActiveDeck(): void {
    if (!activeDeck) return;
    try { activeDeck.unmount(); } catch { /* ignore */ }
    activeDeck = null;
    clearSurfaceKeys();
  }
  function unmountActiveTerm(): void {
    if (!activeTerm) return;
    try { activeTerm.unmount(); } catch { /* ignore */ }
    activeTerm = null;
    clearSurfaceKeys();
  }

  function renderRoute(): void {
    const route = parseRoute();
    if (route.name === 'redirect') {
      location.replace(location.pathname + location.search + route.to);
      return;
    }
    if (route.name === 'settings' && activeSettings) {
      updateRailHighlight(route);
      clearSurfaceKeys();
      settings.setActive(route.sub);
      return;
    }
    if (route.name === 'dash' && activeDash) {
      updateRailHighlight(route);
      bindSurfaceKeys('dash');
      void activeDash.refresh(true);
      return;
    }
    if (route.name === 'deck' && activeDeck) {
      updateRailHighlight(route);
      bindSurfaceKeys('deck');
      return;
    }
    if (route.name === 'term' && activeTerm) {
      updateRailHighlight(route);
      bindSurfaceKeys('term');
      return;
    }
    clearSurfaceKeys();
    unmountActiveSystemPage();
    unmountActiveSettings();
    unmountActiveDash();
    unmountActiveDeck();
    unmountActiveTerm();
    mainHost.replaceChildren();
    updateRailHighlight(route);
    if (route.name === 'system') {
      const page = getSystemPage(route.area) as SystemPageRef | null;
      if (page && page.module && typeof page.module.mount === 'function') {
        page.module.mount(mainHost, route);
        activeSystemPage = page;
        return;
      }
    }
    if (route.name === 'settings') {
      settings.mount(mainHost);
      settings.setActive(route.sub);
      activeSettings = true;
      return;
    }
    if (route.name === 'deck') {
      activeDeck = new DeckView();
      activeDeck.mount(mainHost);
      bindSurfaceKeys('deck');
      return;
    }
    if (route.name === 'dash') {
      activeDash = new DashView();
      activeDash.mount(mainHost);
      bindSurfaceKeys('dash');
      return;
    }
    if (route.name === 'term') {
      activeTerm = new TermView();
      activeTerm.mount(mainHost);
      bindSurfaceKeys('term');
      return;
    }
    if (route.name === 'chat') {
      chat.mount(mainHost);
      const found = sidebar.agents.find((a: Agent) => a.id === route.agentId);
      if (found) {
        currentAgent = found;
        sidebar.selectedId = found.id;
        sidebar.renderList();
        chat.setAgent(found);
        rememberLastAgent(found.id);
      } else {
        api.getAgent(route.agentId).then((a: unknown) => {
          currentAgent = (a as Agent | null) || { id: route.agentId };
          sidebar.selectedId = currentAgent.id;
          sidebar.renderList();
          chat.setAgent(currentAgent);
          rememberLastAgent(currentAgent.id);
        }).catch(() => {
          currentAgent = { id: route.agentId };
          chat.setAgent(currentAgent);
          rememberLastAgent(route.agentId);
        });
      }
      bindSurfaceKeys('chat');
      return;
    }
    // home / chats — global chords + chat surface (Esc drawer, focus composer)
    chat.mount(mainHost);
    chat.setAgent(null);
    bindSurfaceKeys('chat');
  }

  window.addEventListener('hashchange', () => {
    rememberDeskHash(location.hash);
    renderRoute();
  });
  renderRoute();

  // Keep a dispose hook for HMR / tests
  (window as unknown as { __deskKeysDispose?: () => void }).__deskKeysDispose = () => {
    deskKeys.dispose();
    overlays.dispose();
    chordObserver.disconnect();
  };
}

document.addEventListener('DOMContentLoaded', () => {
  // Pull server desk.json into local cache, then restore last surface hash.
  restoreDeskHashIfEmpty(); // local cache first for instant paint
  void bootstrapDesk(); // server desk.json then re-apply hash if needed
  void pingHello();
  void syncThemeFromServer();
  setInterval(() => { void pingHello(); }, 10000);

  mountDashboard();

  syncThemeToggle(getTheme());
  const themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      const n = nextTheme(getTheme());
      rememberDeskTheme(n);
      syncThemeToggle(n);
      void api.patchSettings({ theme: n }).catch(() => { /* ignore */ });
      window.dispatchEvent(new CustomEvent('grok-remote:theme-change', { detail: { theme: n } }));
    });
  }

  const ham = document.getElementById('hamburger-btn');
  if (ham) {
    ham.addEventListener('click', (ev) => {
      ev.preventDefault();
      toggleDrawer();
    });
  }
  const backdrop = document.getElementById('drawer-backdrop');
  if (backdrop) {
    backdrop.addEventListener('click', () => closeDrawer());
  }
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && document.body.hasAttribute('data-drawer-open')) {
      closeDrawer();
    }
  });
  document.addEventListener('grok-remote:close-drawer', () => closeDrawer());

  registerPwa();

  installVersionFooter();
});

const SIDEBAR_SIZES_KEY = 'grok-remote.split.sidebar';
const SIDEBAR_COLLAPSED_KEY = 'grok-remote.split.sidebar.collapsed';
const SIDEBAR_DEFAULT_SIZES: [number, number] = [22, 78];
const MOBILE_MAX = 720;

function isMobileViewport(): boolean {
  return window.innerWidth <= MOBILE_MAX;
}

function readSidebarSizes(): [number, number] {
  try {
    const raw = localStorage.getItem(SIDEBAR_SIZES_KEY);
    if (!raw) return [...SIDEBAR_DEFAULT_SIZES] as [number, number];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === 2 &&
        parsed.every((n) => typeof n === 'number' && isFinite(n) && n >= 0 && n <= 100)) {
      return parsed as [number, number];
    }
  } catch { /* ignore */ }
  return [...SIDEBAR_DEFAULT_SIZES] as [number, number];
}

function isSidebarCollapsed(): boolean {
  try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'; } catch { return false; }
}

function installToolsToggle(): void {
  const btn = document.getElementById('topbar-sidebar-right') as HTMLElement | null;
  if (!btn) return;
  if (isMobileViewport()) {
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  let collapsed = false;
  function paint(): void {
    btn!.innerHTML = iconHtml(collapsed ? 'panel-right-open' : 'panel-right-close');
    btn!.title = collapsed ? 'show tool calls panel' : 'hide tool calls panel';
    btn!.setAttribute('aria-label', btn!.title);
  }
  paint();
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    document.dispatchEvent(new CustomEvent('grok-remote:tools-toggle'));
  });
  document.addEventListener('grok-remote:tools-state', (ev: Event) => {
    const ce = ev as CustomEvent<{ collapsed?: boolean }>;
    collapsed = !!(ce && ce.detail && ce.detail.collapsed);
    paint();
  });
}

function installOuterSplit(splitHost: HTMLElement, sidebarPane: HTMLElement, mainPane: HTMLElement): void {
  const topbarBtn = document.getElementById('topbar-sidebar-left') as HTMLElement | null;

  if (isMobileViewport()) {
    if (topbarBtn) topbarBtn.hidden = true;
    let wasMobile = true;
    window.addEventListener('resize', () => {
      const nowMobile = isMobileViewport();
      if (wasMobile !== nowMobile) {
        wasMobile = nowMobile;
        location.reload();
      }
    });
    return;
  }

  if (topbarBtn) topbarBtn.hidden = false;

  let collapsed = isSidebarCollapsed();
  let lastExpandedSizes = readSidebarSizes();
  let split: ReturnType<typeof Split> | null = null;

  function persistSizes(sizes: number[]): void {
    try { localStorage.setItem(SIDEBAR_SIZES_KEY, JSON.stringify(sizes)); } catch { /* ignore */ }
    rememberDeskSplit(sizes, collapsed);
  }
  function persistCollapsed(v: boolean): void {
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, v ? '1' : '0'); } catch { /* ignore */ }
    rememberDeskSplit(lastExpandedSizes, v);
  }

  function updateTopbarBtn(): void {
    if (!topbarBtn) return;
    topbarBtn.innerHTML = iconHtml(collapsed ? 'panel-left-open' : 'panel-left-close');
    topbarBtn.title = collapsed ? 'show conversations sidebar' : 'hide conversations sidebar';
    topbarBtn.setAttribute('aria-label', collapsed ? 'show conversations sidebar' : 'hide conversations sidebar');
  }

  function buildSplit(initialSizes: number[]): void {
    split = Split([sidebarPane, mainPane], {
      sizes: initialSizes,
      minSize: [220, 480],
      maxSize: [560, Infinity],
      gutterSize: 6,
      snapOffset: 0,
      expandToMin: true,
      direction: 'horizontal',
      elementStyle: (_dim: string, size: number, gutterSize: number) => ({
        'flex-basis': `calc(${size}% - ${gutterSize}px)`,
      }),
      gutterStyle: (_dim: string, gutterSize: number) => ({ 'flex-basis': `${gutterSize}px` }),
      onDragEnd: (sizes: number[]) => {
        lastExpandedSizes = sizes as [number, number];
        persistSizes(sizes);
      },
    });
  }

  function destroySplit(): void {
    if (split) {
      try { split.destroy(); } catch { /* ignore */ }
      split = null;
    }
  }

  function applyCollapsedState(): void {
    splitHost.classList.toggle('sidebar-collapsed', collapsed);
    if (collapsed) {
      destroySplit();
    } else if (!split) {
      buildSplit(lastExpandedSizes);
    }
    updateTopbarBtn();
  }

  function setCollapsed(next: boolean): void {
    if (collapsed === next) return;
    collapsed = next;
    persistCollapsed(collapsed);
    applyCollapsedState();
  }

  if (collapsed) {
    splitHost.classList.add('sidebar-collapsed');
  } else {
    buildSplit(lastExpandedSizes);
  }
  updateTopbarBtn();

  if (topbarBtn) {
    topbarBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      setCollapsed(!collapsed);
    });
  }
  document.addEventListener('grok-remote:sidebar-toggle', () => setCollapsed(!collapsed));

  let wasMobile = false;
  window.addEventListener('resize', () => {
    const nowMobile = isMobileViewport();
    if (wasMobile !== nowMobile) {
      wasMobile = nowMobile;
      location.reload();
    }
  });
}

interface BgTerminal {
  id: string;
  command?: string;
  cwd?: string;
  url?: string;
  exited?: boolean;
  exitStatus?: { exitCode?: number | null; signal?: string | null };
}
interface BgGroup { agentId: string; agentName?: string; terminals?: BgTerminal[] }
interface BgSnapshot { runningCount?: number; agents?: BgGroup[] }

function installBgTracker(): void {
  const btn   = document.getElementById('topbar-bg') as HTMLElement | null;
  const count = btn ? btn.querySelector<HTMLElement>('.topbar-bg__count') : null;
  if (!btn || !count) return;

  let lastSnapshot: BgSnapshot | null = null;

  async function tick(): Promise<void> {
    if (document.hidden) return;
    try {
      const data = await api.terminals.global() as BgSnapshot;
      lastSnapshot = data;
      const n = (data && data.runningCount) || 0;
      const totalEntries = (data && Array.isArray(data.agents))
        ? data.agents.reduce((a, g) => a + (g.terminals?.length || 0), 0)
        : 0;
      btn!.hidden = totalEntries === 0;
      count!.textContent = `bg: ${n}`;
      btn!.classList.toggle('topbar-bg--active', n > 0);
      btn!.classList.toggle('topbar-bg--exited-only', n === 0 && totalEntries > 0);
    } catch {
      btn!.hidden = true;
    }
  }
  btn.addEventListener('click', () => openBgViewer(() => lastSnapshot));
  void tick();
  setInterval(() => { void tick(); }, 3000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void tick(); });
}

function openBgViewer(getSnapshot: () => BgSnapshot | null): void {
  const overlay = el('div', { class: 'bgglobal-viewer' });
  const closeBtn = el('button', {
    type: 'button', class: 'bgglobal-viewer__close',
    onclick: () => overlay.remove(),
  }, '×');
  const title = el('div', { class: 'bgglobal-viewer__title' }, 'background processes');
  const body  = el('div', { class: 'bgglobal-viewer__body' });
  overlay.appendChild(el('div', { class: 'bgglobal-viewer__head' }, title, closeBtn));
  overlay.appendChild(body);
  document.body.appendChild(overlay);

  async function render(): Promise<void> {
    if (!overlay.isConnected) return;
    let data: BgSnapshot | null = getSnapshot && getSnapshot();
    try { data = await api.terminals.global() as BgSnapshot; } catch { /* keep stale */ }
    body.replaceChildren();
    const groups = (data && Array.isArray(data.agents)) ? data.agents : [];
    if (!groups.length) {
      body.appendChild(el('div', { class: 'bgglobal-viewer__empty' },
        'no background processes are running.'));
      return;
    }
    for (const g of groups) {
      const groupEl = el('div', { class: 'bgglobal-viewer__group' });
      groupEl.appendChild(el('div', { class: 'bgglobal-viewer__group-head' },
        el('span', { class: 'bgglobal-viewer__agent-name' }, g.agentName || g.agentId),
        el('button', {
          type: 'button',
          class: 'bgglobal-viewer__open-conv',
          onclick: () => {
            overlay.remove();
            navigate(`#/agents/${encodeURIComponent(g.agentId)}`);
          },
        }, 'open conversation'),
      ));
      for (const t of (g.terminals || [])) {
        const exited = !!t.exited;
        const code = t.exitStatus && (t.exitStatus.exitCode ?? t.exitStatus.signal);
        const row = el('div', { class: `bgglobal-viewer__term ${exited ? 'bgglobal-viewer__term--exited' : ''}` },
          el('span', { class: 'bgglobal-viewer__term-status' },
            el('span', { class: 'bgglobal-viewer__term-dot' }),
            exited ? `exit ${code ?? '?'}` : 'running'),
          el('div', { class: 'bgglobal-viewer__term-cmd' }, t.command || ''),
          el('div', { class: 'bgglobal-viewer__term-cwd' }, t.cwd || ''),
          el('div', { class: 'bgglobal-viewer__term-actions' },
            (t.url && !exited) && el('a', {
              class: 'bgglobal-viewer__open-url',
              href: t.url,
              target: '_blank',
              rel: 'noopener',
              title: `open ${t.url}`,
              html: `<span class="bgglobal-viewer__open-url-ico">${iconHtml('globe')}</span><span class="bgglobal-viewer__open-url-label">Open App</span>`,
            }),
            el('button', {
              type: 'button', class: 'bgglobal-viewer__open-output',
              onclick: () => {
                overlay.remove();
                navigate(`#/agents/${encodeURIComponent(g.agentId)}`);
              },
            }, 'view in conversation'),
            !exited && el('button', {
              type: 'button', class: 'bgglobal-viewer__kill',
              onclick: (ev: MouseEvent) => {
                const btn = ev.currentTarget as HTMLButtonElement;
                btn.disabled = true;
                btn.textContent = 'killing...';
                row.classList.add('bgglobal-viewer__term--killing');
                void (async () => {
                  try {
                    await api.terminals.kill(g.agentId, t.id);
                    btn.textContent = 'kill sent';
                    const stEl = row.querySelector('.bgglobal-viewer__term-status');
                    if (stEl) {
                      stEl.replaceChildren(
                        el('span', { class: 'bgglobal-viewer__term-dot' }),
                        document.createTextNode('killing'),
                      );
                    }
                  } catch (err) {
                    btn.disabled = false;
                    btn.textContent = 'kill failed; retry';
                    btn.title = err instanceof Error ? err.message : String(err);
                  }
                })();
              },
            }, 'kill'),
          ),
        );
        groupEl.appendChild(row);
      }
      body.appendChild(groupEl);
    }
  }

  void render();
  const timer = setInterval(() => {
    if (!overlay.isConnected) { clearInterval(timer); return; }
    void render();
  }, 1500);
}
