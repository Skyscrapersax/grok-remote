# Chat topbar follow-up — DONE

Implemented: muted `cwd` chip on the conversation tabs row (`.chat-cwd-chip`).

- Renders raw `agent.cwd`, truncates with ellipsis, full path in `title`
- Hidden when cwd empty or no agent selected
- Click-to-copy via `copyToClipboard` + brief “copied” flash
- Craft styling in `src/styles/premium.css` (mono, ink-faint → brass on hover)
