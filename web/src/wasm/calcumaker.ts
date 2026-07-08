// Typed wrapper around the calcumaker-wasm exports.
//
// Loads the WASI module (GMP/MPFR + calcumaker-core) with a pure-JS shim and
// hides the pointer/linear-memory arithmetic. This is the browser's equivalent
// of what calcumaker-emu does with a live `App`.
//
// NOTE: requires the built module at ./calcumaker_wasm.wasm — produced by
// `scripts/build-wasm.sh` after M0 (wasi-sdk GMP/MPFR + cargo wasm build).

import { WASI, File, OpenFile, ConsoleStdout } from "@bjorn3/browser_wasi_shim";

const SEG_BYTES = 48; // DISPLAY_ROWS(3) * DIGITS_PER_ROW(16) — asserted in Rust

interface Exports {
  memory: WebAssembly.Memory;
  cm_new(prec: number): number;
  cm_free(app: number): void;
  cm_press(app: number, row: number, col: number): void;
  cm_press_shift(app: number, which: number): void;
  cm_seg_rows(app: number, out: number): void;
  cm_shift(app: number): number;
  cm_aux_line(app: number, idx: number, out: number, cap: number): number;
  cm_x_full(app: number, out: number, cap: number): number;
  cm_message(app: number, out: number, cap: number): number;
  // Shared scratch buffer for byte/string transfers (no allocator exported).
  cm_scratch(): number;
  cm_scratch_cap(): number;
}

export type Shift = "none" | "f" | "g";

export class Calcumaker {
  private app: number;
  private scratch: number;
  private scratchCap: number;
  private dec = new TextDecoder();

  private constructor(private ex: Exports, prec: number) {
    this.app = ex.cm_new(prec);
    this.scratch = ex.cm_scratch();
    this.scratchCap = ex.cm_scratch_cap();
  }

  static async load(url = new URL("./calcumaker_wasm.wasm", import.meta.url), prec = 256) {
    const wasi = new WASI([], [], [
      new OpenFile(new File([])),
      ConsoleStdout.lineBuffered((m) => console.log("[wasm]", m)),
      ConsoleStdout.lineBuffered((m) => console.warn("[wasm]", m)),
    ]);
    const { instance } = await WebAssembly.instantiateStreaming(fetch(url), {
      wasi_snapshot_preview1: wasi.wasiImport,
    });
    wasi.initialize(instance as any);
    return new Calcumaker(instance.exports as unknown as Exports, prec);
  }

  press(row: number, col: number) { this.ex.cm_press(this.app, row, col); }
  pressShift(which: "f" | "g") { this.ex.cm_press_shift(this.app, which === "f" ? 0 : 1); }

  /** The 3×16 TM1640 segment bytes — feed straight to the SVG renderer. */
  segRows(): Uint8Array[] {
    this.ex.cm_seg_rows(this.app, this.scratch);
    const all = new Uint8Array(this.ex.memory.buffer, this.scratch, SEG_BYTES).slice();
    return [all.subarray(0, 16), all.subarray(16, 32), all.subarray(32, 48)];
  }

  shift(): Shift { return (["none", "f", "g"] as const)[this.ex.cm_shift(this.app)]; }
  auxLine(i: number): string { return this.readStr((o, c) => this.ex.cm_aux_line(this.app, i, o, c)); }
  xFull(): string { return this.readStr((o, c) => this.ex.cm_x_full(this.app, o, c)); }
  message(): string { return this.readStr((o, c) => this.ex.cm_message(this.app, o, c)); }

  private readStr(call: (out: number, cap: number) => number): string {
    const cap = this.scratchCap;
    const n = call(this.scratch, cap);
    if (n === 0 || n > cap) return "";
    return this.dec.decode(new Uint8Array(this.ex.memory.buffer, this.scratch, n));
  }
}
