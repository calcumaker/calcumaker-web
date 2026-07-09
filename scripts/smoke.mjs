// M0 proof-of-life: load the wasm engine (calcumaker-core + GMP + MPFR) under
// Node's WASI and drive REAL matrix presses through the whole pipeline
// (keymap -> App -> Calc -> GMP/MPFR -> display). No browser needed.
//
//   node scripts/smoke.mjs
//
// 16C base-layer matrix cells (row,col) from calcumaker-core keys::BASE:
//   2=(3,7) 3=(3,8) ENTER=(4,5) +=(4,9) SQRT=(0,4)
import { readFile } from "node:fs/promises";
import { WASI } from "node:wasi";

const wasmPath = new URL("../web/src/wasm/calcumaker_wasm.wasm", import.meta.url);

async function makeInstance() {
  const wasi = new WASI({ version: "preview1", args: [], env: {} });
  const bytes = await readFile(wasmPath);
  const mod = await WebAssembly.compile(bytes);
  const instance = await WebAssembly.instantiate(mod, {
    wasi_snapshot_preview1: wasi.wasiImport,
  });
  wasi.initialize(instance); // reactor module (no _start)
  return instance.exports;
}

const dec = new TextDecoder();

function newCalc(ex, prec = 256) {
  const app = ex.cm_new(prec);
  return {
    press: (r, c) => ex.cm_press(app, r, c),
    pressShift: (which) => ex.cm_press_shift(app, which === "f" ? 0 : 1),
    setKeymap: (i) => ex.cm_set_keymap(app, i),
    reseed: (hi, lo) => ex.cm_reseed(app, hi, lo),
    textRow: (i) => { const n = ex.cm_text_row(app, i);
      return n === 0 ? "" : dec.decode(new Uint8Array(ex.memory.buffer, ex.cm_out_ptr(), n)); },
    segRow: (i) => { const p = ex.cm_scratch(); ex.cm_seg_rows(app, p);
      return [...new Uint8Array(ex.memory.buffer, p, 48).slice(i * 16, i * 16 + 16)]; },
    winR: () => { ex.cm_press(app, 4, 1); ex.cm_press(app, 2, 5); },
    xFull: () => {
      // Getter fills an internal growable buffer and returns its length; read the
      // pointer AFTER the call (the Vec may realloc / memory may grow).
      const n = ex.cm_x_full(app);
      if (n === 0) return "";
      return dec.decode(new Uint8Array(ex.memory.buffer, ex.cm_out_ptr(), n));
    },
    free: () => ex.cm_free(app),
  };
}

let failures = 0;
function check(label, got, want) {
  const ok = got === want || (typeof want === "function" && want(got));
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(got)}`);
  if (!ok) failures++;
}

const ex = await makeInstance();

// GMP integer path: 2 ENTER 3 + -> 5
{
  const c = newCalc(ex);
  c.press(3, 7); // 2
  c.press(4, 5); // ENTER
  c.press(3, 8); // 3
  c.press(4, 9); // +
  check("GMP  2 ENTER 3 +", c.xFull(), "5");
  c.free();
}

// MPFR real path: entering a decimal point forces real entry, so 2.0 SQRT
// exercises MPFR's correctly-rounded sqrt -> 1.41421356...
{
  const c = newCalc(ex);
  c.press(3, 7); // 2
  c.press(4, 7); // . (Dot)
  c.press(4, 6); // 0
  c.press(0, 4); // SQRT
  check("MPFR 2.0 SQRT", c.xFull(), (s) => s.startsWith("1.41421356"));
}

// Unbounded strings: 500! is 1135 chars. A fixed 256-byte transfer buffer used
// to silently return "" for anything longer, so the status line went blank and
// copy-to-clipboard copied nothing. Guard the whole round-trip.
{
  const c = newCalc(ex);
  c.press(2, 7); // 5
  c.press(4, 6); // 0
  c.press(4, 6); // 0
  c.press(4, 1); // ShiftG cell — resolves the next press through the g layer
  c.press(2, 6); // g-layer: x!  => 500!
  const x = c.xFull();
  check(`big value round-trips (500! = ${x.length} chars, not truncated)`, x.length, 1135);
  check("big value is correct", x.slice(0, 22), "1220136825991110068701");
  c.free();
}

// RAN# must be seeded by the frontend: the no_std core can't reach entropy, so
// without cm_reseed every page load replays the same sequence (calcumaker@5b75275).
function ran(seedHi, seedLo) {
  const c = newCalc(ex);
  c.reseed(seedHi, seedLo);
  c.setKeymap(2); // SCI — RAN# lives at SCI_LAYER_G[2][2]
  c.press(4, 1);  // g shift
  c.press(2, 2);  // RAN#
  const x = c.xFull();
  c.free();
  return x;
}
{
  const a = ran(1, 1), b = ran(2, 2), a2 = ran(1, 1);
  check("RAN# is produced", a.length > 0, true);
  check(`different seeds give different RAN# (${a.slice(0, 8)} vs ${b.slice(0, 8)})`, a !== b, true);
  check("same seed is reproducible (SEED key contract)", a, a2);
}

// Display windowing (calcumaker@c29d754). text_rows() is the *displayed* row, so
// the dot-matrix module sees the same 15 digits + `>` overflow marker the glass
// does, and the window keys scroll both. Before this, the matrix silently
// truncated and could not scroll at all.
const OVERFLOW = 0x0f;
const X = 2; // bottom row
{
  const c = newCalc(ex);
  c.press(3, 6); c.press(3, 7); c.press(4, 5); // 4 2 ENTER — fits the row
  check("a fitting value carries no marker", c.textRow(X).includes(">"), false);
  check("…and no overflow byte on the glass", c.segRow(X)[15] === OVERFLOW, false);
  c.free();
}
{
  const c = newCalc(ex);
  c.press(2, 7); c.press(4, 6); c.press(4, 6); c.press(4, 1); c.press(2, 6); // 500 g x!
  const t0 = c.textRow(X), s0 = c.segRow(X);
  check(`matrix row is windowed to the row width (${t0.length} chars)`, t0.length, 16);
  check(`matrix row carries the overflow marker (${JSON.stringify(t0.slice(-4))})`, t0.endsWith(">"), true);
  check("glass agrees: last cell is the overflow byte", s0[15], OVERFLOW);

  c.winR();
  const t1 = c.textRow(X), s1 = c.segRow(X);
  check("the window scrolls the matrix text too", t1 !== t0, true);
  check("scrolled window still marks more to the right", t1.endsWith(">"), true);
  check("glass agrees on the scrolled window", s1[15], OVERFLOW);

  for (let i = 0; i < 200; i++) c.winR(); // clamps at the last window
  const tN = c.textRow(X), sN = c.segRow(X);
  check("last window has nothing to its right", tN.includes(">"), false);
  check("…and no overflow byte", sN[15] === OVERFLOW, false);
  c.free();
}

console.log(failures === 0 ? "\nM0 GREEN — engine runs in wasm." : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
