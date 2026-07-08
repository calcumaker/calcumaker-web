#!/usr/bin/env bash
# Package the static bundle into portable, version-stamped archives you can hand
# to any host (upload to a CDN, attach to a GitHub Release, drag-drop to Netlify/
# Cloudflare, etc). Builds a fresh dist first.
#
#   ./scripts/package-dist.sh
# ->  dist-artifacts/calcumaker-web-<sha>.tar.gz
#     dist-artifacts/calcumaker-web-<sha>.zip
#     dist-artifacts/calcumaker-web-<sha>.sha256
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Fresh, verified static bundle in web/dist/.
"$ROOT/scripts/build-dist.sh"

SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo nogit)"
OUT="$ROOT/dist-artifacts"
mkdir -p "$OUT"
NAME="calcumaker-web-$SHA"

tar -C "$ROOT/web/dist" -czf "$OUT/$NAME.tar.gz" .
if command -v zip >/dev/null; then
  ( cd "$ROOT/web/dist" && zip -qr "$OUT/$NAME.zip" . )
fi

( cd "$OUT" && sha256sum "$NAME".* > "$NAME.sha256" )

echo ""
echo ">> artifacts in $OUT/:"
ls -1 "$OUT" | sed 's/^/   /'
echo "   (contents are the dist tree at repo root — extract and serve as-is)"
