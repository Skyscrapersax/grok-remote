# Craft Desk → 100% — Complete Forward Plan

**Date:** 2026-07-30  
**Project:** `grok-remote-download` (Grok Deck @ `http://127.0.0.1:7910`)  
**Status:** Daily-path craft ~95% visual; overall craft-desk feel ~82% (non-durable until commit)

### Vision sources (authoritative)

| Doc | Role |
|-----|------|
| [`../DECK.md`](../DECK.md) | In-repo desk entry + material hierarchy summary |
| **External:** `~/Projects/design-elevation/CRAFT-DESK-ELEVATION.md` | Material system, tokens, surface direction, acceptance checklist |
| **External:** `~/Projects/design-elevation/CRAFT-DESK-100-PLAN.md` | Sibling plan draft (this file is the **project copy** and execution source of truth) |

**Thesis (from elevation):** Stop treating Atelier as “dark mode with a gold accent.” Treat it as three materials — **wood chassis, brass fittings, paper work** — applied so Deck, Dash, Term, Chat, Files, and System feel like one hand-built desk.

---

## 1. Single best next move

### **A1 — Commit the craft stack**

| | |
|--|--|
| **Why first** | Atelier lives almost entirely in **uncommitted** paths (`src/styles/premium.css`, desk-*, Deck/Dash/Term, `public/fonts/`, `bin/gd`, term/voice server bits). Clone/reinstall/reset wipes identity. |
| **Owner** | Desk maintainer |
| **Effort** | 1–2 hours |
| **Blocks** | All of B–D (do not start `desk.json` or term restore before A1) |

**Done when**

- [ ] Craft paths committed (one coherent commit or small stack)
- [ ] This plan + `DECK.md` in-repo and linked
- [ ] Fresh clone → `npm i && npm run build` → `gd open` shows atelier without folklore
- [ ] Commit SHA recorded in `DECK.md` or release notes

---

## 2. Current baseline (what is already sealed)

| Area | State on live host |
|------|-------------------|
| Tokens: wood / paper / brass / ink | Live (`:root` + `[data-theme=atelier]`) |
| Deck / Dash / Term / Chat craft | Live (`premium.css` + base purge) |
| Self-hosted IBM Plex | Live (`public/fonts/` → `/fonts/`) |
| Chat keys (Esc / i / j·k / cwd chip) | Live (`desk-keys` + `ChatView.handleKey`) |
| Light continuity | Browser `desk-furniture` (last hash + rail “more”) only |
| Demo fleet | `Deck · Alpha|Bravo|Charlie` |
| Server default theme | **Drift:** `lib/settings.ts` still `theme: 'dark'` |
| Client default theme | `DEFAULT_THEME = 'atelier'` in `src/lib/themes.ts` |
| Term native fallback | Implemented (`native: true` → macOS Terminal) |
| Term PTY restore after restart | **Missing** (no intent persistence) |
| Git durability | **0%** until A1 |

**Rough completion**

| Slice | ~% |
|-------|-----|
| Daily-path visual | 95% |
| Secondary surfaces (Flow / system / ops) | 60–70% |
| Continuity (`desk.json`) | 40% (local hash only) |
| Identity durability (git) | 0% |
| **Overall craft-desk feel** | **~82%** |

---

## 3. Phases A–D (full task list)

Default **Owner** = desk maintainer (local). Split “web” / “server” only if two people.

---

### Phase A — Seal identity (durability, drift, zero-flash)

**Goal:** Craft cannot be lost; cold load never flashes SaaS; server and client agree.  
**Calendar effort:** ~1 day  
**Depends on:** nothing  

