#!/usr/bin/env bash
# Build calcumaker-wasm to wasm32-wasip1 and drop the module into the web app.
#
# Prereq: vendor/wasi/lib/{libgmp,libmpfr}.a exist
#         (run third_party/build-gmp-mpfr-wasi.sh once).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "$ROOT/vendor/wasi/lib/libgmp.a" ]; then
  echo "!! vendor/wasi/lib/libgmp.a missing — run third_party/build-gmp-mpfr-wasi.sh first" >&2
  exit 1
fi

cargo build --release --target wasm32-wasip1 --manifest-path "$ROOT/Cargo.toml"

OUT="$ROOT/web/src/wasm/calcumaker_wasm.wasm"
cp "$ROOT/target/wasm32-wasip1/release/calcumaker_wasm.wasm" "$OUT"
echo ">> wrote $OUT"
