#!/usr/bin/env bash
# verify-craft — fail on SaaS drift / theme default regression / craft markers missing
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
fail=0

say() { printf '%s\n' "$*"; }
ok() { say "  OK  $*"; }
bad() { say "  FAIL $*"; fail=1; }

say "== craft desk static gates =="

# Soft SaaS radii must not re-enter the craft shell layer
if rg -n "border-radius:\s*(8|10|12|14|16|22|999)px" src/styles/premium.css src/styles/craft-layer.css 2>/dev/null; then
  bad "soft SaaS radii found in craft CSS"
else
  ok "no soft radii in premium/craft-layer"
fi

# Cool-white hovers must not re-enter craft shell
if rg -n "rgba\(\s*255\s*,\s*255\s*,\s*255" src/styles/premium.css src/styles/craft-layer.css 2>/dev/null; then
  bad "cool-white rgba found in craft CSS"
else
  ok "no cool-white hovers in craft CSS"
fi

# Server + client theme defaults must be atelier
if rg -n "theme:\s*['\"]dark['\"]" lib/settings.ts 2>/dev/null; then
  bad "lib/settings.ts still defaults theme to dark"
else
  ok "server settings default is not dark"
fi
if ! rg -n "theme:\s*['\"]atelier['\"]" lib/settings.ts >/dev/null 2>&1; then
  bad "lib/settings.ts missing theme: 'atelier' default"
else
  ok "server settings default atelier"
fi
if ! rg -n "DEFAULT_THEME\s*=\s*['\"]atelier['\"]" src/lib/themes.ts >/dev/null 2>&1; then
  bad "client DEFAULT_THEME is not atelier"
else
  ok "client DEFAULT_THEME atelier"
fi

# HTML craft shell markers
if ! rg -n 'data-theme="atelier"' index.html >/dev/null 2>&1; then
  bad 'index.html missing data-theme="atelier"'
else
  ok "index.html data-theme=atelier"
fi
if ! rg -n 'data-shell="atelier"' index.html >/dev/null 2>&1; then
  bad 'index.html missing data-shell="atelier"'
else
  ok "index.html data-shell=atelier"
fi

# Desk continuity modules present
for f in src/lib/desk-furniture.ts src/lib/desk-keys.ts src/styles/premium.css lib/desk-state.ts docs/craft-desk-100-plan.md; do
  if [[ -f "$f" ]]; then ok "present $f"; else bad "missing $f"; fi
done

# Optional live host checks
if curl -fsS -m 2 http://127.0.0.1:7910/api/health >/dev/null 2>&1; then
  ok "live /api/health"
  th=$(curl -fsS -m 2 http://127.0.0.1:7910/api/settings 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("theme",""))' 2>/dev/null || true)
  if [[ "$th" == "atelier" || "$th" == "light" || "$th" == "mocha" || "$th" == "dark" ]]; then
    ok "live settings.theme=$th"
    if [[ "$th" == "dark" ]]; then
      bad "live settings.theme still dark (expected atelier after migration)"
    fi
  else
    bad "live settings.theme unexpected: ${th:-empty}"
  fi
  if curl -fsS -m 2 http://127.0.0.1:7910/api/desk >/dev/null 2>&1; then
    ok "live GET /api/desk"
  else
    bad "live GET /api/desk failed (is server restarted with desk routes?)"
  fi
else
  say "  skip live host (not running on :7910)"
fi

say ""
if [[ "$fail" -ne 0 ]]; then
  say "verify-craft: FAILED"
  exit 1
fi
say "verify-craft: PASSED"
exit 0
