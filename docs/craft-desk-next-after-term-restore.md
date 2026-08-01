# Next Steps After Term Restore

**Date:** 2026-07-30  
**Context:** Term restore (`termTabs` / `termLastKind` dual-write + hydrate) landed in `b3f707a`.  
**Vision:** [`CRAFT-DESK-ELEVATION.md`](../../../design-elevation/CRAFT-DESK-ELEVATION.md) · full roadmap: [`craft-desk-100-plan.md`](./craft-desk-100-plan.md)

---

## 1. Scoreboard (what is sealed vs open)

| Area | Status | Notes |
|------|--------|--------|
| **A1** Craft stack committed | ✅ Done | `main` ahead of origin (~5 commits); stack in git |
| **A2** Docs sealed | 🟡 Partial | `DECK.md` + plan exist; baseline § in 100-plan still stale |
| **A3** Settings drift | ✅ Done | Server + client `atelier`; live `craftThemeAligned` |
| **A4** Zero-flash chat/files/system | 🟡 Mostly | Craft CSS clean; hard-refresh FOUC audit not formalized |
| **A5** Atelier-first theme cycle | ✅ Done | Topbar: atelier → light → mocha; full catalog in Settings |
| **A6** Chat keys + identity | ✅ Done | Keys + help Chats section + cwd chip + Grok Deck branding |
| **A7** `verify:craft` gates | ✅ Done | Theme matrix + B4 helpers + live settings/desk asserts |
| **B1–B3** desk.json + dual-write | ✅ Done | `~/.grok-remote/desk.json` + `/api/desk` + furniture |
| **B4** Routing restore (agent + chat chrome) | ✅ Done | Cold-open lastAgentId; chatTab + toolsCollapsed dual-write |
| **B5** Rail continuity | ✅ Mostly | `railSystemOpen` dual-write |
| **C2–C4** Term intents + restore | ✅ Done | Hydrate: live PTYs → recreate missing intents |
| **C1** Native fallback proof | 🟡 Partial | Path works; host often native-fallback; formal DECK repro thin |
| **C5** `verify:term` | ✅ Done | `npm run verify:term` |
| **C6** Craft restore UX | ✅ Done | Restore note styling |
| **D1** Flow craft | ❌ Open | Flow CSS bundle has no wood/brass |
| **D2** System/ops surfaces | ❌ Open | MCP/health/registry still secondary |
| **D3** Files parity audit | 🟡 Partial | Some craft; full FOUC pass open |
| **D4** Demo content | ❌ Open | Heartbeats > craft peeks |
| **D5** Unified release gate | 🟡 Partial | craft + term scripts; not one `gd verify-craft` umbrella |
| **D6** Identity freeze | 🟡 Partial | Brand/PWA good; residual “Grok Remote” in package copy |
| **Push origin** | ❌ Open | Local `main` not pushed |

**Overall after term restore: ~88%** daily path; **~70%** full desk (routing agent restore + secondary surfaces + push still open).

---

## 2. Best next move

### **B4 — Routing restore** ✅ landed

Cold open restores `lastHash`, one-shot `lastAgentId` when landing on `#/chats`, and chat chrome (`chatTab` / `toolsCollapsed`) from desk.json dual-write.

---

## 3. Prioritized sequence (remaining work)

```
DONE    B4 / A5 / A6′ / settings matrix / verify:all scaffold
  │
  ├─►   A4′ FOUC checklist pass                 (~1h)
  ├─►   Ops: git push when ready                (~15m)
  ├─►   C1′ Document native fallback proof      (~45m)
  │
  └─►   Phase D immersion
        D3 Files FOUC polish                    (~1–2h)
        D1 Flow craft                           (~3–4h)
        D2 System/MCP/health                    (~3–4h)
        D4 Demo peeks                           (~1–2h)
        D5 polish single release gate           (~30m)
        D6 residual identity freeze             (~30m)
```

**Total remaining to 100%:** ~1.5–3 focused days.

---

## 4. Work packages by surface (active tabs)

### Deck (`#/deck`)
| Priority | Task | Effort | Status |
|----------|------|--------|--------|
| P2 | Keep Keys panel generated from `DESK_BINDINGS` only | 1h | Open |
| P3 | Optional “last sessions” strip from desk.termTabs | 2h | Nice-to-have |

### Dash (`#/dash`)
| Priority | Task | Effort | Status |
|----------|------|--------|--------|
| P1 | Ensure dash search/group/collapse already restore (furniture) — smoke after B4 | 30m | Verify |
| P2 | Demo peeks = craft notes (D4) | 1–2h | Open |

### Term (`#/term`)
| Priority | Task | Effort | Status |
|----------|------|--------|--------|
| — | Intent restore + dual-write | — | **Done** |
| P2 | C1′ write DECK.md “prove fallback” steps (this host often native) | 45m | Open |
| P3 | Prefer reattach-only when live PTYs cover all intents (avoid duplicate shells) | 1h | Polish |

