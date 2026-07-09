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

console.log(failures === 0 ? "\nM0 GREEN — engine runs in wasm." : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
