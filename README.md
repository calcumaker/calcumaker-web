# Calcumaker Web

A **fully client-side** browser emulator of [Calcumaker 16](../calcumaker) —
running the *real* `calcumaker-core` engine (RPN + GNU MP + MPFR) compiled to
WebAssembly via **WASI**, with the multi-row 7-segment display rendered in
**SVG** and swappable skins (LED / VFD / LCD).

It is a **thin I/O binding around `calcumaker-core`**, exactly like
`calcumaker-emu` — no calculator logic lives here. See **[PLAN.md](PLAN.md)** for
the architecture, milestones, and decisions.

## Build

```sh
# 1. Cross-build GMP + MPFR for wasm (once; needs WASI_SDK_PATH set)
WASI_SDK_PATH=/opt/wasi-sdk ./third_party/build-gmp-mpfr-wasi.sh

# 2. Build the engine to wasm and drop it into the web app
./scripts/build-wasm.sh

# 3. Run the frontend
cd web && npm install && npm run dev
```

## Stack

| Layer            | Choice                                             |
|------------------|----------------------------------------------------|
| Math → WASM      | GMP + MPFR cross-built with **wasi-sdk**, static   |
| Engine           | `calcumaker-core` → `wasm32-wasip1` (path dep)     |
| Browser runtime  | `@bjorn3/browser_wasi_shim` (pure JS, no server)   |
| Display          | **SVG** 7-seg from real TM1640 bytes + CSS skins   |
| Frontend         | **Vanilla TypeScript + Vite**, Web Components      |

## License

AGPL-3.0 (matches the firmware; compatible with LGPLv3 GMP/MPFR).