| ID | Task | Effort | Owner | Done when |
|----|------|--------|-------|-----------|
| **A1** | **Commit craft stack** — include at minimum: `src/styles/`, `src/style.css`, `src/lib/desk-*.ts`, `src/lib/themes.ts`, `src/views/{deck,dash,term,chat,files,agents}.ts`, `public/fonts/`, `bin/gd`, term/voice `lib/*` needed by Deck, `test/desk-*.ts`, `test/themes.test.ts`, `DECK.md`, this plan | 1–2h | maintainer | SHA on branch; clone smoke green |
| **A2** | **Seal docs** — `DECK.md` indexes elevation + this plan; note vision paths; document theme defaults, keyboard, demos, verify commands | 30–45m | maintainer | One hop from repo root to vision |
| **A3** | **Fix settings drift (server ↔ client)** — change `lib/settings.ts` default `theme: 'dark'` → `'atelier'`; one-shot migrate on-disk settings if present; ensure `GET /api/settings` cannot reintroduce dark as “canonical” for UI; settings picker selected state = `getTheme()` after load | 1–2h | maintainer | Fresh install: server file + localStorage + `data-theme` + theme-color meta all atelier |
| **A4** | **Zero-flash chat / files / system** — FOUC audit: HTML already `data-theme=atelier` + `data-shell=atelier`; craft radii/colors available from first paint (blocking CSS or critical CSS); no 8–12px / cool-white hover in base rules that paint before JS; atelier kill-switch for files tree, system lists, registry if any residual | 2–3h | maintainer | Hard-refresh `#/chats`, Files, one system page: **zero frames** of pill chrome |
| **A5** | **Atelier-first theme cycle** — topbar cycle = atelier ↔ light (optional mocha); full catalog only under Settings “show all themes” | 1h | maintainer | Accidental unicorn rare |
| **A6** | **Complete chat keys + local identity** — ensure `bindSurfaceKeys('chat')` on chat + home; help/`DESK_BINDINGS` list chat Esc / i·a / j·k; brand + PWA + install banner say **Grok Deck**; theme-color tracks atelier chrome; one-time migration flag documented | 1–2h | maintainer | `?` help matches live chat keys; cold load never says generic Remote SaaS chrome |
| **A7** | **Verification that fails on SaaS drift** — add `scripts/verify-craft.sh` or `npm run verify:craft` gates (see §5); wire into CI or `gd verify` | 1–2h | maintainer | Intentional SaaS CSS / dark default fails the check |

**Phase A exit criteria**

- [ ] Craft stack in git  
- [ ] Server + client theme default = atelier  
- [ ] No SaaS radius / cool-white flash on chat, files, system  
- [ ] Chat keys complete + documented  
- [ ] `npm run verify:craft` (or `gd verify-craft`) fails on regression  

---

### Phase B — `desk.json` persistence and routing

**Goal:** Leave the desk as you left it (surface, agent, panels).  
**Calendar effort:** ~1.5–2 days  
**Depends on:** A1 (commit), ideally A3 (theme may mirror into desk state)

| ID | Task | Effort | Owner | Done when |
|----|------|--------|-------|-----------|
| **B1** | **Schema** — `~/.grok-remote/desk.json` versioned shape: `version`, `lastHash`, `lastAgentId`, `chatTab`, `toolsCollapsed`, `railSystemOpen`, `theme?`, `termTabs[]` (`kind`, `cwd`, `name`), `updatedAt` | 1h | maintainer | Schema in `DECK.md` + TypeScript type |
| **B2** | **Server API** — `GET/PUT /api/desk` (atomic write, validate, no secrets) | 2–3h | maintainer | curl round-trip; file on disk |
| **B3** | **Client dual-write** — evolve `desk-furniture.ts`: localStorage cache + server when healthy; restore order server → local → defaults; migrate `grok-remote.desk` once | 3–4h | maintainer | Restart browser restores from server file |
| **B4** | **Routing restore** — empty hash → `lastHash`; restore `lastAgentId` selection; restore chat tab + tools collapse | 2h | maintainer | Refresh mid-chat returns to same agent + Conversation tab |
| **B5** | **Rail continuity** — persist rail “more” via desk.json (replace ad-hoc localStorage-only) | 1h | maintainer | Rail cluster state survives reload |
| **B6** | **Tests** — unit migrate + furniture dual-write; API GET/PUT test | 1–2h | maintainer | `npm test` covers desk |

**Phase B exit criteria**

- [ ] `~/.grok-remote/desk.json` is source of truth  
- [ ] Cold open restores last surface + agent  
- [ ] localStorage is cache, not sole authority  

---

### Phase C — Term fallback + PTY restore after restart

**Goal:** Terminal is a permanent instrument; restart does not erase workbench intent.  
**Calendar effort:** ~1.5–2 days  
**Depends on:** B1–B3 (`termTabs` in desk state)

