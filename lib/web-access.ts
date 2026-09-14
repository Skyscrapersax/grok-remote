import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

const COOKIE = 'gr_session';
const TTL = 12 * 60 * 60 * 1000;
const loginPage = (failed = false) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open your desk · Grok Remote</title><style>body{margin:0;background:#f3efe6;color:#252720;font:17px system-ui;display:grid;min-height:100dvh;place-items:center}main{width:min(420px,calc(100% - 48px));padding:32px 0}small{letter-spacing:.12em;text-transform:uppercase}h1{font:42px Georgia,serif;margin:24px 0}p{line-height:1.6}label{display:block;margin-bottom:8px}input,button{box-sizing:border-box;width:100%;font:inherit;padding:14px;border:1px solid #777d69;border-radius:5px}button{margin-top:16px;background:#304c37;color:white;cursor:pointer}input:focus-visible,button:focus-visible{outline:3px solid #648766;outline-offset:3px}.error{color:#a02424}code{overflow-wrap:anywhere;font-size:14px}</style><main><small>Grok Remote / Private desk</small><h1>Pick up where<br>you left off.</h1><p>Enter this server's access key to open your conversations and tools.</p>${failed ? '<p class="error" role="alert">Key not recognized. Try again.</p>' : ''}<form method="post" action="/auth/session"><label for="key">Access key</label><input id="key" name="key" type="password" autocomplete="current-password" required maxlength="128" autofocus><button>Open desk</button></form><p>On the server, read <code>~/.grok-remote/access-key</code>. This key controls the desk; keep it private.</p></main></html>`;

export function createWebAccess(port: number, publicOrigin = process.env['GROK_REMOTE_ORIGIN']) {
  const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`]);
  if (publicOrigin) {
    const url = new URL(publicOrigin);
    if (url.protocol !== 'https:' || url.origin !== publicOrigin) throw new Error('GROK_REMOTE_ORIGIN must be an exact HTTPS origin, without a path.');
    origins.add(url.origin);
  }
  const hosts = new Set([...origins].map(origin => new URL(origin).host));
  const root = path.join(os.homedir(), '.grok-remote');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const keyFile = path.join(root, 'access-key');
  try { fs.writeFileSync(keyFile, randomBytes(32).toString('hex') + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  if (!fs.lstatSync(keyFile).isFile() || fs.lstatSync(keyFile).isSymbolicLink()) throw new Error('Access key must be a regular file.');
  fs.chmodSync(keyFile, 0o600);
  const key = fs.readFileSync(keyFile, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid access-key file; preserve it and repair it before starting.');
  const equalKey = (candidate: string) => candidate.length === key.length && timingSafeEqual(Buffer.from(candidate), Buffer.from(key));
  const bearerAuthorized = (req: IncomingMessage) => { const candidate = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]; return !!candidate && equalKey(candidate); };
  const sessions = new Map<string, { expires: number; connections: Set<() => void> }>();
  const tokenFor = (req: IncomingMessage) => (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || '';
  const revoke = (id: string) => { const session = sessions.get(id); sessions.delete(id); session?.connections.forEach(close => close()); };
  const timer = setInterval(() => { for (const [id, session] of sessions) if (session.expires <= Date.now()) revoke(id); }, 30000);
  timer.unref();
  function boundary(req: IncomingMessage, requireOrigin = false): boolean {
    if (!hosts.has(req.headers.host || '')) return false;
    const origin = req.headers.origin;
    if (!origin) return !requireOrigin && req.headers['sec-fetch-site'] !== 'cross-site';
    return origins.has(origin) && new URL(origin).host === req.headers.host;
  }
  function authorized(req: IncomingMessage, close: () => void): boolean {
    if (bearerAuthorized(req)) return true;
    const session = sessions.get(tokenFor(req));
    if (!session || session.expires <= Date.now()) return false;
    session.connections.add(close);
    return true;
  }
  function track(req: IncomingMessage, target: ServerResponse | Duplex): boolean {
    const close = () => target.destroy();
    if (!authorized(req, close)) return false;
    target.once('close', () => sessions.get(tokenFor(req))?.connections.delete(close));
    return true;
  }
  function cookie(req: IncomingMessage, value: string, age: number): string {
    const secure = publicOrigin && new URL(publicOrigin).host === req.headers.host;
    return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;
  }
  function html(res: ServerResponse, status: number, failed = false) {
    const nonce = randomBytes(16).toString('hex');
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'` });
    res.end(loginPage(failed) + `<script nonce="${nonce}">
      const form = document.querySelector('form');
      const button = form.querySelector('button');
      const status = document.createElement('p'); status.setAttribute('role','alert'); form.append(status);
      form.addEventListener('submit', async event => {
        event.preventDefault(); button.disabled = true; status.textContent = 'Opening desk…';
        try {
          const response = await fetch('/auth/session', {method:'POST',headers:{Accept:'application/json'},body:new URLSearchParams(new FormData(form))});
          if (!response.ok) throw new Error(response.status === 401 ? 'Key not recognized. Try again.' : 'Sign-in failed. Check the server address.');
          location.assign('/');
        } catch(error) { status.textContent = error.message; button.disabled = false; }
      });
    </script>`);
  }
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    const url = (req.url || '').split('?')[0];
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method || 'GET');
    if (!boundary(req, mutation && !bearerAuthorized(req))) { res.writeHead(403); res.end('Request origin or host rejected.'); return false; }
    if (url === '/api/health' && req.method === 'GET') return true;
    if (url === '/login' && req.method === 'GET') { html(res, 200); return false; }
    if (url === '/auth/session' && req.method === 'POST') {
      if (!boundary(req, true) || req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') { res.writeHead(403); res.end(); return false; }
      let body = '';
      for await (const chunk of req) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 4096) { res.writeHead(413); res.end(); return false; }
      }
      const candidate = new URLSearchParams(body).get('key') || '';
      if (!/^[a-f0-9]{64}$/.test(candidate) || !equalKey(candidate)) { html(res, 401, true); return false; }
      if (sessions.size >= 100) revoke(sessions.keys().next().value!);
      const token = randomBytes(32).toString('hex');
      sessions.set(token, { expires: Date.now() + TTL, connections: new Set() });
      if (req.headers.accept === 'application/json') { res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': cookie(req, token, TTL / 1000) }); res.end('{"ok":true}'); return false; }
      res.writeHead(303, { Location: '/', 'Set-Cookie': cookie(req, token, TTL / 1000) }); res.end(); return false;
    }
    if (url === '/auth/logout' && req.method === 'POST') {
      if (!authorized(req, () => {})) { res.writeHead(401); res.end(); return false; }
      revoke(tokenFor(req));
      res.writeHead(303, { Location: '/login', 'Set-Cookie': cookie(req, '', 0) }); res.end(); return false;
    }
    if (track(req, res)) return true;
    if (url?.startsWith('/api/')) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"error":"Sign in to this desk."}'); }
    else { res.writeHead(303, { Location: '/login' }); res.end(); }
    return false;
  }
  return {
    handle,
    upgrade(req: IncomingMessage, socket: Duplex): boolean {
      if (boundary(req, !bearerAuthorized(req)) && track(req, socket)) return true;
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return false;
    },
    close() { clearInterval(timer); for (const id of sessions.keys()) revoke(id); },
  };
}
