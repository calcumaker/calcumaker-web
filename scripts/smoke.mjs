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
  const scratch = ex.cm_scratch();
  const cap = ex.cm_scratch_cap();
  return {
    press: (r, c) => ex.cm_press(app, r, c),
    xFull: () => {
      const n = ex.cm_x_full(app, scratch, cap);
      if (n === 0 || n > cap) return "";
      return dec.decode(new Uint8Array(ex.memory.buffer, scratch, n));
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

console.log(failures === 0 ? "\nM0 GREEN — engine runs in wasm." : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
