# Grok Remote — setup status

**Verified:** 2026-07-30

| Item | Status |
|------|--------|
| Source | https://github.com/daniel-farina/grok-remote |
| Version | **v0.2.23** (latest release) |
| Install dir | `/Users/sky/Projects/grok-remote-download` |
| Dashboard | http://localhost:7910 |
| Process | PM2 `grok-remote` (local bind `127.0.0.1:7910`) |
| CLI | `gr` → `~/.local/bin/gr` |
| Defaults | model `grok-4.5`, cwd `/Users/sky/Projects` |

## Commands

```bash
gr status
gr open
gr logs
gr restart
```

## Login auto-start

User LaunchAgent: `~/Library/LaunchAgents/com.grok-remote.pm2.plist`  
Runs `pm2 resurrect` at login (no sudo).

## Optional (not required for local use)

- **Tailscale:** `brew install --cask tailscale-app` then `./install.sh --tailnet` (needs password + sign-in)
- **System pm2 startup:** `sudo env PATH=$PATH:/usr/local/bin pm2 startup launchd -u sky --hp /Users/sky`

## Grok Voice (added locally)

Browser speech co-pilot similar in spirit to GrokTerm:

- **UI:** Chat composer → **voice** button
- **API:** `GET /api/voice/status`, `WS /api/voice/ws?agentId=…`
- **Auth:** `XAI_API_KEY` or `grok login` (`~/.grok/auth.json`)
- **Tools:** `list_agents`, `get_agent_status`, `delegate_to_agent`, `new_agent`, `connect_agent`
- **Default voice/model:** `eve` / `grok-voice-latest` (override with `GROK_VOICE_ID` / `GROK_VOICE_MODEL`)

Verified: proxy opens xAI Realtime, `list_agents` tool executes, dashboard build includes voice control.
