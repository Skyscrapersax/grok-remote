import { randomUUID } from 'node:crypto';

export interface PermissionOutcome { outcome: { outcome: 'selected' | 'cancelled'; optionId?: string } }
export interface PermissionRequest {
  id: string; title: string; detail: string; expiresAt: number;
  options: { optionId: string; name: string; kind: 'allow_once' | 'reject_once' }[];
}
export interface PermissionHost {
  requestPermission(params?: unknown): Promise<PermissionOutcome>;
  list(): PermissionRequest[];
  decide(id: string, optionId: string | null): boolean;
  cancelAll(): void;
}

// ponytail: pending approvals are in memory; restart cancels them. History keeps decisions.
export function createPermissionHost(onChange: (event: string, detail: Record<string, unknown>) => void = () => {}): PermissionHost {
  const pending = new Map<string, { request: PermissionRequest; resolve: (value: PermissionOutcome) => void; timer: ReturnType<typeof setTimeout> }>();
  function decide(id: string, optionId: string | null, reason = 'operator'): boolean {
    const entry = pending.get(id);
    if (!entry || (optionId !== null && !entry.request.options.some(o => o.optionId === optionId))) return false;
    pending.delete(id); clearTimeout(entry.timer);
    const selected = optionId !== null && entry.request.expiresAt > Date.now();
    entry.resolve({ outcome: selected ? { outcome: 'selected', optionId } : { outcome: 'cancelled' } });
    onChange('permission_resolved', { id, optionId: selected ? optionId : null, reason });
    return true;
  }
  return {
    list: () => [...pending.values()].map(({ request }) => structuredClone(request)),
    decide,
    cancelAll() { for (const id of pending.keys()) decide(id, null, 'session_closed'); },
    async requestPermission(params): Promise<PermissionOutcome> {
      const value = params as { toolCall?: { title?: unknown; rawInput?: unknown }; options?: unknown[] } | null;
      if (!value || !Array.isArray(value.options) || value.options.length > 20 || pending.size >= 20) return { outcome: { outcome: 'cancelled' } };
      const ids = value.options.map(o => (o as { optionId?: unknown } | null)?.optionId);
      if (new Set(ids).size !== ids.length) return { outcome: { outcome: 'cancelled' } };
      const options: PermissionRequest['options'] = [];
      for (const raw of value.options) {
        const o = raw as { optionId?: unknown; name?: unknown; kind?: unknown } | null;
        if (!o || !['allow_once', 'reject_once'].includes(String(o.kind)) || typeof o.optionId !== 'string' || !o.optionId || o.optionId.length > 200 || options.some(v => v.optionId === o.optionId)) continue;
        options.push({ optionId: o.optionId, name: String(o.name || o.kind).slice(0, 200), kind: o.kind as 'allow_once' | 'reject_once' });
      }
      if (!options.length) return { outcome: { outcome: 'cancelled' } };
      const title = String(value.toolCall?.title || 'Tool request'), detail = JSON.stringify(value.toolCall?.rawInput ?? {}, null, 2);
      if (title.length > 500 || detail.length > 16000) return { outcome: { outcome: 'cancelled' } };
      const request: PermissionRequest = { id: randomUUID(), title, detail, options, expiresAt: Date.now() + 120000 };
      return new Promise(resolve => {
        const timer = setTimeout(() => decide(request.id, null, 'expired'), 120000); timer.unref();
        pending.set(request.id, { request, resolve, timer });
        onChange('permission_requested', { ...request });
      });
    },
  };
}
