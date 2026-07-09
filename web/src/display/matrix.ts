// RGB dot-matrix display module (the calcumaker-matrix alternative board):
// a 96×24 addressable-LED grid rendered from the engine's text rows with a 5×7
// font. The glyph table and blit are ported verbatim from
// calcumaker-matrix-fw/src/font.rs so the web dots match the hardware pixel for
// pixel (5 columns × 7-bit column bitmaps, bit0 = top; 6 px pitch, clipped at 96).
//
// Rendered on <canvas> (2304 dots suit a pixel array + glow better than SVG).

import { glyph5x7 } from "./font5x7";

const COLS = 96;
const ROWS = 24; // 3 stack rows × 8 px
const PITCH = 6; // glyph advance (5 wide + 1 gap)
const STACK_H = 8;

// Glyphs come from the shared 5×7 table (web/src/display/font5x7.ts), which
// mirrors calcumaker-matrix-fw/src/font.rs byte-for-byte — including lowercase,
// now that the firmware carries the full ASCII range.

type Rgb = [number, number, number];
// Palettes. "rgb" mirrors the firmware's per-stack-row `tint` (green/amber/blue),
// brightened for a screen (the hardware keeps them dim only to cap LED current).
const PALETTES: Record<string, Rgb[]> = {
  rgb: [[70, 255, 110], [255, 180, 60], [80, 180, 255]],
  amber: [[255, 176, 32], [255, 176, 32], [255, 176, 32]],
  green: [[61, 255, 114], [61, 255, 114], [61, 255, 114]],
  white: [[236, 245, 255], [236, 245, 255], [236, 245, 255]],
};
export const MATRIX_PALETTES = Object.keys(PALETTES);

const DOT = 12; // logical px per LED
const W = COLS * DOT, H = ROWS * DOT, R = DOT * 0.4;

export interface Matrix {
  el: HTMLElement;
  update(textRows: string[]): void;
  setPalette(name: string): void;
}

export function createMatrix(): Matrix {
  const el = document.createElement("div");
  el.className = "matrix";
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  el.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;

  let palette = "rgb";
  let lastRows: string[] = ["", "", ""];

  // Build the lit-pixel grid from the text rows using the ported blitter.
  function litGrid(textRows: string[]): boolean[][] {
    const grid = Array.from({ length: ROWS }, () => new Array<boolean>(COLS).fill(false));
    for (let r = 0; r < 3; r++) {
      let x = 0;
      for (const ch of textRows[r] ?? "") {
        const g = glyph5x7(ch);
        for (let col = 0; col < 5; col++) {
          for (let ry = 0; ry < 7; ry++) {
            if (g[col] & (1 << ry)) {
              const px = x + col, py = r * STACK_H + ry;
              if (px < COLS && py < ROWS) grid[py][px] = true;
            }
          }
        }
        x += PITCH;
        if (x >= COLS) break;
      }
    }
    return grid;
  }

  function draw() {
    const pal = PALETTES[palette] ?? PALETTES.rgb;
    const grid = litGrid(lastRows);
    ctx.clearRect(0, 0, W, H);
    // unlit dots first (cheap, no glow), then lit dots with glow.
    ctx.fillStyle = "rgba(150,165,185,0.05)";
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (grid[y][x]) continue;
        ctx.beginPath();
        ctx.arc(x * DOT + DOT / 2, y * DOT + DOT / 2, R, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.shadowBlur = DOT * 0.9;
    for (let y = 0; y < ROWS; y++) {
      const [r, g, b] = pal[Math.floor(y / STACK_H)] ?? pal[0];
      ctx.fillStyle = ctx.shadowColor = `rgb(${r},${g},${b})`;
      for (let x = 0; x < COLS; x++) {
        if (!grid[y][x]) continue;
        ctx.beginPath();
        ctx.arc(x * DOT + DOT / 2, y * DOT + DOT / 2, R, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.shadowBlur = 0;
  }

  return {
    el,
    update(textRows) { lastRows = textRows; draw(); },
    setPalette(name) { palette = name; draw(); },
  };
}
