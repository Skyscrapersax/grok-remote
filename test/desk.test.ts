import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate desk.json under a temp HOME before importing the module.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-desk-'));
const ORIGINAL_HOME = process.env['HOME'];
process.env['HOME'] = tmpHome;

const { load, save, paths, loadDeskState, saveDeskState, deskPaths } = await import('../lib/desk.ts');

test('desk load returns version 1 defaults when missing', () => {
  const d = load();
  assert.equal(d.version, 1);
  assert.equal(d.theme, 'atelier');
});

test('desk save/load lastHash, rail, theme', () => {
  const saved = save({ lastHash: '#/dash', railSystemOpen: true, theme: 'atelier' });
  assert.equal(saved.lastHash, '#/dash');
  assert.equal(saved.railSystemOpen, true);
  assert.equal(saved.theme, 'atelier');
  assert.ok(typeof saved.updatedAt === 'number');

  const loaded = load();
  assert.equal(loaded.lastHash, '#/dash');
  assert.equal(loaded.railSystemOpen, true);
});

test('desk split nested merge', () => {
  save({ split: { sizes: [25, 75], collapsed: false } });
  const d = load();
  assert.deepEqual(d.split?.sizes, [25, 75]);
  assert.equal(d.split?.collapsed, false);
});

test('desk termTabs and lastAgentId', () => {
  save({
    lastAgentId: 'agent-1',
    termTabs: [{ kind: 'shell', name: 'sh', cwd: '/tmp' }],
  });
  const d = load();
  assert.equal(d.lastAgentId, 'agent-1');
  assert.equal(d.termTabs?.[0]?.kind, 'shell');
});

test('desk dash chrome and termLastKind persist', () => {
  save({
    termLastKind: 'grok',
    dash: { collapsed: ['archived'], groupMode: 'cwd', search: 'alpha' },
  });
  const d = load();
  assert.equal(d.termLastKind, 'grok');
  assert.deepEqual(d.dash?.collapsed, ['archived']);
  assert.equal(d.dash?.groupMode, 'cwd');
  assert.equal(d.dash?.search, 'alpha');
});

test('desk unwraps wrapped { desk: ... } body', () => {
  save({ desk: { lastHash: '#/term', theme: 'atelier' } } as Record<string, unknown>);
  const d = load();
  assert.equal(d.lastHash, '#/term');
});

test('desk paths under isolated HOME', () => {
  const p = paths();
  assert.ok(p.file.includes(tmpHome) || p.file.includes('.grok-remote'));
  assert.ok(p.file.endsWith('desk.json'));
  // aliases
  assert.equal(typeof loadDeskState, 'function');
  assert.equal(typeof saveDeskState, 'function');
  assert.equal(typeof deskPaths, 'function');
});

// restore HOME for other suites in the same process
test('cleanup HOME env', () => {
  if (ORIGINAL_HOME == null) delete process.env['HOME'];
  else process.env['HOME'] = ORIGINAL_HOME;
  assert.ok(true);
});
