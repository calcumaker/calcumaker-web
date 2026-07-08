#!/usr/bin/env bash
# One-shot production build: engine wasm + static web bundle -> web/dist/.
#
# The result is fully self-contained and client-side — copy web/dist/ to any
# static host. See README "Ship a static build".
#
# Prereq: vendor/wasi/lib/*.a exist (run third_party/build-gmp-mpfr-wasi.sh once).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 1. Engine -> wasm, dropped into web/src/wasm/ (build-wasm.sh checks vendor libs).
"$ROOT/scripts/build-wasm.sh"

# 2. Web production bundle (tsc typecheck + vite build).
cd "$ROOT/web"
[ -d node_modules ] || npm install
npm run build

echo ""
echo ">> static bundle ready: $ROOT/web/dist/"
echo "   preview locally:  (cd web && npm run preview)"
echo "   or:               python3 -m http.server -d web/dist 8080"
