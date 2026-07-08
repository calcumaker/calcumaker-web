# Calcumaker Web

A **fully client-side** browser emulator of [Calcumaker 16](../calcumaker) —
running the *real* `calcumaker-core` engine (RPN + GNU MP + MPFR + MPC) compiled
to WebAssembly via **WASI**. Two interchangeable display modules mirror the
hardware: the multi-row **7-segment** display (SVG, LED / VFD / LCD skins) and
the **96×24 RGB dot-matrix** module (canvas, 5×7 font ported from the matrix
firmware).

It is a **thin I/O binding around `calcumaker-core`**, exactly like
`calcumaker-emu` — no calculator logic lives here. See **[PLAN.md](PLAN.md)** for
the architecture, milestones, and decisions.

## Build

```sh
# 1. Cross-build GMP + MPFR for wasm (once; needs WASI_SDK_PATH set)
WASI_SDK_PATH=/opt/wasi-sdk ./third_party/build-gmp-mpfr-wasi.sh

# 2. Build the engine to wasm and drop it into the web app
./scripts/build-wasm.sh

# 3. Run the frontend (dev server)
cd web && npm install && npm run dev
```

## Ship a static build

The app is 100% client-side — no server, no runtime network. Produce the bundle
in one command (engine wasm + typecheck + Vite build):

```sh
./scripts/build-dist.sh          # -> web/dist/
```

`web/dist/` is self-contained (`index.html`, hashed `.js`/`.css`, and the
`.wasm`). Copy it to any static host. Preview it exactly as shipped:

```sh
cd web && npm run preview        # or: python3 -m http.server -d web/dist 8080
```

**Hosting requirements — minimal:**
- Serve `.wasm` as `Content-Type: application/wasm` (needed for streaming
  instantiation). GitHub/GitLab Pages, Netlify, Cloudflare Pages, Vercel, nginx,
  Caddy, and `vite preview` all do this out of the box.
- **No** cross-origin-isolation headers (COOP/COEP) required — the engine is
  single-threaded and uses no `SharedArrayBuffer`.
- Works from a subpath (e.g. project Pages at `/calcumaker-web/`): Vite `base` is
  `"./"`, so all asset URLs are relative. No SPA/rewrite rules needed — it's a
  single page.

To rebuild only after an engine (`calcumaker-core`) change, re-run
`./scripts/build-wasm.sh` then `(cd web && npm run build)`; `build-dist.sh` does
both.

## Stack

| Layer            | Choice                                             |
|------------------|----------------------------------------------------|
| Math → WASM      | GMP + MPFR + MPC cross-built with **wasi-sdk**, static |
| Engine           | `calcumaker-core` → `wasm32-wasip1` (path dep)     |
| Browser runtime  | `@bjorn3/browser_wasi_shim` (pure JS, no server)   |
| Display          | **SVG** 7-seg from real TM1640 bytes + CSS skins   |
| Frontend         | **Vanilla TypeScript + Vite**, Web Components      |

## License

AGPL-3.0 (matches the firmware; compatible with LGPLv3 GMP/MPFR).
