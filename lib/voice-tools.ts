// Function tools exposed to the Grok Voice realtime session, bridged to AgentManager.

import type { AgentManager } from './agent-manager.js';

export const VOICE_TOOLS = [
  {
    type: 'function',
    name: 'list_agents',
    description:
      'List Grok Remote coding agents (id, name, status, connected, model, cwd). Call this to know which conversation to target.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_agent_status',
    description:
      'Status of one coding agent: name, status, connected, model, cwd, sessionId, lastError, token usage summary.',
    parameters: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'string',
          description: 'Agent UUID. Omit to use the dashboard-focused agent.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'delegate_to_agent',
    description:
      'PRIMARY coding tool. Send a full coding task/message to a Grok Remote agent (same as typing in the chat composer). Prefer this for any implementation work. Always pass a complete instruction, not a fragment.',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Complete task for the coding agent.',
        },
        agent_id: {
          type: 'string',
          description: 'Target agent UUID. Omit to use the focused agent from the open chat.',
        },
      },
      required: ['message'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'new_agent',
    description:
      'Spawn a new coding agent conversation. Optionally set name, model, cwd. Returns the new agent id.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name for the conversation' },
        model: { type: 'string', description: 'Model id, e.g. grok-4.5' },
        cwd: { type: 'string', description: 'Working directory for the agent' },
        message: {
          type: 'string',
          description: 'Optional first prompt to send after spawn',
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'connect_agent',
    description: 'Reconnect a disconnected agent process so it can take prompts again.',
    parameters: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'string',
          description: 'Agent UUID. Omit for the focused agent.',
        },
      },
      additionalProperties: false,
    },
  },
] as const;

export function voiceSystemInstructions(focusedAgentId: string | null): string {
  return [
    'You are Grok Voice, a speech co-pilot inside Grok Remote (browser dashboard for Grok Build coding agents).',
    'Speak like a concise teammate on a call — short spoken answers, not essays.',
    'Coding work goes to a coding agent via tools. Do NOT implement multi-file work yourself in speech or invent shell commands as if you ran them.',
    'DELEGATE coding via delegate_to_agent with a complete instruction.',
    'After delegate_to_agent starts work, say one short confirmation like "On it." Do not narrate every tool step.',
    focusedAgentId
      ? `The user currently has agent ${focusedAgentId} focused in the dashboard. Prefer that agent when agent_id is omitted.`
      : 'No agent is focused. Call list_agents or new_agent before delegating.',
    'If the user only wants a status check, use get_agent_status / list_agents.',
    'If the user asks to turn voice off, acknowledge briefly; the client handles hangup.',
  ].join('\n');
}

export async function runVoiceTool(
  manager: AgentManager,
  name: string,
  args: Record<string, unknown>,
  focusedAgentId: string | null,
): Promise<unknown> {
  const resolveId = (): string => {
    const id = typeof args['agent_id'] === 'string' && args['agent_id']
      ? args['agent_id']
      : focusedAgentId;
    if (!id) throw new Error('no agent_id and no focused agent — call list_agents or new_agent first');
    return id;
  };

  switch (name) {
    case 'list_agents': {
      return manager.list().map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status,
        connected: a.connected,
        model: a.model,
        cwd: a.cwd,
        inFlight: a.inFlight,
        starred: a.starred,
        archived: a.archived,
      }));
    }
    case 'get_agent_status': {
      const id = resolveId();
      const a = manager.get(id);
      if (!a) throw new Error(`agent not found: ${id}`);
      return {
        id: a.id,
        name: a.name,
        status: a.status,
        connected: a.connected,
        model: a.model,
        cwd: a.cwd,
        sessionId: a.sessionId,
        lastError: a.lastError,
        totalTokens: a.totalTokens,
        inFlight: a.inFlight,
      };
    }
    case 'delegate_to_agent': {
      const message = String(args['message'] || '').trim();
      if (!message) throw new Error('message is required');
      const id = resolveId();
      let a = manager.get(id);
      if (!a) throw new Error(`agent not found: ${id}`);
      if (!a.connected) {
        await manager.connect(id);
        a = manager.get(id);
      }
      const result = await manager.prompt(id, message);
      return {
        ok: true,
        agent_id: id,
        name: a?.name,
        status: 'prompt_accepted',
        sessionId: result.debug?.['sessionId'] ?? a?.sessionId,
        hint: 'Coding agent is working. The dashboard streams thought/tool/response live.',
      };
    }
    case 'new_agent': {
      const name = typeof args['name'] === 'string' ? args['name'] : undefined;
      const model = typeof args['model'] === 'string' ? args['model'] : undefined;
      const cwd = typeof args['cwd'] === 'string' ? args['cwd'] : undefined;
      const message = typeof args['message'] === 'string' ? args['message'].trim() : '';
      const pub = await manager.spawn({ name, model, cwd });
      if (message) {
        try {
          await manager.prompt(pub.id, message);
        } catch (err) {
          return {
            ok: true,
            agent: pub,
            promptError: err instanceof Error ? err.message : String(err),
          };
        }
      }
      return { ok: true, agent: pub, firstPrompt: message || null };
    }
    case 'connect_agent': {
      const id = resolveId();
      const pub = await manager.connect(id);
      return { ok: true, agent: pub };
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
