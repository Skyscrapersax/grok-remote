import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'test/fixtures/private-desk-agent.mjs');
async function waitFor(read, predicate, message) {
  for (let i = 0; i < 120; i++) { const value = await read(); if (predicate(value)) return value; await delay(50); }
  throw new Error(message);
}

test('compiled private desk: auth, socket boundary, approvals, cancellation, restart and session history', { timeout: 45000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'private-desk-'));
  const work = path.join(home, 'work'); fs.mkdirSync(work);
  const reservation = net.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let proc, output = '', cookie = '';
  const env = { PATH: process.env.PATH, HOME: home, TMPDIR: os.tmpdir(), PORT: String(port), HOST: '127.0.0.1', GROK_BIN: fixture, GROK_REMOTE_ORIGIN: 'https://desk.example' };
  async function start() {
    proc = spawn(process.execPath, [path.join(root, 'build/server.js')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', b => { output += b; }); proc.stderr.on('data', b => { output += b; });
    await waitFor(() => fetch(base + '/api/health').then(r => r.status).catch(() => 0), s => s === 200, 'Server boot failed: ' + output);
  }
  async function stop() {
    if (!proc || proc.exitCode !== null) return;
    const done = once(proc, 'exit'); proc.kill('SIGTERM');
    const timeout = setTimeout(() => proc.kill('SIGKILL'), 3000);
    await done; clearTimeout(timeout);
  }
  const request = (url, method = 'GET', body, headers = {}) => fetch(base + url, { method, redirect: 'manual', headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method === 'GET' ? {} : { Origin: base, 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = async url => { const response = await request(url); assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
  const login = async () => {
    const key = fs.readFileSync(path.join(home, '.grok-remote/access-key'), 'utf8').trim();
    const response = await fetch(base + '/auth/session', { method: 'POST', redirect: 'manual', headers: { Origin: base, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ key }) });
    assert.equal(response.status, 303); const header = response.headers.get('set-cookie');
    assert.match(header, /HttpOnly/); assert.match(header, /SameSite=Strict/); cookie = header.split(';')[0];
    assert.equal(fs.statSync(path.join(home, '.grok-remote/access-key')).mode & 0o777, 0o600);
    return key;
  };
  const websocket = (url, headers) => new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace('http', 'ws') + url, { headers, handshakeTimeout: 3000 });
    ws.once('open', () => { resolve({ status: 101, ws }); });
    ws.once('unexpected-response', (_req, res) => { res.resume(); ws.terminate(); resolve({ status: res.statusCode }); });
    ws.on('error', reject);
  });
  try {
    await start();
    for (const url of ['/api/agents', '/api/settings', '/api/system/config', '/api/permissions', '/api/agents/stream']) assert.equal((await request(url)).status, 401, url);
    assert.equal((await request('/')).status, 303);
    const forgedHostStatus = await new Promise((resolve, reject) => {
      const req = httpRequest(base + '/api/health', { headers: { Host: 'attacker.example' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(forgedHostStatus, 403);
    for (const url of ['/api/term/ws', '/api/voice/ws']) assert.equal((await websocket(url, { Origin: base })).status, 401);
    const key = await login();
    const rejectedLogin = await fetch(base + '/auth/session', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'key=wrong' });
    assert.equal(rejectedLogin.status, 401);
    const secureCookie = await new Promise((resolve, reject) => {
      const req = httpRequest(base + '/auth/session', { method: 'POST', headers: { Host: 'desk.example', Origin: 'https://desk.example', 'Content-Type': 'application/x-www-form-urlencoded' } }, res => { res.resume(); resolve(res.headers['set-cookie']?.[0]); });
      req.on('error', reject); req.end(new URLSearchParams({ key }).toString());
    });
    assert.match(secureCookie, /; Secure/);
    assert.ok((await (await request('/')).text()).includes('<title>Grok Deck</title>'), 'Compiled server must serve the existing desk shell.');
    assert.equal((await request('/api/agents', 'GET', undefined, { Origin: 'https://attacker.example' })).status, 403);
    assert.equal((await fetch(base + '/api/settings', { method: 'PATCH', headers: { Cookie: cookie, Authorization: 'Bearer wrong', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    const authorizedSocket = await websocket('/api/term/ws?id=missing', { Origin: base, Cookie: cookie }); assert.equal(authorizedSocket.status, 101); authorizedSocket.ws.close();
    assert.equal((await websocket('/api/term/ws', { Origin: 'https://attacker.example', Cookie: cookie })).status, 401);
    let response = await request('/api/agents', 'POST', { name: 'Acceptance fixture', cwd: work, settings: { alwaysApprove: true } });
    assert.equal(response.status, 201); const created = await response.json();
    const id = (created.agent || created).id; assert.ok(id);
    let agent = await waitFor(() => json(`/api/agents/${id}`), a => a.sessionId && a.status === 'idle', 'Agent handshake failed');
    const session = agent.sessionId;
    async function pending() { return waitFor(() => json('/api/permissions'), data => data.requests.length === 1, 'Permission not surfaced'); }
    response = await request(`/api/agents/${id}/prompt`, 'POST', { text: 'permission please' }); assert.equal(response.status, 202);
    let approval = (await pending()).requests[0];
    assert.equal(approval.options.some(o => o.kind === 'allow_always'), false);
    assert.equal((await request(`/api/permissions/${id}/${approval.id}`, 'POST', { optionId: 'forever' })).status, 409);
    assert.equal((await request(`/api/permissions/${id}/${approval.id}`, 'POST', { optionId: null })).status, 200);
    await waitFor(() => json(`/api/agents/${id}`), a => a.status === 'idle', 'Denial did not finish');
    assert.equal(fs.existsSync(path.join(work, 'proof.txt')), false);
    await request(`/api/agents/${id}/prompt`, 'POST', { text: 'permission please' }); approval = (await pending()).requests[0];
    // A newly connected browser sees the current pending queue, not just past events.
    const controller = new AbortController();
    const stream = await fetch(base + '/api/permissions/stream', { headers: { Cookie: cookie }, signal: controller.signal });
    const first = await stream.body.getReader().read(); assert.match(Buffer.from(first.value).toString(), new RegExp(approval.id)); controller.abort();
    assert.equal((await request(`/api/permissions/${id}/${approval.id}`, 'POST', { optionId: 'once' })).status, 200);
    assert.equal((await request(`/api/permissions/${id}/${approval.id}`, 'POST', { optionId: 'once' })).status, 409);
    await waitFor(() => Promise.resolve(fs.existsSync(path.join(work, 'proof.txt'))), Boolean, 'Approved file missing');
    assert.equal(fs.readFileSync(path.join(work, 'proof.txt'), 'utf8'), 'approved once');
    await waitFor(() => json(`/api/agents/${id}`), a => a.status === 'idle', 'Approval did not finish');
    await request(`/api/agents/${id}/prompt`, 'POST', { text: 'permission please' }); await pending();
    await request(`/api/agents/${id}/disconnect`, 'POST', {});
    await waitFor(() => json('/api/permissions'), data => data.requests.length === 0, 'Disconnect retained approval');
    await stop(); await start();
    assert.equal((await request('/api/agents')).status, 401, 'Restart must invalidate browser sessions');
    assert.equal(await login(), key, 'Access key survives restart');
    agent = await json(`/api/agents/${id}`); assert.equal(agent.status, 'disconnected'); assert.equal(agent.lastSessionId, session);
    await request(`/api/agents/${id}/connect`, 'POST', {});
    await waitFor(() => json(`/api/agents/${id}`), a => a.status === 'idle' && a.sessionId === session, 'Session did not resume');
    const history = await (await request(`/api/agents/${id}/history`)).text(); assert.match(history, /permission_resolved/); assert.match(history, /Fixture: request denied/);
    const calls = fs.readFileSync(path.join(home, 'fixture-calls.ndjson'), 'utf8'); assert.match(calls, /session\/load/); assert.doesNotMatch(calls, /--always-approve/);
    const activeEvents = await fetch(base + '/api/permissions/stream', { headers: { Cookie: cookie } });
    const reader = activeEvents.body.getReader(); await reader.read();
    const streamClosed = reader.read().then(result => result.done).catch(() => true);
    assert.equal((await request('/auth/logout', 'POST', {})).status, 303);
    let closeTimer;
    try { assert.equal(await Promise.race([streamClosed, new Promise(resolve => { closeTimer = setTimeout(() => resolve(false), 2000); })]), true, 'Logout must close active event streams'); }
    finally { clearTimeout(closeTimer); }
    assert.equal((await request('/api/agents')).status, 401);
    assert.equal((await fetch(base + '/api/agents', { headers: { Authorization: `Bearer ${key}` } })).status, 200);
    assert.doesNotMatch(output, /uncaught|unhandled|EPIPE/i);
    console.log('PASS: compiled server, private access, HTTP/SSE/WebSocket guards, reject/approve once, replay refusal, disconnect cancellation, restart/resume and durable history; deterministic fixture only.');
  } finally { await stop(); fs.rmSync(home, { recursive: true, force: true }); }
});