| ID | Task | Effort | Owner | Done when |
|----|------|--------|-------|-----------|
| **C1** | **Prove native fallback** — force embedded PTY failure path; confirm `native: true` opens macOS Terminal; craft note UI (not alert-only); document proof in DECK.md | 1–2h | maintainer | Written repro steps + pass once |
| **C2** | **Persist term intents** — on create/close/rename write `{ kind, cwd, name }[]` to desk state | 2h | maintainer | desk.json lists shells after use |
| **C3** | **Restore after server restart** — on `#/term` mount: no live PTYs but intents present → auto-recreate or “Restore N sessions” banner | 3–4h | maintainer | `pm2 restart` → Term shows restored intents |
| **C4** | **Reattach live PTYs first** — hydrate existing server sessions, then fill gaps from intents | 2h | maintainer | Alive PTYs reconnect; dead ones recreate |
| **C5** | **`gd verify-term` / verify:craft term section** — create shell → restart → restore → assert | 2h | maintainer | One command proves C1–C4 |
| **C6** | **Craft voice on restore UX** — banner, empty state, native note = mono/wood/brass | 1h | maintainer | No utility-alert aesthetic |

**Phase C exit criteria**

- [ ] Fallback path proven and documented  
- [ ] PTY **intent** restore after restart works  
- [ ] Verify command fails if restore regresses  

---

### Phase D — Immersion, ops, verification freeze

**Goal:** No surface ejects you from the desk; 100% definition met.  
**Calendar effort:** ~1.5–2 days  
**Depends on:** A complete; B/C for continuity claims  

| ID | Task | Effort | Owner | Done when |
|----|------|--------|-------|-----------|
| **D1** | **Flow graph craft** — wood/brass on flow bundle (`flow-*.css` / canvas); kill cool-white in flow CSS | 3–4h | maintainer | Flow is not “another product” |
| **D2** | **System / MCP / health / registry / hooks sweep** — shared instrument language; 2px trays; paper fields; brass focus | 3–4h | maintainer | Random system route still Atelier |
| **D3** | **Files surface parity** — tree wood, preview paper; verify A4 holds on all file types | 1–2h | maintainer | Files matches chat hierarchy |
| **D4** | **Demo fleet content** — peeks show craft notes / micro-tasks, not only heartbeats | 1–2h | maintainer | Dash peek reads as desk work |
| **D5** | **Ops: `gd verify-craft` full path** — cold load, theme defaults, CSS gates, demos, desk.json present after use, term restore optional flag | 2h | maintainer | Single command = release gate |
| **D6** | **Identity freeze** — naming, install banner, PWA title, meta theme-color; no “generic Remote SaaS” residual on daily path | 1h | maintainer | Copy audit clean |
| **D7** | **Optional multi-client desk.json** — confirm phone PWA + desktop share server desk state | 1h | maintainer | Documented behavior |

**Phase D exit criteria = 100% craft desk feel** (see §6)

---

## 4. Dependency sequence

```
A1 commit ──► A2 docs
     │
     ├─► A3 theme drift ──► A5 cycle policy
     ├─► A6 chat keys + local identity
     └─► A4 zero-flash ──► A7 verify:craft gates
              │
              ▼
     B1 schema ──► B2 API ──► B3 client sync ──► B4 routing
              │                                    │
              └──────────► C2 term intents ◄───────┘
                              │
                              ▼
                     C3/C4 restore ──► C1 proof + C5 verify-term
                              │
                              ▼
              D1 Flow + D2 system ──► D5 acceptance ──► 100%
```

**Parallelism (after A1):** A3 ∥ A4 ∥ A6. After A4: D1 ∥ D2 can start while B/C run if staffed. **Never** large CSS refactors without A1 committed.

---

## 5. Verification that fails on SaaS drift

Add `scripts/verify-craft.sh` (and `npm run verify:craft` / `gd verify-craft`):

### 5.1 Static gates (CI-friendly)

```bash
# Fail if soft SaaS radii re-enter craft shell layer
rg -n "border-radius:\s*(8|10|12|14|16|22|999)px" src/styles/premium.css && exit 1

# Fail if cool-white hovers re-enter craft shell
rg -n "rgba\(\s*255\s*,\s*255\s*,\s*255" src/styles/premium.css && exit 1

# Fail if server or client default theme drifts off atelier
rg -n "theme:\s*['\"]dark['\"]" lib/settings.ts && exit 1
rg -n "DEFAULT_THEME\s*=\s*['\"]dark['\"]" src/lib/themes.ts && exit 1

# Require atelier default
rg -n "DEFAULT_THEME\s*=\s*['\"]atelier['\"]" src/lib/themes.ts || exit 1
rg -n "theme:\s*['\"]atelier['\"]" lib/settings.ts || exit 1

# index.html craft shell markers
rg -n 'data-theme="atelier"' index.html || exit 1
rg -n 'data-shell="atelier"' index.html || exit 1
```

