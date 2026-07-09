// 5×10 Cherry-MX faceplate — 49 keys, because ENTER is a 2U (double-height)
// keycap spanning rows 3–4 of column 5. Its single switch is in the LOWER cell
// (keys::ENTER_SWITCH_CELL), so the matrix position is unchanged; the upper cell
// carries a stabiliser, no switch, and is `Key::Absent` in every layer.
//
// We ask the engine which cells have switches (`cellHasSwitch`) rather than
// hardcoding it: `keyLabel` can't tell `Absent` from `Nop` — both render "".
// Keys are placed explicitly on the grid so the gap is real, and any cell whose
// neighbour above is absent grows to span both rows (the same rule keydoc uses
// to merge the border in the ASCII diagrams).
//
// Legends come straight from the engine, so they follow personality swaps.
//
// Physical-keyboard input mirrors calcumaker-emu's HOST_KEYS table verbatim:
// uppercase F/G are the shifts, lowercase a–f are hex digits, `;`/Enter = ENTER,
// Backspace = BSP. A cell with no switch gets no host key.

import type { Calcumaker, Shift } from "../wasm/calcumaker";

const ROWS = 5;
const COLS = 10;

/** Matrix cells with no switch get no host key (emu's `NO_KEY`). */
const NO_KEY = "\0";

// Ported from calcumaker-emu/src/main.rs HOST_KEYS. '\x08' = Backspace, '\n' = Enter.
const HOST_KEYS: string[][] = [
  ["S", "C", "T", "L", "Q", "P", "I", "E", "\x08", "X"],
  ["a", "b", "c", "d", "e", "f", "7", "8", "9", "/"],
  ["&", "|", "^", "~", "<", ">", "4", "5", "6", "*"],
  // hex dec oct bin  x<>y  (2U ENTER's upper half: no switch)  1 2 3 −
  ["H", "D", "O", "B", "x", NO_KEY, "1", "2", "3", "-"],
  ["F", "G", "m", "r", "v", "\n", "0", ".", "n", "+"],
];

/** Matrix cell for a host character, or null. `;` doubles as ENTER. */
export function cellFor(ch: string): [number, number] | null {
  if (ch === ";") ch = "\n";
  if (ch === NO_KEY) return null; // never resolve to a cell with no switch
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) if (HOST_KEYS[r][c] === ch) return [r, c];
  return null;
}

export interface Keypad {
  el: HTMLElement;
  /** Rebuild legends from the engine (after a personality change). */
  refreshLabels(): void;
  /** Reflect the pending f/g shift so the active layer's legends light up. */
  setShift(shift: Shift): void;
}

interface Cell {
  key: HTMLElement;
  fLeg: HTMLElement;
  face: HTMLElement;
  gLeg: HTMLElement;
}

export function createKeypad(cm: Calcumaker, onPress: (r: number, c: number) => void): Keypad {
  const el = document.createElement("div");
  el.className = "keypad";
  el.dataset.shift = "none";

  const cells: { r: number; c: number; els: Cell }[] = [];

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!cm.cellHasSwitch(r, c)) continue; // 2U ENTER's upper half: no keycap here

      const key = document.createElement("button");
      key.type = "button";
      key.className = "key";
      key.dataset.row = String(r);
      key.dataset.col = String(c);

      // Explicit placement: the absent cell must leave a real hole, and a key
      // sitting under one grows upward to fill it (a 2U keycap).
      const tall = r > 0 && !cm.cellHasSwitch(r - 1, c);
      key.style.gridColumn = String(c + 1);
      key.style.gridRow = tall ? `${r} / span 2` : String(r + 1);
      if (tall) key.classList.add("key--2u");

      const fLeg = document.createElement("span");
      fLeg.className = "leg leg-f";
      const face = document.createElement("span");
      face.className = "face";
      const gLeg = document.createElement("span");
      gLeg.className = "leg leg-g";
      key.append(fLeg, face, gLeg);

      key.addEventListener("click", () => onPress(r, c));
      el.appendChild(key);
      cells.push({ r, c, els: { key, fLeg, face, gLeg } });
    }
  }

  function refreshLabels() {
    for (const { r, c, els } of cells) {
      const f = cm.keyLabel(1, r, c);
      const b = cm.keyLabel(0, r, c);
      const g = cm.keyLabel(2, r, c);
      els.fLeg.textContent = f;
      els.face.textContent = b;
      els.gLeg.textContent = g;
      els.key.classList.toggle("blank", b === "" && f === "" && g === "");
      // f is gold, g is blue — the same colours as their legends and the
      // annunciators, and as the real keycaps.
      els.key.classList.toggle("is-shift", b === "f" || b === "g");
      els.key.classList.toggle("is-shift-f", b === "f");
      els.key.classList.toggle("is-shift-g", b === "g");
    }
  }

  function setShift(shift: Shift) {
    el.dataset.shift = shift;
  }

  refreshLabels();
  return { el, refreshLabels, setShift };
}
