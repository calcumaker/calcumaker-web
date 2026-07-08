# Calcumaker Web — Plan

A **fully client-side** web emulator of **Calcumaker 16**. It runs the *real*
`calcumaker-core` engine — the same RPN + arbitrary-precision math (GNU MP +
MPFR) the firmware and terminal emulator run — compiled to WebAssembly, and
renders the multi-row 7-segment display in the browser with swappable skins.

> Design stance: this repo is a **thin I/O binding around `calcumaker-core`**,
> exactly like `calcumaker-emu` and `calcumaker-fw` are. No calculator logic
> lives here. No second math backend. The web app just drives `App` and paints
> the segment bytes it produces.

## The one hard problem, and how we solve it

`calcumaker-core` → `gmp-mpfr-nostd` → **GNU MP + MPFR** (C libraries). Those are
the whole point (correctly-rounded transcendentals, exact bignum), and the
project rule is **single math path, no pure-Rust fallback**. So a faithful port
must compile GMP + MPFR to WebAssembly and link them with the Rust core.

**Chosen toolchain: WASI (wasi-sdk).**
- Build GMP + MPFR from source with **wasi-sdk** (clang + wasi-libc) →
  `libgmp.a`, `libmpfr.a` for `wasm32-wasi`.
- Compile `calcumaker-core` + `gmp-mpfr-nostd` + a new thin `calcumaker-wasm`
  crate to the **`wasm32-wasip1`** Rust target; the final link pulls in the two
  static archives.
- Run in the browser via a tiny pure-JS **WASI shim**
  (`@bjorn3/browser_wasi_shim`). GMP/MPFR are pure compute — the only WASI
  imports come from wasi-libc (`proc_exit`, maybe `random_get`/`clock_time_get`),
  all of which the shim provides. No server, no network at runtime.

This mirrors what the team already does for bare metal: GMP/MPFR are cross-built
for the STM32 against newlib. WASM is just another freestanding-ish target.

## The API boundary (already tiny and proven by the emu)

`calcumaker-emu` drives the whole device through this surface — the web app uses
the same one:

```
App::new(prec)                          // 256-bit default working precision
app.press(row, col)                     // physical matrix cell (5×10)
app.press_key(Key)                      // or a resolved key (e.g. ShiftF/ShiftG)
app.seg_rows() -> [[u8;16]; 3]          // REAL TM1640 segment bytes, 3 rows
app.aux_lines() -> [String;4]           // aux OLED panel text
app.shift() -> Option<char>             // 'f'/'g' annunciator
app.message() -> Option<&str>           // status/error line
app.x_full() -> String                  // untruncated X (for a11y / copy)
app.keymap() / app.set_keymap(km)       // 16C / SCI / FIN personalities
```

`calcumaker-wasm` re-exports this as a handful of `#[no_mangle] extern "C"`
functions over an opaque `App` handle; a TS wrapper hides the pointer/memory
arithmetic behind a `Calcumaker` class.

## Repository layout

```
calcumaker-web/
├── PLAN.md                     # this file
├── Cargo.toml                  # Rust workspace
├── rust-toolchain.toml         # pins wasm32-wasip1
├── crates/
│   └── calcumaker-wasm/        # thin binding → cdylib, wasm32-wasip1
│       ├── Cargo.toml          #   path-deps ../calcumaker/firmware/{core,gmp-mpfr-nostd}
│       ├── build.rs            #   link vendor/wasi/lib/{libgmp,libmpfr}.a
│       └── src/lib.rs          #   C-ABI exports mirroring the emu
├── third_party/
│   └── build-gmp-mpfr-wasi.sh  # wasi-sdk cross-build → vendor/wasi/
├── vendor/wasi/                # built .a + headers (gitignored)
├── scripts/
│   └── build-wasm.sh           # cargo build + copy .wasm into web/src/wasm/
└── web/                        # Vite + TypeScript frontend (vanilla + Web Components)
    ├── index.html
    ├── package.json · vite.config.ts · tsconfig.json
    └── src/
        ├── main.ts
        ├── wasm/               # WASI-shim loader + typed Calcumaker wrapper
        ├── display/            # SVG 7-seg renderer + skins (LED/VFD/LCD)
        ├── keypad/             # 5×10 Cherry-MX faceplate + keymap + phys-kbd input
        └── styles/
```

**Cross-repo coupling:** `calcumaker-wasm` uses **path dependencies** to
`../calcumaker/firmware/calcumaker-core` and `.../gmp-mpfr-nostd` (core stays
untouched and unforked). If we later want `calcumaker-web` to build standalone,
promote that to a git submodule — noted, not needed for dev.

## Milestones

### M0 — Toolchain & proof of life  ✅ DONE (2026-07-08)
- ✅ `wasm32-wasip1` Rust target + **wasi-sdk-33** (`~/.local/opt/wasi-sdk-33.0-x86_64-linux`).
- ✅ GMP 6.3.0 + MPFR 4.2.1 cross-built under wasi-sdk → `vendor/wasi/lib/*.a`.
  Working flags: `--host=wasm32-wasi --disable-assembly
  --enable-alloca=malloc-reentrant` (NOT `=malloc`), static only. GMP's
  `errno.o` needs `raise()` → vendor `libwasi-emulated-signal.a` and link it at
  the final link.
- ✅ `calcumaker-wasm` (592 KB module) links the archives; `wasm32-wasip1`.
- ✅ Node WASI smoke (`scripts/smoke.mjs`) drives real matrix presses:
  GMP `2 ENTER 3 +` → `5`; MPFR `2.0 √` → `1.41421356…` (256-bit, correct).
  **Project proven viable.**

### M1 — Wasm binding crate + TS wrapper
- Full C-ABI: `cm_new/cm_free`, `cm_press`, `cm_press_key`, `cm_seg_rows`,
  `cm_shift`, `cm_message`, `cm_aux_line`, `cm_x_full`, `cm_set_keymap`.
- `web/src/wasm/`: load module with `@bjorn3/browser_wasi_shim`, typed
  `Calcumaker` class reading segment bytes / strings out of linear memory.

### M2 — SVG 7-segment display
- Digit component: 7 segment polygons + dp, on/off from the seg byte.
- 3 rows × 16 digits; row/column geometry matching the real board.
- Annunciators (f, g, C, G, lo-bat) + the 4-line aux OLED panel from
  `aux_lines()`. First skin: **red LED** (default), with CSS glow.

### M3 — Keypad faceplate + input
- Render the 5×10 Cherry-MX layout from `keys.rs` (base + f/g layer legends).
- Pointer/click → `press(row,col)`; **physical keyboard** mapping ported from
  the emu's `HOST_KEYS` table; f/g shift handling.
- Personality switch (16C / SCI / FIN) via `set_keymap`.

### M4 — Display skins
- Theme system driven purely by CSS custom properties over the SVG:
  **red LED / green LED / amber LED / cyan VFD / gray LCD**, glow on/off.
- Skin switcher UI. (Optional later: a WebGL bloom/CRT layer over the SVG.)

### M5 — Polish & deploy
- Responsive faceplate, copy-X, keyboard help overlay, precision setting.
- Static build; pick a host (GitHub Pages / Cloudflare Pages). All client-side.

## Open items to confirm as we go
- GMP/MPFR wasi-sdk build flags (M0 will settle these empirically).
- Allocator: let GMP/MPFR use wasi-libc `malloc` (they're linked against it);
  Rust owns Rust data; no cross-allocator frees across the FFI. Revisit only if
  M0 shows a problem.
- Whether to keep path-deps or add a submodule for standalone builds.
</content>