### 5.2 Runtime gates (local / pre-release)

| Check | Command / action | Fail if |
|-------|------------------|---------|
| Health | `curl -sf localhost:7910/api/health` | non-200 |
| Theme API | settings payload theme | not atelier (post-migrate) |
| Demos | `gd verify` / agents named Deck · * | missing fleet |
| desk.json | after navigation | file missing when B shipped |
| Term restore | C5 script | tabs not recreated after restart |
| Visual FOUC | hard-refresh chats/files/system | human or screenshot gate |

### 5.3 Suggested npm scripts

```json
"verify:craft": "bash scripts/verify-craft.sh",
"verify:term": "bash scripts/verify-term.sh"
```

---

## 6. Definition of 100%

The desk is **100%** when all are true:

1. **Durable** — craft stack committed; clone → atelier without folklore  
2. **Unified theme** — server default + client default + UI + `data-theme` = atelier  
3. **Zero flash** — hard-refresh chat, files, system never shows pill radii or cool-white  
4. **Continuity** — `desk.json` restores route + agent (+ chat chrome)  
5. **Term identity** — fallback proven; PTY intents restore after `pm2 restart`  
6. **Keys + identity** — chat surface complete; Deck naming consistent  
7. **Secondary immersion** — Flow + system still feel like the same desk  
8. **Gates** — `verify:craft` fails on SaaS/theme drift  

---

## 7. Effort rollup

| Phase | Focus | Effort |
|-------|--------|--------|
| **A** | Commit, docs, theme drift, zero-flash, chat keys, verify gates | ~1 day |
| **B** | desk.json + routing | ~1.5–2 days |
| **C** | Term fallback + PTY restore | ~1.5–2 days |
| **D** | Flow/system/ops + acceptance | ~1.5–2 days |
| **Total** | | **~5–7 focused days** |

---

## 8. Explicit non-goals (do not block 100%)

- Pixel GrokTerm native UI redesign (binary; mono config is enough)  
- Full PTY scrollback persistence  
- More theme variants  
- Growing demo agent count  
- ACP protocol redesign  

---

## 9. Immediate execution order (this week)

| Order | Task | Phase |
|------:|------|--------|
| 1 | **Commit craft stack** | A1 |
| 2 | Seal docs + link elevation | A2 |
| 3 | Server/client atelier default | A3 |
| 4 | Chat keys + local identity audit | A6 |
| 5 | Zero-flash + verify:craft gates | A4, A7 |
| 6 | Atelier-first cycle | A5 |
| 7 | desk.json schema + API + client | B1–B4 |
| 8 | Term intents + restore + verify-term | C2–C5 |
| 9 | Flow + system sweep + acceptance | D1–D5 |

---

## 10. File map (where work lands)

| Concern | Primary paths |
|---------|----------------|
| Tokens / base CSS | `src/style.css` |
| Craft shell | `src/styles/premium.css` |
| Themes | `src/lib/themes.ts`, `lib/settings.ts` |
| Desk keys | `src/lib/desk-keys.ts`, `src/lib/desk-overlays.ts` |
| Continuity (today) | `src/lib/desk-furniture.ts` |
| Continuity (target) | `~/.grok-remote/desk.json`, `GET/PUT /api/desk`, furniture dual-write |
| Term | `src/views/term.ts`, `lib/term-host.ts`, `lib/launch-native.ts` |
| Chat | `src/views/chat.ts` |
| Files | `src/views/files.ts` |
| System | `src/views/system/*` |
| Verify | `scripts/verify-craft.sh`, `bin/gd` |
| Docs | `DECK.md`, `docs/craft-desk-100-plan.md` (this file) |

---

## 11. Cross-links

- Vision / materials: `~/Projects/design-elevation/CRAFT-DESK-ELEVATION.md`  
- Sibling plan draft: `~/Projects/design-elevation/CRAFT-DESK-100-PLAN.md`  
- Desk UX entry: [`../DECK.md`](../DECK.md)  
- Audit backlog: `~/Projects/atelier-audit/NEXT-STEPS.md`  

---

*End of plan. Start at **A1**. Everything else is optional until the craft stack is in git.*
