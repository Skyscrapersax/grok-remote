# Grok Deck — unified interface

One control plane that joins **Dash**, **Terminal**, **Grok Remote**, and **GrokTerm**.

## Visual language (Atelier craft desk)

Default theme is **atelier**: **wood chassis · brass fittings · paper work**. IBM Plex type, sharp 2–3px corners. No gradient wordmarks, neon glows, scanlines, or pill chrome. Optional themes (dark/hacker/unicorn/…) remain in the cycle picker for variety.

### Vision & 100% plan

| Doc | Role |
|-----|------|
| [`docs/craft-desk-100-plan.md`](docs/craft-desk-100-plan.md) | **In-repo forward plan (phases A–D)** — execution source of truth |
| `~/Projects/design-elevation/CRAFT-DESK-ELEVATION.md` | Material system, tokens, surface direction, acceptance checklist |
| `~/Projects/design-elevation/CRAFT-DESK-100-PLAN.md` | Sibling plan draft (mirrored into `docs/craft-desk-100-plan.md`) |

**Craft stack sealed (A1):** `139949f` (+ follow-ups `ff96cc3`, `fe5e6ca` for desk lastHash/tests).  
**Settings drift (A3):** server + live `settings.theme=atelier` (`craftThemeAligned`).  
**desk.json (B1–B3 core):** `lib/desk.ts` + client `desk-furniture` dual-write; live `~/.grok-remote/desk.json` via `GET/PATCH /api/desk`.  

**Best next move:** Phase **B4** — routing restore: empty hash → `lastHash`, restore `lastAgentId` selection + chat tab / tools collapse on cold open.

- Tokens: `src/style.css` (`:root` + `[data-theme="atelier"]`) — wood/paper/ink/brass scales, warm shadows, lamp vignette.
- Craft shell: `src/styles/premium.css` — trays, paper peek, brass CTAs, rail, chat paper stream, composer paper field.
- Embedded xterm (`#/term`): wood-1 well, ink phosphor, brass cursor (full 16-color craft palette).
- GrokTerm (native): `mono` theme; particles / session radar / boot cinematic / UI sounds off.

### Material hierarchy (live)

| Layer | Material | Surfaces |
|-------|----------|----------|
| Chassis | wood-1 / wood-2 | Deck ground, Dash ground, topbar, rail |
| Tray | wood-3 + tray shadow | Cards, status grid, roster board, dispatch |
| Paper | paper-0 / paper-1 | Dash peek, chat bubbles, composer field |
| Brass | face + deep + wash | Primary CTA, focus, selected bar, live/ok |
| Ink | chalk on wood | Labels, body, mono kickers |

### Signature details

- Brand square brass mark + short brass hairline under brand
- Deck hero rule with left brass tick; focused card brass corner tick
- Selected Dash row: brass inset bar + brass wash
- Working dots: brass opacity pulse (no glow)
- Keyboard chords as wood keycaps (not soft pills)
- Chat stream paper slips; quiet intro (`ready · type to begin`); **cwd chip** on tabs
- Term empty: `no sessions — c shell · g grok · d dash`

## Keyboard (primary interaction model)

Vim / tmux muscle memory is the default way to drive Deck, Dash, and Term. Implementation: `src/lib/desk-keys.ts` + `src/lib/desk-overlays.ts`.

| Keys | Action |
|------|--------|
| `⌘K` / `Ctrl+K` / `:` | Command palette |
| `?` / `⌘/` | Keyboard help |
| `g d` · `g a` · `g t` · `g c` · `g s` | Go Deck / Dash / Term / Chats / Settings |
| `⌘1`–`⌘4` | Jump surfaces (Deck · Dash · Term · Chats) |
| **Deck** `j/k` `h/l` `1–4` `Enter`/`o` | Focus cards · jump · open |
| **Dash** `j/k` `Enter`/`o` `/` `n` `p` `x` `r` `gg`/`G` | Roster, search, dispatch, reply, cancel, rename |
| **Term** `Ctrl-b` then `n/p` `c` `g` `d` `x` `1–9` | tmux-style prefix for tabs |
| **Term** `Ctrl+Tab` · `Ctrl+Shift+T/W` | Next tab · new shell · close |

Inside a focused xterm, ordinary keys go to the shell. Use the **Ctrl-b** prefix (or global `g …` / palette) for desk chrome.

## Open

```bash
gd                 # browser → http://localhost:7910/#/deck
# or
open http://localhost:7910/#/deck
```

| Route | What |
|-------|------|
| `#/deck` | Unified home (default) |
| `#/dash` | Multi-agent board |
| `#/term` | Embedded xterm tabs (or macOS Terminal fallback) |
| `#/chats` | Remote agent chats + voice |
| Native | Launch GrokTerm / `grok dashboard` |

## Architecture

```
Browser (Grok Deck)
├── Dash     → REST agents + SSE
├── Terminal → node-pty + WS  (fallback: Terminal.app)
├── Remote   → ACP agents + Grok Voice proxy
└── Launchers → GrokTerm.app / grok dashboard
```

## CLI

```
gd open | dash | term | chats | status | demos | grokterm | tui | help
```

### Demo fleet (Dash + TUI)

Polished sample agents live under `~/Projects/deck-demos/{alpha,bravo,charlie}` and are named:

- `Deck · Alpha`
- `Deck · Bravo`
- `Deck · Charlie`

They are **starred** so the server auto-reconnects them after `pm2 restart`.

```bash
gd ensure-demos   # spawn/connect/star + heartbeat prompts
gd verify         # assert 3 live demos + history peeks + heartbeats
gd demos          # list + open Dash
gd tui-demos      # 3 interactive TUI twins + grok dashboard (Terminal)
gd dash           # web multi-agent board (peek / reply)
```

**Web:** Dash rows show working state; peek shows user/assistant/tool lines (including `Execute bash ./heartbeat.sh …`).  
**TUI:** `gd tui-demos` opens interactive sessions on the same cwds so `grok dashboard` can list live agents (plus inactive roster entries from other tabs).

### Residual craft elevation

After checklist review, also elevated: split gutters (brass hover), tools column wood, thinking panes as paper+brass, install banner tray, app footer chassis, warm drawer dim, files paper preview, dash dispatch wood-3.
