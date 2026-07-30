// WebSocket bridge for PTY sessions: /api/term/ws?id=<termId>

import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import type { TermHost } from './term-host.js';

export function attachTermProxy(server: HttpServer, host: TermHost): void {
  const wss = new WebSocketServer({ noServer: true });

  // Chain with existing upgrade handlers (voice uses the same event).
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = req.url || '';
    const pathOnly = url.split('?')[0] || '';
    if (pathOnly !== '/api/term/ws') return;
    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit('connection', client, req);
    });
  });

  wss.on('connection', (client: WebSocket, req: IncomingMessage) => {
    let id = '';
    try {
      id = new URL(req.url || '', 'http://localhost').searchParams.get('id') || '';
    } catch {
      id = '';
    }
    if (!id || !host.get(id)) {
      client.send(JSON.stringify({ type: 'error', message: 'unknown terminal id' }));
      client.close(4004, 'unknown_term');
      return;
    }

    // Send scrollback snapshot first
    const snap = host.snapshot(id);
    if (snap) {
      client.send(JSON.stringify({ type: 'snapshot', data: snap }));
    }
    client.send(JSON.stringify({ type: 'ready', term: host.get(id) }));

    const unsub = host.subscribe(id, {
      onData: (data) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'data', data }));
        }
      },
      onExit: (info) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'exit', ...info }));
          client.close(1000, 'exited');
        }
      },
    });

    client.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch {
        // treat as raw input
        host.write(id, String(raw));
        return;
      }
      const type = String(msg['type'] || '');
      if (type === 'input' && typeof msg['data'] === 'string') {
        host.write(id, msg['data']);
      } else if (type === 'resize') {
        const cols = Number(msg['cols'] || 0);
        const rows = Number(msg['rows'] || 0);
        if (cols && rows) host.resize(id, cols, rows);
      } else if (type === 'ping') {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'pong' }));
        }
      }
    });

    client.on('close', () => unsub());
    client.on('error', () => unsub());
  });

  console.log('[grok-remote] term proxy attached at /api/term/ws');
}