### Chats (`#/chats`, `#/agents/:id`)
| Priority | Task | Effort | Status |
|----------|------|--------|--------|
| **P0** | **B4** restore `lastAgentId` on boot / when landing `#/chats` | 2h | **Next** |
| P0 | Persist + restore `chatTab`, `toolsCollapsed` | 1h | Next (with B4) |
| P1 | Help overlay lists chat Esc / i·a / j·k accurately | 30m | Open |
| P1 | A4′ hard-refresh FOUC pass on stream + composer | 1h | Open |
| P2 | Settings drawer craft already; re-check after theme cycle A5 | 30m | Verify |

### Files (chat Files tab)
| Priority | Task | Effort | Status |
|----------|------|--------|--------|
| P1 | D3 FOUC + paper preview vs wood tree audit | 1–2h | Open |

### System / Flow / Settings (rail “more”)
| Priority | Task | Effort | Status |
|----------|------|--------|--------|
| P1 | **A5** atelier-first cycle (stop unicorn eject) | 1h | Open |
| P1 | **Settings verification** — document matrix: server settings.theme ↔ localStorage ↔ `data-theme` ↔ desk.theme; add assert to `verify:craft` | 1h | Open |
| P2 | D1 Flow wood/brass | 3–4h | Open |
| P2 | D2 System/MCP/health trays | 3–4h | Open |

### Ops / identity (not a tab, blocks “done”)
| Priority | Task | Effort | Status |
|----------|------|--------|--------|
| P1 | `git push` craft commits when ready | 15m | Open |
| P1 | Update `docs/craft-desk-100-plan.md` baseline (A1/A3/C* done) | 30m | Open |
| P1 | `gd verify` / `npm run verify:all` = craft + term (+ demos) | 1h | Open |
| P2 | D6 strip residual “Grok Remote” product strings where user-facing | 1h | Open |

---

## 5. Settings verification (explicit)

**Current live:** `theme=atelier`, `craftThemeAligned=true`.

**Still do**

1. **Matrix in DECK.md**

   | Source | Expected (craft desk) |
   |--------|------------------------|
   | `lib/settings.ts` default | `atelier` |
   | `~/.grok-remote/settings.json` | `atelier` (post-migrate) |
   | `src/lib/themes.ts` `DEFAULT_THEME` | `atelier` |
   | `localStorage grok-remote.theme` | `atelier` (or user choice) |
   | `desk.json` `theme` | mirrors UI |
   | `index.html` / `data-theme` | `atelier` cold load |

2. **Extend `verify:craft`**  
   - Fail if `settings.theme === 'dark'` when `craftThemeAligned`  
   - Optional: fail if client DEFAULT ≠ `atelier`

3. **A5** so topbar cannot reintroduce carnival themes without Settings intent  

---

## 6. Chat finishing (checklist)

| Item | Done? | Action |
|------|-------|--------|
| `handleKey` Esc / i·a / j·k | ✅ | — |
| `bindSurfaceKeys('chat')` | ✅ | — |
| cwd chip copy | ✅ | — |
| Quiet intro (no figlet) | ✅ | — |
| Persist `chatTab` | ✅ | `rememberChatTab` on `switchTab` |
| Restore `chatTab` | ✅ | `restoreChatChrome` on mount |
| Persist/restore tools collapse | ✅ | `getToolsCollapsed` / `rememberToolsCollapsed` |
| Restore last agent on `#/chats` | ✅ | one-shot `tryRestoreLastAgent` |
| Help lists chat bindings | ✅ | Chats section in help overlay |
| FOUC free stream | ❓ | A4′ hard-refresh |

---

## 7. Definition of “next milestone” (post–term restore)

**Milestone: Desk continuity complete (B4 + chat finish)** — target **½ day**

- [ ] Cold open restores surface **and** last agent when still in roster  
- [ ] Chat tab + tools panel state round-trip  
- [ ] `verify:craft` + `verify:term` green  
- [ ] Settings matrix documented; no dark default drift  
- [ ] (Optional) `git push`  

After that, Phase D (Flow/system/demos) is pure immersion, not continuity.

---

## 8. Immediate action list (ordered)

| # | Action | Plan ID | Effort |
|---|--------|---------|--------|
| 1 | **Implement B4** — restore `lastAgentId` + chat chrome from desk.json | B4 | 2h |
| 2 | Persist `chatTab` / `toolsCollapsed` on change | A6′ / B4 | 1h |
| 3 | Atelier-first theme cycle | A5 | 1h |
| 4 | Settings matrix + verify assert | settings verify | 1h |
| 5 | Refresh 100-plan status § + push | A2 / ops | 45m |
| 6 | Umbrella `verify:all` | D5 start | 1h |
| 7 | Flow craft | D1 | 3–4h |
| 8 | System surface sweep | D2 | 3–4h |
| 9 | Demo peeks + identity freeze | D4 / D6 | 2–3h |

---

## 9. Out of scope (still)

- GrokTerm native pixel redesign  
- Full PTY scrollback persistence  
- More theme variants  
- ACP redesign  

---

*Start at **#1 B4 routing restore**. Term restore is done; agent/chat restore is the missing continuity half.*
