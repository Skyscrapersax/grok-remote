#!/usr/bin/env bash
# node-pty ships spawn-helper without the execute bit on some npm installs
# (posix_spawnp fails → embedded Term tabs cannot open PTYs).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
shopt -s nullglob
helpers=("$ROOT"/node_modules/node-pty/prebuilds/*/spawn-helper)
if ((${#helpers[@]} == 0)); then
  exit 0
fi
chmod +x "${helpers[@]}"
echo "[fix-node-pty-perms] executable: ${#helpers[@]} spawn-helper(s)"
