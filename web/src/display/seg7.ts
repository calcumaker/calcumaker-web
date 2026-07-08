// SVG 7-segment display: 3 rows × 16 digits, driven by the REAL TM1640 segment
// bytes from calcumaker-core (see core seg7.rs). One <g> per digit with 7
// segment polygons + a dp dot; we build the DOM once and just toggle the `.on`
// class per frame. Colors/glow come entirely from CSS custom properties, so a
// skin swap is a single attribute change on the faceplate — no re-render here.

import { DIGITS_PER_ROW, DISPLAY_ROWS } from "../wasm/calcumaker";

const SVGNS = "http://www.w3.org/2000/svg";

// Segment bits — must match calcumaker_core::seg7 (a..g, dp).
const SEGS = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40] as const; // a b c d e f g
const DP = 0x80;

// Digit geometry in a 100×180 local box; beveled bars meet at the corners.
const TH = 13;
const xL = 18, xR = 82, yT = 20, yM = 90, yB = 160;
const DIGIT_W = 100, DIGIT_H = 180, PITCH = 112; // gap between digit origins

function hbar(cx: number, cy: number, len: number, th = TH): string {
  const hl = len / 2, ht = th / 2;
  return `${cx - hl},${cy} ${cx - hl + ht},${cy - ht} ${cx + hl - ht},${cy - ht} ` +
    `${cx + hl},${cy} ${cx + hl - ht},${cy + ht} ${cx - hl + ht},${cy + ht}`;
}
function vbar(cx: number, cy: number, len: number, th = TH): string {
  const hl = len / 2, ht = th / 2;
  return `${cx},${cy - hl} ${cx + ht},${cy - hl + ht} ${cx + ht},${cy + hl - ht} ` +
    `${cx},${cy + hl} ${cx - ht},${cy + hl - ht} ${cx - ht},${cy - hl + ht}`;
}

// a, b, c, d, e, f, g — index-aligned with SEGS.
const SEG_POINTS = [
  hbar(50, yT, 64),          // a  top
  vbar(xR, 55, 70),          // b  top-right
  vbar(xR, 125, 70),         // c  bottom-right
  hbar(50, yB, 64),          // d  bottom
  vbar(xL, 125, 70),         // e  bottom-left
  vbar(xL, 55, 70),          // f  top-left
  hbar(50, yM, 64),          // g  middle
];

type DigitEls = { segs: SVGPolygonElement[]; dp: SVGCircleElement };

export interface Display {
  el: HTMLElement;
  update(rows: Uint8Array[]): void;
}

/** Build the 3×16 display into a fresh element and return an updater. */
export function createDisplay(): Display {
  const el = document.createElement("div");
  el.className = "display";
  const digits: DigitEls[][] = [];

  for (let r = 0; r < DISPLAY_ROWS; r++) {
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("class", "seg-row");
    svg.setAttribute("viewBox", `0 0 ${DIGITS_PER_ROW * PITCH} ${DIGIT_H}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    const rowEls: DigitEls[] = [];

    for (let d = 0; d < DIGITS_PER_ROW; d++) {
      const g = document.createElementNS(SVGNS, "g");
      g.setAttribute("transform", `translate(${d * PITCH + (PITCH - DIGIT_W) / 2},0)`);
      const segs = SEG_POINTS.map((pts) => {
        const p = document.createElementNS(SVGNS, "polygon");
        p.setAttribute("points", pts);
        p.setAttribute("class", "seg");
        g.appendChild(p);
        return p;
      });
      const dp = document.createElementNS(SVGNS, "circle");
      dp.setAttribute("cx", "93");
      dp.setAttribute("cy", String(yB));
      dp.setAttribute("r", "6.5");
      dp.setAttribute("class", "seg dp");
      g.appendChild(dp);
      svg.appendChild(g);
      rowEls.push({ segs, dp });
    }
    svg.setAttribute("width", "100%");
    el.appendChild(svg);
    digits.push(rowEls);
  }

  function update(rows: Uint8Array[]) {
    for (let r = 0; r < DISPLAY_ROWS; r++) {
      const bytes = rows[r];
      for (let d = 0; d < DIGITS_PER_ROW; d++) {
        const byte = bytes[d];
        const { segs, dp } = digits[r][d];
        for (let s = 0; s < SEGS.length; s++) {
          segs[s].classList.toggle("on", (byte & SEGS[s]) !== 0);
        }
        dp.classList.toggle("on", (byte & DP) !== 0);
      }
    }
  }

  return { el, update };
}
