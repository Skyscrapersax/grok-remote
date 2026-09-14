#!/usr/bin/env node
// Deterministic ACP fixture. No model, network, credentials or external runtime.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';

const log = path.join(os.homedir(), 'fixture-calls.ndjson');
fs.appendFileSync(log, JSON.stringify({ argv: process.argv.slice(2) }) + '\n');
const pending = new Map();
let sessionId;
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
const reply = (id, result) => send({ id, result });
function finish(id, text) {
  send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } });
  reply(id, { stopReason: 'end_turn' });
}
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.method) fs.appendFileSync(log, JSON.stringify({ method: message.method, sessionId: message.params?.sessionId }) + '\n');
  if (pending.has(message.id)) {
    const prompt = pending.get(message.id); pending.delete(message.id);
    const allow = message.result?.outcome?.outcome === 'selected' && message.result?.outcome?.optionId === 'once';
    if (allow) fs.writeFileSync(path.join(process.cwd(), 'proof.txt'), 'approved once');
    finish(prompt, allow ? 'Fixture: approved once.' : 'Fixture: request denied.');
    return;
  }
  switch (message.method) {
    case 'initialize': reply(message.id, { protocolVersion: 1, agentCapabilities: { loadSession: true }, _meta: { modelState: { currentModelId: 'deterministic-fixture' } } }); break;
    case 'session/new': sessionId = randomUUID(); reply(message.id, { sessionId }); break;
    case 'session/load': sessionId = message.params.sessionId; reply(message.id, {}); break;
    case 'session/prompt': {
      const text = message.params.prompt.map(p => p.text || '').join(' ');
      if (!text.includes('permission')) { finish(message.id, 'Fixture: task recorded.'); break; }
      const id = randomUUID(); pending.set(id, message.id);
      send({ id, method: 'session/request_permission', params: { sessionId, toolCall: { title: 'Write proof.txt', rawInput: { path: path.join(process.cwd(), 'proof.txt'), content: 'approved once' } }, options: [{ optionId: 'once', kind: 'allow_once', name: 'Allow once' }, { optionId: 'forever', kind: 'allow_always', name: 'Always allow' }, { optionId: 'deny', kind: 'reject_once', name: 'Reject' }] } });
      break;
    }
    case 'session/cancel': if (message.id) reply(message.id, {}); break;
    default: if (message.id) reply(message.id, {});
  }
});
