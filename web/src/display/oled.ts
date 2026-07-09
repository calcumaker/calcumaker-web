// Aux OLED module: the 0.91" 128×32 SSD1306 that sockets next to the main
// display. Monochrome, driven with the same 5×7 font the matrix uses — at a 6 px
// pitch and 8 px row height, 128×32 is exactly 21 characters × 4 rows, which is
// precisely the shape of `App::aux_lines()` (4 lines × 21 chars, see app.rs).
//
// So this is not a text mock-up in a browser font: it is the real pixel grid the
// panel would light, blitted with the real glyphs.

import { glyph5x7 } from "./font5x7";

export const OLED_COLS = 128;
export const OLED_ROWS = 32;
export const OLED_CHARS = 21; // 21 × 6px pitch = 126px of the 128
export const OLED_LINES = 4; //  4 × 8px rows  =  32px

const PITCH = 6; // 5 glyph columns + 1 gap
const ROW_H = 8; // 7 glyph rows + 1 gap

const DOT = 6; // backing-store px per OLED pixel
const MARGIN = 2; // OLED px of dark glass around the active area (a real bezel)
const W = (OLED_COLS + MARGIN * 2) * DOT;
const H = (OLED_ROWS + MARGIN * 2) * DOT;
const OFF = MARGIN * DOT;

export interface Oled {
  el: HTMLElement;
  update(lines: string[]): void;
}

/** Blit `lines` into a 128×32 lit-pixel grid, exactly as the panel driver would. */
function litGrid(lines: string[]): boolean[][] {
  const grid = Array.from({ length: OLED_ROWS }, () => new Array<boolean>(OLED_COLS).fill(false));
  for (let r = 0; r < OLED_LINES; r++) {
    let x = 0;
    for (const ch of (lines[r] ?? "").slice(0, OLED_CHARS)) {
      const g = glyph5x7(ch);
      for (let col = 0; col < 5; col++) {
        for (let ry = 0; ry < 7; ry++) {
          if (g[col] & (1 << ry)) {
            const px = x + col, py = r * ROW_H + ry;
            if (px < OLED_COLS && py < OLED_ROWS) grid[py][px] = true;
          }
        }
      }
      x += PITCH;
      if (x >= OLED_COLS) break;
    }
  }
  return grid;
}

export function createOled(): Oled {
  const el = document.createElement("div");
  el.className = "oled";
  el.setAttribute("role", "img");

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  el.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;

  function draw(lines: string[]) {
    const grid = litGrid(lines);
    ctx.fillStyle = "#04070c"; // unlit glass
    ctx.fillRect(0, 0, W, H);

    // Unlit pixels: barely-there grid, the way a real OLED's dark pixels read.
    ctx.fillStyle = "rgba(150,180,220,0.045)";
    for (let y = 0; y < OLED_ROWS; y++) {
      for (let x = 0; x < OLED_COLS; x++) {
        if (grid[y][x]) continue;
        ctx.fillRect(OFF + x * DOT, OFF + y * DOT, DOT - 1, DOT - 1);
      }
    }

    // Lit pixels: the classic cold-white SSD1306, with a little bloom.
    ctx.shadowBlur = DOT * 0.9;
    ctx.shadowColor = "rgba(190,225,255,0.85)";
    ctx.fillStyle = "#dceaff";
    for (let y = 0; y < OLED_ROWS; y++) {
      for (let x = 0; x < OLED_COLS; x++) {
        if (!grid[y][x]) continue;
        ctx.fillRect(OFF + x * DOT, OFF + y * DOT, DOT - 1, DOT - 1);
      }
    }
    ctx.shadowBlur = 0;
  }

  draw(["", "", "", ""]);

  return {
    el,
    update(lines) {
      draw(lines);
      // Screen readers get the text; the canvas is just how it's drawn.
      el.setAttribute("aria-label", `Aux OLED: ${lines.filter(Boolean).join(". ")}`);
    },
  };
}
