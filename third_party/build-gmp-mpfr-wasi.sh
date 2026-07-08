#!/usr/bin/env bash
# Cross-build GNU MP + MPFR for wasm32-wasi with wasi-sdk into vendor/wasi/.
#
# Prereqs:
#   - wasi-sdk installed; set WASI_SDK_PATH (e.g. /opt/wasi-sdk).
#   - curl + tar + make.
#
# Output:
#   vendor/wasi/lib/{libgmp,libmpfr}.a   (linked by crates/calcumaker-wasm/build.rs)
#   vendor/wasi/include/{gmp,mpfr}.h
#
# NOTE (M0): the flags below are the expected recipe for a freestanding wasm
# libc. GMP has no wasm assembly, so --disable-assembly is mandatory; wasm's
# small stack means alloca must go through malloc. Expect to iterate here — this
# is the project's one genuine unknown. Mirrors the discipline already used to
# cross-build GMP/MPFR for the bare-metal STM32 target.
set -euo pipefail

: "${WASI_SDK_PATH:?set WASI_SDK_PATH to your wasi-sdk install (e.g. /opt/wasi-sdk)}"
GMP_VERSION="${GMP_VERSION:-6.3.0}"
MPFR_VERSION="${MPFR_VERSION:-4.2.1}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PREFIX="$ROOT/vendor/wasi"
WORK="$ROOT/vendor/build"
mkdir -p "$PREFIX" "$WORK"

export CC="$WASI_SDK_PATH/bin/clang"
export AR="$WASI_SDK_PATH/bin/llvm-ar"
export RANLIB="$WASI_SDK_PATH/bin/llvm-ranlib"
export CFLAGS="--target=wasm32-wasi --sysroot=$WASI_SDK_PATH/share/wasi-sysroot -O2 -D_WASI_EMULATED_SIGNAL"
export LDFLAGS="-lwasi-emulated-signal"

fetch() { # url
  local f="$WORK/$(basename "$1")"
  [ -f "$f" ] || curl -fL "$1" -o "$f"
  tar -C "$WORK" -xf "$f"
}

echo ">> GMP $GMP_VERSION"
fetch "https://gmplib.org/download/gmp/gmp-$GMP_VERSION.tar.xz"
( cd "$WORK/gmp-$GMP_VERSION"
  ./configure --host=wasm32-wasi --prefix="$PREFIX" \
    --disable-shared --enable-static \
    --disable-assembly --enable-alloca=malloc-reentrant
  make -j"$(nproc)" && make install )

echo ">> MPFR $MPFR_VERSION"
fetch "https://www.mpfr.org/mpfr-$MPFR_VERSION/mpfr-$MPFR_VERSION.tar.xz"
( cd "$WORK/mpfr-$MPFR_VERSION"
  ./configure --host=wasm32-wasi --prefix="$PREFIX" \
    --with-gmp="$PREFIX" --disable-shared --enable-static
  make -j"$(nproc)" && make install )

# GMP's errno.o references raise(); vendor wasi's emulated-signal archive so the
# final wasm link (crates/calcumaker-wasm/build.rs) can resolve it.
cp "$WASI_SDK_PATH/share/wasi-sysroot/lib/wasm32-wasip1/libwasi-emulated-signal.a" "$PREFIX/lib/"

echo ">> done: $PREFIX/lib/{libgmp,libmpfr,libwasi-emulated-signal}.a"
