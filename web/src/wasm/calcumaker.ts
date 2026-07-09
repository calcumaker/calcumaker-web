// Typed wrapper around the calcumaker-wasm exports.
//
// Loads the WASI module (GMP/MPFR + calcumaker-core) with a pure-JS shim and
// hides the pointer/linear-memory arithmetic. This is the browser's equivalent
// of what calcumaker-emu does with a live `App`.
//
// NOTE: requires the built module at ./calcumaker_wasm.wasm — produced by
// `scripts/build-wasm.sh` after M0 (wasi-sdk GMP/MPFR + cargo wasm build).

import { WASI, File, OpenFile, ConsoleStdout } from "@bjorn3/browser_wasi_shim";

// Display geometry — mirrors calcumaker_core::seg7 (asserted in the Rust binding).
export const DISPLAY_ROWS = 3;
export const DIGITS_PER_ROW = 16;
const SEG_BYTES = DISPLAY_ROWS * DIGITS_PER_ROW; // 48

interface Exports {
  memory: WebAssembly.Memory;
  cm_new(prec: number): number;
  cm_free(app: number): void;
  cm_press(app: number, row: number, col: number): void;
  cm_press_shift(app: number, which: number): void;
  cm_reseed(app: number, hi: number, lo: number): void;
  cm_seg_rows(app: number, out: number): void;
  cm_shift(app: number): number;
  // String getters fill an internal growable buffer and return its byte length;
  // the bytes live at cm_out_ptr(). Values are unbounded (500! is >1000 digits),
  // so they must not be capped.
  cm_aux_line(app: number, idx: number): number;
  cm_text_row(app: number, idx: number): number;
  cm_x_full(app: number): number;
  cm_message(app: number): number;
  cm_num_personalities(): number;
  cm_set_keymap(app: number, idx: number): void;
  cm_keymap_name(app: number): number;
  cm_key_label(app: number, layer: number, row: number, col: number): number;
  cm_out_ptr(): number;
  // Fixed scratch buffer, used only for the 48 segment bytes.
  cm_scratch(): number;
  cm_scratch_cap(): number;
}

/** Key legend layer: base face, f (gold) shift, g (blue) shift. */
export type Layer = 0 | 1 | 2;

export type Shift = "none" | "f" | "g";

export class Calcumaker {
  private app: number;
  private scratch: number;
  private dec = new TextDecoder();

  private constructor(private ex: Exports, prec: number) {
    this.app = ex.cm_new(prec);
    this.scratch = ex.cm_scratch();
    // The no_std core can't reach entropy, so frontends seed RAN# at startup or
    // it replays the same sequence every page load. SEED still gives repeatable
    // runs on demand.
    const e = crypto.getRandomValues(new Uint32Array(2));
    ex.cm_reseed(this.app, e[0], e[1]);
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
    // The shim types `initialize` against its own instance shape; ours is a
    // reactor module built by rustc. The boundary is deliberately untyped here
    // and re-typed as `Exports` below, which is the contract we actually rely on.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  auxLine(i: number): string { return this.readStr(this.ex.cm_aux_line(this.app, i)); }
  xFull(): string { return this.readStr(this.ex.cm_x_full(this.app)); }
  message(): string { return this.readStr(this.ex.cm_message(this.app)); }

  /** ASCII text for display row `i` — what the RGB dot-matrix module renders. */
  textRow(i: number): string { return this.readStr(this.ex.cm_text_row(this.app, i)); }

  // Personalities (16C / SCI / FIN) and key legends — straight from the engine's
  // keys.rs tables, so the faceplate never drifts from the real keymap.
  numPersonalities(): number { return this.ex.cm_num_personalities(); }
  setKeymap(idx: number) { this.ex.cm_set_keymap(this.app, idx); }
  keymapName(): string { return this.readStr(this.ex.cm_keymap_name(this.app)); }
  keyLabel(layer: Layer, row: number, col: number): string {
    return this.readStr(this.ex.cm_key_label(this.app, layer, row, col));
  }

  /**
   * Decode `len` bytes from the engine's output buffer. Values are unbounded
   * (500! is >1000 digits), so nothing is truncated. Both `cm_out_ptr()` and
   * `memory.buffer` are read AFTER the getter ran: the buffer may have
   * reallocated and wasm memory may have grown, detaching any earlier view.
   */
  private readStr(len: number): string {
    if (len === 0) return "";
    return this.dec.decode(new Uint8Array(this.ex.memory.buffer, this.ex.cm_out_ptr(), len));
  }
}
