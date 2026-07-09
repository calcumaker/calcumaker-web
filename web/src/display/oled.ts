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

// Physical geometry of the 0.91" SSD1306 module, so the bezel is real rather
// than a guess: the board is 30 x 11.5 mm and its active glass 22.38 x 5.58 mm.
// The active area is therefore 74.6% of the module's width and 48.5% of its
// height — a lot of dark bezel, which is why the panel reads as a small inset.
const MODULE_MM = { w: 30, h: 11.5 };
const ACTIVE_MM = { w: 22.38, h: 5.58 };
/** One 7-segment digit is 0.56" = 14.22 mm tall; styles.css sizes from this. */
export const MODULE_H_PER_DIGIT = MODULE_MM.h / 14.22; // ~0.809

const ACTIVE_W = OLED_COLS * DOT;
const ACTIVE_H = OLED_ROWS * DOT;
const W = Math.round(ACTIVE_W * (MODULE_MM.w / ACTIVE_MM.w));
const H = Math.round(ACTIVE_H * (MODULE_MM.h / ACTIVE_MM.h));
const OFF_X = Math.round((W - ACTIVE_W) / 2);
const OFF_Y = Math.round((H - ACTIVE_H) / 2);

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
    ctx.fillStyle = "#0a0c11"; // module bezel / PCB
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#02040a"; // unlit glass (the active area)
    ctx.fillRect(OFF_X, OFF_Y, ACTIVE_W, ACTIVE_H);

    // Unlit pixels: barely-there grid, the way a real OLED's dark pixels read.
    ctx.fillStyle = "rgba(140,170,210,0.028)";
    for (let y = 0; y < OLED_ROWS; y++) {
      for (let x = 0; x < OLED_COLS; x++) {
        if (grid[y][x]) continue;
        ctx.fillRect(OFF_X + x * DOT, OFF_Y + y * DOT, DOT - 1, DOT - 1);
      }
    }

    // Lit pixels: cold-white SSD1306, deliberately dim — this is a small status
    // inset beside the display, not a second display competing with it.
    ctx.shadowBlur = DOT * 0.5;
    ctx.shadowColor = "rgba(150,190,230,0.45)";
    ctx.fillStyle = "#9db9d6";
    for (let y = 0; y < OLED_ROWS; y++) {
      for (let x = 0; x < OLED_COLS; x++) {
        if (!grid[y][x]) continue;
        ctx.fillRect(OFF_X + x * DOT, OFF_Y + y * DOT, DOT - 1, DOT - 1);
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
