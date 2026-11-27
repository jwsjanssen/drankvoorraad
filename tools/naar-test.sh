#!/bin/bash
# Zet de tak 'test' op de testsite: https://jwsjanssen.github.io/kadehoreca-test/
# De testsite is een losse repo zonder geschiedenis: elke keer één verse commit, zonder het CNAME-bestand
# (dat hoort alleen bij de echte site). Alleen wat gecommit is gaat mee.
#   tools/naar-test.sh          de tak test
#   tools/naar-test.sh main     een andere tak
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
ref="${1:-test}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git -C "$repo" archive "$ref" | tar -x -C "$tmp"
rm -f "$tmp/CNAME"
msg="Testversie: $(git -C "$repo" log -1 --format='%h %s' "$ref")"
git -C "$tmp" init -q -b main
git -C "$tmp" add -A
git -C "$tmp" commit -q -m "$msg"
git -C "$tmp" push -q --force https://github.com/jwsjanssen/kadehoreca-test.git main
echo "Op de testsite gezet: $msg"
