import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: () => null,
  length: 0,
};

let hash = '';
(globalThis as unknown as { location: { hash: string } }).location = {
  get hash() { return hash; },
  set hash(v: string) { hash = v; },
};

// Silence server pushes in unit tests
(globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ ok: true, desk: {} }),
  json: async () => ({ ok: true, desk: {} }),
})) as unknown as typeof fetch;

const {
  loadDeskFurniture,
  saveDeskFurniture,
  rememberDeskHash,
  restoreDeskHashIfEmpty,
  rememberRailSystemOpen,
  isRailSystemOpen,
  rememberDeskTheme,
  getDeskTheme,
  rememberLastAgent,
  getLastAgentId,
  rememberChatTab,
  getChatTab,
  rememberToolsCollapsed,
  getToolsCollapsed,
  rememberTermTabs,
  getTermTabs,
  rememberDashCollapsed,
  getDashCollapsed,
  rememberDashGroupMode,
  getDashGroupMode,
  rememberDashSearch,
  getDashSearch,
  rememberTermLastKind,
  getTermLastKind,
} = await import('../src/lib/desk-furniture.js');

test('save/load desk furniture', () => {
  store.clear();
  saveDeskFurniture({ lastHash: '#/dash' });
  const d = loadDeskFurniture();
  assert.equal(d.lastHash, '#/dash');
  assert.equal(d.version, 1);
  assert.ok(typeof d.updatedAt === 'number');
});

test('rememberDeskHash ignores empty', () => {
  store.clear();
  rememberDeskHash('#/');
  assert.equal(loadDeskFurniture().lastHash, undefined);
  rememberDeskHash('#/term');
  assert.equal(loadDeskFurniture().lastHash, '#/term');
});

test('restoreDeskHashIfEmpty applies last hash when empty', () => {
  store.clear();
  hash = '';
  saveDeskFurniture({ lastHash: '#/chats' });
  const applied = restoreDeskHashIfEmpty();
  assert.equal(applied, '#/chats');
  assert.equal(hash, '#/chats');
});

test('restoreDeskHashIfEmpty is no-op when already on a route', () => {
  store.clear();
  hash = '#/dash';
  saveDeskFurniture({ lastHash: '#/term' });
  assert.equal(restoreDeskHashIfEmpty(), null);
  assert.equal(hash, '#/dash');
});

test('rail system open dual-writes legacy key', () => {
  store.clear();
  rememberRailSystemOpen(true);
  assert.equal(isRailSystemOpen(), true);
  assert.equal(store.get('grok-remote.rail.system'), '1');
  rememberRailSystemOpen(false);
  assert.equal(isRailSystemOpen(), false);
});

test('theme dual-writes desk and legacy theme key', () => {
  store.clear();
  rememberDeskTheme('atelier');
  assert.equal(getDeskTheme(), 'atelier');
  assert.equal(store.get('grok-remote.theme'), 'atelier');
  assert.equal(loadDeskFurniture().theme, 'atelier');
});

test('last agent + term tabs persist', () => {
  store.clear();
  rememberLastAgent('abc');
  rememberTermTabs([{ kind: 'shell', cwd: '/tmp' }]);
  const d = loadDeskFurniture();
  assert.equal(d.lastAgentId, 'abc');
  assert.equal(getLastAgentId(), 'abc');
  assert.equal(d.termTabs?.[0]?.kind, 'shell');
});

test('chatTab + toolsCollapsed persist (B4 chrome)', () => {
  store.clear();
  rememberChatTab('files');
  rememberToolsCollapsed(true);
  assert.equal(getChatTab(), 'files');
  assert.equal(getToolsCollapsed(), true);
  assert.equal(loadDeskFurniture().chatTab, 'files');
  assert.equal(loadDeskFurniture().toolsCollapsed, true);
  assert.equal(store.get('grok-remote.split.chat.collapsed'), '1');
  rememberChatTab('not-a-tab'); // ignored
  assert.equal(getChatTab(), 'files');
  rememberToolsCollapsed(false);
  assert.equal(getToolsCollapsed(), false);
  rememberChatTab('info');
  assert.equal(getChatTab(), 'info');
});

test('dash collapsed / group / search persist in desk.json', () => {
  store.clear();
  rememberDashCollapsed(['archived', 'disconnected']);
  rememberDashGroupMode('cwd');
  rememberDashSearch('alpha');
  assert.deepEqual(getDashCollapsed(), ['archived', 'disconnected']);
  assert.equal(getDashGroupMode(), 'cwd');
  assert.equal(getDashSearch(), 'alpha');
  // legacy dual-write
  assert.ok(store.get('grok-remote.dash.collapsed')?.includes('archived'));
  assert.equal(store.get('grok-remote.dash.group'), 'cwd');
  const d = loadDeskFurniture();
  assert.deepEqual(d.dash?.collapsed, ['archived', 'disconnected']);
  assert.equal(d.dash?.groupMode, 'cwd');
});

test('term lastKind persists', () => {
  store.clear();
  rememberTermLastKind('shell');
  assert.equal(getTermLastKind(), 'shell');
  assert.equal(loadDeskFurniture().termLastKind, 'shell');
});

test('hydrate from legacy keys when desk.json empty', () => {
  store.clear();
  store.set('grok-remote.theme', 'carbon');
  store.set('grok-remote.dash.group', 'cwd');
  store.set('grok-remote.dash.collapsed', JSON.stringify(['idle']));
  const d = loadDeskFurniture();
  assert.equal(d.theme, 'carbon');
  assert.equal(d.dash?.groupMode, 'cwd');
  assert.deepEqual(d.dash?.collapsed, ['idle']);
});

test('termTabs dual-write local + getTermTabs', () => {
  store.clear();
  rememberTermTabs([
    { kind: 'shell', cwd: '/tmp/a', name: 'shell' },
    { kind: 'grok', cwd: '/tmp/b', name: 'grok' },
  ]);
  rememberTermLastKind('grok');
  const tabs = getTermTabs();
  assert.equal(tabs.length, 2);
  assert.equal(tabs[0]?.kind, 'shell');
  assert.equal(tabs[1]?.cwd, '/tmp/b');
  assert.equal(getTermLastKind(), 'grok');
  const raw = store.get('grok-remote.term.tabs');
  assert.ok(raw && raw.includes('shell'));
  assert.equal(loadDeskFurniture().termLastKind, 'grok');
});
