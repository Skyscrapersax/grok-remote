import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: () => null,
  length: 0,
};
let hash = '';
(globalThis as any).location = {
  get hash() { return hash; },
  set hash(v: string) { hash = v; },
};
(globalThis as any).fetch = async () => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ ok: true, desk: {} }),
});

const mod = await import('../src/lib/desk-furniture.js');

test('save/load', () => {
  store.clear();
  mod.saveDeskFurniture({ lastHash: '#/dash' });
  assert.equal(mod.loadDeskFurniture().lastHash, '#/dash');
  assert.equal(mod.loadDeskFurniture().version, 1);
});

test('hash restore', () => {
  store.clear();
  hash = '';
  mod.saveDeskFurniture({ lastHash: '#/chats' });
  assert.equal(mod.restoreDeskHashIfEmpty(), '#/chats');
  assert.equal(hash, '#/chats');
});

test('theme + agent + term tabs', () => {
  store.clear();
  mod.rememberDeskTheme('atelier');
  mod.rememberLastAgent('a1');
  mod.rememberTermTabs([{ kind: 'shell', cwd: '/tmp' }]);
  assert.equal(mod.getDeskTheme(), 'atelier');
  assert.equal(mod.getLastAgentId(), 'a1');
  assert.equal(mod.loadDeskFurniture().termTabs?.[0]?.kind, 'shell');
});

test('rail more', () => {
  store.clear();
  mod.rememberRailSystemOpen(true);
  assert.equal(mod.isRailSystemOpen(), true);
});
