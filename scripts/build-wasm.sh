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

# The engine is a path dependency on the sibling repo, so a local build silently
# takes whatever is checked out there. CI builds the SHA in engine.lock; warn when
# they differ so a local result can't quietly disagree with what will ship.
#
# Only the paths we compile count. calcumaker's HEAD moves for hardware and docs
# commits too, and warning about those would train everyone to ignore the warning.
# Same filter as .github/workflows/engine-watch.yml.
ENGINE="$ROOT/../calcumaker"
ENGINE_PATHS=(
  firmware/calcumaker-core
  firmware/gmp-mpfr-nostd
  firmware/calcumaker-matrix-fw/src/font.rs
)
if [ -f "$ROOT/engine.lock" ] && [ -d "$ENGINE/.git" ]; then
  want="$(tr -d '[:space:]' < "$ROOT/engine.lock")"
  have="$(git -C "$ENGINE" rev-parse HEAD 2>/dev/null || echo unknown)"
  if [ "$want" != "$have" ]; then
    if ! git -C "$ENGINE" cat-file -e "${want}^{commit}" 2>/dev/null; then
      echo "!! engine.lock pins ${want:0:7}, which ../calcumaker doesn't have — git fetch it" >&2
    elif ! git -C "$ENGINE" diff --quiet "$want" HEAD -- "${ENGINE_PATHS[@]}"; then
      echo "!! engine drift: ../calcumaker is at ${have:0:7}, engine.lock pins ${want:0:7}" >&2
      echo "   CI will build the pinned SHA. To adopt this one: git rev-parse HEAD > engine.lock" >&2
    fi
    # else: HEAD moved, but not in anything we compile — nothing to say
  fi
fi

cargo build --release --target wasm32-wasip1 --manifest-path "$ROOT/Cargo.toml"

OUT="$ROOT/web/src/wasm/calcumaker_wasm.wasm"
cp "$ROOT/target/wasm32-wasip1/release/calcumaker_wasm.wasm" "$OUT"
echo ">> wrote $OUT"
