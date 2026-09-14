// Browser ↔ Grok Remote ↔ xAI Realtime Voice proxy.
// Client connects to ws(s)://host/api/voice/ws?agentId=...
// Server opens wss://api.x.ai/v1/realtime and bridges JSON events.
// Function tools are executed against AgentManager; results go back to xAI.

import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import type { AgentManager } from './agent-manager.js';
import { resolveVoiceAuth } from './voice-auth.js';
import { VOICE_TOOLS, voiceSystemInstructions, runVoiceTool } from './voice-tools.js';

const XAI_REALTIME = 'wss://api.x.ai/v1/realtime';
const DEFAULT_MODEL = process.env['GROK_VOICE_MODEL'] || 'grok-voice-latest';
const DEFAULT_VOICE = process.env['GROK_VOICE_ID'] || 'eve';

function parseQuery(url: string): URLSearchParams {
  try {
    return new URL(url, 'http://localhost').searchParams;
  } catch {
    return new URLSearchParams();
  }
}

function safeJsonParse(data: WebSocket.RawData): unknown {
  try {
    const s = typeof data === 'string' ? data : data.toString('utf8');
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export function attachVoiceProxy(server: HttpServer, manager: AgentManager, authorize: (req: IncomingMessage, socket: Duplex) => boolean): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = req.url || '';
    const pathOnly = url.split('?')[0] || '';
    if (pathOnly !== '/api/voice/ws') {
      // Leave other upgrades alone (none today).
      return;
    }
    if (!authorize(req, socket)) return;
    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit('connection', client, req);
    });
  });

  wss.on('connection', (client: WebSocket, req: IncomingMessage) => {
    void handleClient(client, req, manager);
  });

  console.log('[grok-remote] voice proxy attached at /api/voice/ws');
}

