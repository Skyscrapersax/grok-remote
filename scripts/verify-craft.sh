#!/usr/bin/env bash
# verify-craft — fail on SaaS drift / theme default regression / craft markers missing
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
fail=0

# Prefer rg if present; else grep -E
if command -v rg >/dev/null 2>&1; then
  search() { rg -n "$@" ; }
  search_q() { rg -n "$@" >/dev/null 2>&1; }
else
  search() { grep -REn "$@" ; }
  search_q() { grep -REn "$@" >/dev/null 2>&1; }
fi

say() { printf '%s\n' "$*"; }
ok() { say "  OK  $*"; }
bad() { say "  FAIL $*"; fail=1; }

say "== craft desk static gates =="

if search "border-radius:[[:space:]]*(8|10|12|14|16|22|999)px" src/styles/premium.css src/styles/craft-layer.css 2>/dev/null | head -5 | grep -q .; then
  bad "soft SaaS radii found in craft CSS"
  search "border-radius:[[:space:]]*(8|10|12|14|16|22|999)px" src/styles/premium.css src/styles/craft-layer.css 2>/dev/null | head -5 || true
else
  ok "no soft radii in premium/craft-layer"
fi

if search "rgba\([[:space:]]*255[[:space:]]*,[[:space:]]*255[[:space:]]*,[[:space:]]*255" src/styles/premium.css src/styles/craft-layer.css 2>/dev/null | head -5 | grep -q .; then
  bad "cool-white rgba found in craft CSS"
else
  ok "no cool-white hovers in craft CSS"
fi

if grep -E "theme:[[:space:]]*'dark'" lib/settings.ts >/dev/null 2>&1; then
  bad "lib/settings.ts still defaults theme to dark"
else
  ok "server settings default is not dark"
fi
if grep -E "theme:[[:space:]]*'atelier'" lib/settings.ts >/dev/null 2>&1; then
  ok "server settings default atelier"
else
  bad "lib/settings.ts missing theme: 'atelier' default"
fi
if grep -E "DEFAULT_THEME[[:space:]]*=[[:space:]]*'atelier'" src/lib/themes.ts >/dev/null 2>&1; then
  ok "client DEFAULT_THEME atelier"
else
  bad "client DEFAULT_THEME is not atelier"
fi

if grep -F 'data-theme="atelier"' index.html >/dev/null 2>&1; then
  ok "index.html data-theme=atelier"
else
  bad 'index.html missing data-theme="atelier"'
fi
if grep -F 'data-shell="atelier"' index.html >/dev/null 2>&1; then
  ok "index.html data-shell=atelier"
else
  bad 'index.html missing data-shell="atelier"'
fi

for f in src/lib/desk-furniture.ts src/lib/desk-keys.ts src/styles/premium.css lib/desk.ts docs/craft-desk-100-plan.md scripts/verify-craft.sh; do
  if [[ -f "$f" ]]; then ok "present $f"; else bad "missing $f"; fi
done

if curl -fsS -m 2 http://127.0.0.1:7910/api/health >/dev/null 2>&1; then
  ok "live /api/health"
  th=$(curl -fsS -m 2 http://127.0.0.1:7910/api/settings 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("theme",""))' 2>/dev/null || true)
  if [[ -z "$th" ]]; then
    bad "live settings.theme empty"
  elif [[ "$th" == "dark" ]]; then
    bad "live settings.theme still dark (expected atelier after migration)"
  else
    ok "live settings.theme=$th"
  fi
  if curl -fsS -m 2 http://127.0.0.1:7910/api/desk >/dev/null 2>&1; then
    ok "live GET /api/desk"
  else
    bad "live GET /api/desk failed"
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
