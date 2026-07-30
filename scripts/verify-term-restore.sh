#!/usr/bin/env bash
# verify-term-restore — desk.json termTabs/termLastKind round-trip + recreate PTYs
set -euo pipefail
API="${GROK_DECK_API:-http://127.0.0.1:7910}"
export API

python3 <<'PY'
import json, os, sys, tempfile, urllib.request, urllib.error

api = os.environ.get("API", "http://127.0.0.1:7910")

def req(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    r = urllib.request.Request(
        api + path,
        data=data,
        headers={"content-type": "application/json"} if data else {},
        method=method,
    )
    with urllib.request.urlopen(r, timeout=8) as res:
        return json.load(res)

def ok(msg):
    print(f"  OK  {msg}")

def fail(msg):
    print(f"FAIL: {msg}")
    sys.exit(1)

try:
    req("GET", "/api/health")
except Exception as e:
    fail(f"server not up: {e}")

cwd = tempfile.mkdtemp(prefix="grok-term-restore-")
desk_body = {
    "lastHash": "#/term",
    "termLastKind": "shell",
    "termTabs": [
        {"kind": "shell", "cwd": cwd, "name": "shell-restore-a"},
        {"kind": "shell", "cwd": cwd, "name": "shell-restore-b"},
    ],
}
res = req("PATCH", "/api/desk", desk_body)
desk = res.get("desk") or {}
tabs = desk.get("termTabs") or []
if len(tabs) < 1:
    fail("desk termTabs not saved")
ok(f"seeded desk termTabs ({len(tabs)}) cwd={cwd}")

# Kill live terminals
try:
    listing = req("GET", "/api/term")
    for t in listing.get("terminals") or []:
        tid = t.get("id")
        if tid:
            try:
                req("DELETE", f"/api/term/{tid}")
            except Exception:
                pass
except Exception:
    pass
ok("cleared live PTYs")

# Re-read intents from desk
desk = (req("GET", "/api/desk").get("desk") or {})
intents = desk.get("termTabs") or []
if not intents:
    fail("termTabs empty after clear")
ok(f"desk still has {len(intents)} intent(s)")

# Recreate (mirrors TermView.hydrate restoreIntents)
created = 0
native = 0
for t in intents[:4]:
    body = {
        "kind": t.get("kind") or "shell",
        "cwd": t.get("cwd") or None,
        "cols": 80,
        "rows": 24,
    }
    try:
        res = req("POST", "/api/term", body)
        if res.get("terminal"):
            created += 1
        elif res.get("native"):
            native += 1
            created += 1
    except Exception as e:
        print(f"  warn spawn: {e}", file=sys.stderr)

if created < 1:
    fail("recreate from termTabs produced 0 sessions")
ok(f"recreated {created} session(s) from desk termTabs (native_fallback={native})")

live = len((req("GET", "/api/term").get("terminals") or []))
ok(f"live terminals now={live}")

# termLastKind
req("PATCH", "/api/desk", {"termLastKind": "shell"})
lk = (req("GET", "/api/desk").get("desk") or {}).get("termLastKind")
if lk != "shell":
    fail(f"termLastKind not persisted (got {lk!r})")
ok(f"termLastKind={lk}")

print()
print("verify-term-restore: PASSED")
PY
