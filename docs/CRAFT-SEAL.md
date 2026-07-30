# Craft desk seal — must not regress

Local Grok Deck (`:7910`) is a **hand-crafted craft desk**, not a generic AI SaaS shell.

## Materials
- Default theme **atelier** (client + `lib/settings.ts` + desk.json).
- Wood / paper / brass / ink tokens only for craft surfaces.
- Self-hosted IBM Plex under `/fonts` — **no Google Fonts CDN**.

## Geometry & hover
- Radii **2–3px** on chat `.msg*`, tools, files, system cards under `data-shell=atelier`.
- No cool-white hovers (`rgba(255,255,255,…)`); use warm `rgba(240,220,180,…)` or brass-wash.

## Identity
- Brand: **Grok Deck** / local desk.
- No figlet intro under atelier; no install-banner nag on local desk.
- Primary rail: deck · dash · term · chats; system under **more**.

## Continuity
- `~/.grok-remote/desk.json` via `GET/PUT/PATCH /api/desk` (route, agent, rail, term intents, theme).
- Browser `localStorage` is cache only.

## Verify
```bash
npm test && npm run build
curl -fsS localhost:7910/api/desk | head
curl -fsS localhost:7910/api/settings | grep atelier
curl -fsS -o /dev/null -w "%{http_code}\n" localhost:7910/fonts/fonts.css
# HTML must not reference fonts.googleapis.com
```
