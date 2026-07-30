// Resolve a bearer token for xAI Realtime Voice.
// Prefer XAI_API_KEY; fall back to the OIDC access token in ~/.grok/auth.json
// (same credential surface GrokTerm uses when logged in via `grok login`).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface VoiceAuth {
  source: 'env' | 'grok-auth';
  token: string;
  expiresAt?: string | null;
}

export function resolveVoiceAuth(): VoiceAuth | null {
  const envKey = process.env['XAI_API_KEY']?.trim();
  if (envKey) return { source: 'env', token: envKey, expiresAt: null };

  const authPath = path.join(os.homedir(), '.grok', 'auth.json');
  try {
    if (!fs.existsSync(authPath)) return null;
    const raw = JSON.parse(fs.readFileSync(authPath, 'utf8')) as Record<string, unknown>;
    // Shape: { "https://auth.x.ai::clientId": { key, expires_at, ... }, ... }
    let best: { token: string; expiresAt: string | null; expMs: number } | null = null;
    for (const v of Object.values(raw)) {
      if (!v || typeof v !== 'object') continue;
      const entry = v as Record<string, unknown>;
      const key = typeof entry['key'] === 'string' ? entry['key'] : null;
      if (!key) continue;
      const expiresAt = typeof entry['expires_at'] === 'string' ? entry['expires_at'] : null;
      const expMs = expiresAt ? Date.parse(expiresAt) : Number.POSITIVE_INFINITY;
      if (Number.isFinite(expMs) && expMs < Date.now() + 30_000) continue; // expired / expiring
      if (!best || expMs > best.expMs) {
        best = { token: key, expiresAt, expMs };
      }
    }
    if (!best) return null;
    return { source: 'grok-auth', token: best.token, expiresAt: best.expiresAt };
  } catch {
    return null;
  }
}

export function voiceAuthStatus(): {
  ok: boolean;
  source: string | null;
  expiresAt: string | null;
  hint: string;
} {
  const auth = resolveVoiceAuth();
  if (!auth) {
    return {
      ok: false,
      source: null,
      expiresAt: null,
      hint: 'Set XAI_API_KEY or run `grok login` so ~/.grok/auth.json has a valid token.',
    };
  }
  return {
    ok: true,
    source: auth.source,
    expiresAt: auth.expiresAt ?? null,
    hint: auth.source === 'env' ? 'Using XAI_API_KEY' : 'Using grok login token',
  };
}
