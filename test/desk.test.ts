import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate desk.json under a temp HOME before importing the module.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-desk-'));
const ORIGINAL_HOME = process.env['HOME'];
process.env['HOME'] = tmpHome;

const desk = await import('../lib/desk.ts');

test('desk load returns version 1 defaults when missing', () => {
  const d = desk.load();
  assert.equal(d.version, 1);
  assert.equal(d.theme, 'atelier');
});

test('desk save/load lastHash, rail, theme', () => {
  const saved = desk.save({ lastHash: '#/dash', railSystemOpen: true, theme: 'atelier' });
  assert.equal(saved.lastHash, '#/dash');
  assert.equal(saved.railSystemOpen, true);
  assert.equal(saved.theme, 'atelier');
  assert.ok(typeof saved.updatedAt === 'number');

  const loaded = desk.load();
  assert.equal(loaded.lastHash, '#/dash');
  assert.equal(loaded.railSystemOpen, true);
});

test('desk split nested merge', () => {
  desk.save({ split: { sizes: [25, 75], collapsed: false } });
  const d = desk.load();
  assert.deepEqual(d.split?.sizes, [25, 75]);
  assert.equal(d.split?.collapsed, false);
});

test('desk dash + termTabs + lastAgentId', () => {
  desk.save({
    lastAgentId: 'agent-1',
    termTabs: [{ kind: 'shell', name: 'sh', cwd: '/tmp' }],
    dash: { collapsed: ['idle'], groupMode: 'cwd', search: 'alpha' },
    termLastKind: 'shell',
  });
  const d = desk.load();
  assert.equal(d.lastAgentId, 'agent-1');
  assert.equal(d.termTabs?.[0]?.kind, 'shell');
  assert.equal(d.dash?.groupMode, 'cwd');
  assert.equal(d.termLastKind, 'shell');
});

test('invalid lastHash does not clobber existing', () => {
  desk.save({ lastHash: '#/term' });
  desk.save({ lastHash: '#/' as string });
  assert.equal(desk.load().lastHash, '#/term');
});

test('desk paths under isolated HOME', () => {
  const p = desk.paths();
  assert.ok(p.file.includes('.grok-remote'));
  assert.ok(p.file.endsWith('desk.json'));
});

test('cleanup HOME env', () => {
  if (ORIGINAL_HOME == null) delete process.env['HOME'];
  else process.env['HOME'] = ORIGINAL_HOME;
  assert.ok(true);
});