async function handleClient(
  client: WebSocket,
  req: IncomingMessage,
  manager: AgentManager,
): Promise<void> {
  const q = parseQuery(req.url || '');
  let focusedAgentId = q.get('agentId') || q.get('agent_id') || null;
  const voiceName = q.get('voice') || DEFAULT_VOICE;
  const model = q.get('model') || DEFAULT_MODEL;

  const auth = resolveVoiceAuth();
  if (!auth) {
    client.send(JSON.stringify({
      type: 'grok_remote.error',
      error: 'voice_auth_missing',
      message: 'No voice credentials. Set XAI_API_KEY or run `grok login`.',
    }));
    client.close(4001, 'voice_auth_missing');
    return;
  }

  const xaiUrl = `${XAI_REALTIME}?model=${encodeURIComponent(model)}`;
  let xai: WebSocket;
  try {
    xai = new WebSocket(xaiUrl, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
  } catch (err) {
    client.send(JSON.stringify({
      type: 'grok_remote.error',
      error: 'xai_connect_failed',
      message: err instanceof Error ? err.message : String(err),
    }));
    client.close(1011, 'xai_connect_failed');
    return;
  }

  const pendingToolCalls = new Map<string, { name: string; call_id: string }>();
  let closed = false;

  const closeBoth = (code = 1000, reason = 'done') => {
    if (closed) return;
    closed = true;
    try { client.close(code, reason); } catch { /* ignore */ }
    try { xai.close(code, reason); } catch { /* ignore */ }
  };

  client.send(JSON.stringify({
    type: 'grok_remote.ready',
    authSource: auth.source,
    model,
    voice: voiceName,
    focusedAgentId,
  }));

  xai.on('open', () => {
    const sessionUpdate = {
      type: 'session.update',
      session: {
        voice: voiceName,
        instructions: voiceSystemInstructions(focusedAgentId),
        turn_detection: { type: 'server_vad', threshold: 0.85, silence_duration_ms: 700 },
        tools: VOICE_TOOLS,
        audio: {
          input: { format: { type: 'audio/pcm', rate: 24000 } },
          output: { format: { type: 'audio/pcm', rate: 24000 } },
        },
      },
    };
    xai.send(JSON.stringify(sessionUpdate));
    client.send(JSON.stringify({ type: 'grok_remote.xai_open', model, voice: voiceName }));
  });

  xai.on('message', (data) => {
    // Forward almost everything to the browser for playback/transcripts.
    // Intercept completed function calls to run tools server-side.
    const event = safeJsonParse(data) as Record<string, unknown> | null;
    if (!event || typeof event !== 'object') {
      if (client.readyState === WebSocket.OPEN) client.send(data.toString());
      return;
    }

    const type = String(event['type'] || '');

    // Track partial function call names if needed
    if (type === 'response.function_call_arguments.done') {
      const name = String(event['name'] || '');
      const callId = String(event['call_id'] || '');
      const argsRaw = String(event['arguments'] || '{}');
      void (async () => {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(argsRaw) as Record<string, unknown>; } catch { /* empty */ }
        client.send(JSON.stringify({
          type: 'grok_remote.tool',
          name,
          call_id: callId,
          arguments: args,
          status: 'running',
        }));
        let output: unknown;
        try {
          output = await runVoiceTool(manager, name, args, focusedAgentId);
          // If new agent focused preference, keep focused in sync when user spawned
          if (name === 'new_agent' && output && typeof output === 'object') {
            const agent = (output as { agent?: { id?: string } }).agent;
            if (agent?.id) focusedAgentId = agent.id;
          }
          client.send(JSON.stringify({
            type: 'grok_remote.tool',
            name,
            call_id: callId,
            status: 'done',
            result: output,
          }));
        } catch (err) {
          output = { ok: false, error: err instanceof Error ? err.message : String(err) };
          client.send(JSON.stringify({
            type: 'grok_remote.tool',
            name,
            call_id: callId,
            status: 'error',
            result: output,
          }));
        }
        if (xai.readyState === WebSocket.OPEN) {
          xai.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'function_call_output',
              call_id: callId,
              output: JSON.stringify(output),
            },
          }));
          // Client should wait for audio playback; we still request continuation.
          // Browser can send grok_remote.response_create when playback finishes.
          xai.send(JSON.stringify({ type: 'response.create' }));
        }
      })();
      // Still forward the raw event for debugging
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(event));
      return;
    }

    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(event));
    }
  });

  xai.on('error', (err) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'grok_remote.error',
        error: 'xai_error',
        message: err instanceof Error ? err.message : String(err),
      }));
    }
  });

  xai.on('close', (code, reason) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'grok_remote.xai_close',
        code,
        reason: reason?.toString() || '',
      }));
      try { client.close(1000, 'xai_closed'); } catch { /* ignore */ }
    }
    closed = true;
  });

  client.on('message', (data, isBinary) => {
    if (xai.readyState !== WebSocket.OPEN) return;

    // Binary frames: raw PCM from browser → forward as binary to xAI if desired.
    // We use JSON base64 path from the browser for simplicity.
    if (isBinary) {
      xai.send(data as Buffer);
      return;
    }

    const event = safeJsonParse(data) as Record<string, unknown> | null;
    if (!event || typeof event !== 'object') {
      xai.send(data.toString());
      return;
    }

    const type = String(event['type'] || '');

    // Control messages from our client (not xAI protocol)
    if (type.startsWith('grok_remote.')) {
      if (type === 'grok_remote.set_focus') {
        focusedAgentId = typeof event['agentId'] === 'string' ? event['agentId'] : focusedAgentId;
        // Refresh instructions with new focus
        xai.send(JSON.stringify({
          type: 'session.update',
          session: { instructions: voiceSystemInstructions(focusedAgentId) },
        }));
        client.send(JSON.stringify({ type: 'grok_remote.focus', focusedAgentId }));
        return;
      }
      if (type === 'grok_remote.response_create') {
        xai.send(JSON.stringify({ type: 'response.create' }));
        return;
      }
      if (type === 'grok_remote.stop') {
        closeBoth(1000, 'client_stop');
        return;
      }
      return;
    }

    // Forward client → xAI events (audio append, session updates, etc.)
    xai.send(JSON.stringify(event));
  });

  client.on('close', () => closeBoth(1000, 'client_closed'));
  client.on('error', () => closeBoth(1011, 'client_error'));

  // Silence unused map warning for now (reserved for parallel tool batching)
  void pendingToolCalls;
}
