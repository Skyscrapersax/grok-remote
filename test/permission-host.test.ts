import test from 'node:test';
import assert from 'node:assert/strict';

import { createPermissionHost } from '../lib/permission-host.js';

test('permissions require one offered choice; replay and persistent approval are rejected', async () => {
  const host = createPermissionHost();
  const outcome = host.requestPermission({ toolCall: { title: 'Write file', rawInput: { path: '/tmp/example' } }, options: [
    { optionId: 'one', name: 'Once', kind: 'allow_once' },
    { optionId: 'forever', kind: 'allow_always' },
  ] });
  const request = host.list()[0]!;
  assert.equal(request.options.length, 1);
  assert.equal(host.decide(request.id, 'forever'), false);
  assert.equal(host.decide(request.id, 'one'), true);
  assert.equal(host.decide(request.id, 'one'), false);
  assert.deepEqual(await outcome, { outcome: { outcome: 'selected', optionId: 'one' } });
  assert.deepEqual(host.list(), []);
  assert.deepEqual(await host.requestPermission({ options: [{ optionId: 'same', kind: 'allow_always' }, { optionId: 'same', kind: 'allow_once' }] }), { outcome: { outcome: 'cancelled' } });
  assert.deepEqual(await host.requestPermission({ options: [{ optionId: 'one', kind: 'allow_once' }], toolCall: { rawInput: 'x'.repeat(16001) } }), { outcome: { outcome: 'cancelled' } });
});

test('createPermissionHost tolerates undefined params', async () => {
  const host = createPermissionHost();
  const out = await host.requestPermission();
  assert.equal(out.outcome.outcome, 'cancelled');
});

test('disconnect cancels pending work and returned snapshots cannot change decisions', async () => {
  const host = createPermissionHost();
  const outcome = host.requestPermission({ options: [{ optionId: 'one', kind: 'allow_once' }] });
  const snapshot = host.list()[0]!;
  snapshot.options[0]!.optionId = 'forged';
  assert.equal(host.decide(snapshot.id, 'forged'), false);
  host.cancelAll();
  assert.deepEqual(await outcome, { outcome: { outcome: 'cancelled' } });
});

test('a late click cannot approve an expired request', async t => {
  const host = createPermissionHost();
  const outcome = host.requestPermission({ options: [{ optionId: 'one', kind: 'allow_once' }] });
  const request = host.list()[0]!;
  t.mock.method(Date, 'now', () => request.expiresAt + 1);
  host.decide(request.id, 'one');
  assert.deepEqual(await outcome, { outcome: { outcome: 'cancelled' } });
});
