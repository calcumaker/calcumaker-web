// 5×10 Cherry-MX faceplate. Legends come straight from the engine
// (`cm.keyLabel`), so they always match keys.rs and follow personality swaps.
// Each key shows the HP-keycap stack: f (gold) / face / g (blue).
//
// Physical-keyboard input mirrors calcumaker-emu's HOST_KEYS table verbatim:
// uppercase F/G are the shifts, lowercase a–f are hex digits, `;`/Enter = ENTER,
// Backspace = BSP.

import type { Calcumaker, Shift } from "../wasm/calcumaker";

const ROWS = 5;
const COLS = 10;

// Ported from calcumaker-emu/src/main.rs HOST_KEYS. '\x08' = Backspace, '\n' = Enter.
const HOST_KEYS: string[][] = [
  ["S", "C", "T", "L", "Q", "P", "I", "E", "\x08", "X"],
  ["a", "b", "c", "d", "e", "f", "7", "8", "9", "/"],
  ["&", "|", "^", "~", "<", ">", "4", "5", "6", "*"],
  ["H", "D", "O", "B", "W", "x", "1", "2", "3", "-"],
  ["F", "G", "m", "r", "v", "\n", "0", ".", "n", "+"],
];

/** Matrix cell for a host character, or null. `;` doubles as ENTER. */
export function cellFor(ch: string): [number, number] | null {
  if (ch === ";") ch = "\n";
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

export function createKeypad(cm: Calcumaker, onPress: (r: number, c: number) => void): Keypad {
  const el = document.createElement("div");
  el.className = "keypad";
  el.dataset.shift = "none";

  const faces: { fLeg: HTMLElement; face: HTMLElement; gLeg: HTMLElement }[][] = [];

  for (let r = 0; r < ROWS; r++) {
    const rowEls: (typeof faces)[number] = [];
    for (let c = 0; c < COLS; c++) {
      const key = document.createElement("button");
      key.type = "button";
      key.className = "key";
      key.dataset.row = String(r);
      key.dataset.col = String(c);

      const fLeg = document.createElement("span");
      fLeg.className = "leg leg-f";
      const face = document.createElement("span");
      face.className = "face";
      const gLeg = document.createElement("span");
      gLeg.className = "leg leg-g";
      key.append(fLeg, face, gLeg);

      key.addEventListener("click", () => onPress(r, c));
      el.appendChild(key);
      rowEls.push({ fLeg, face, gLeg });
    }
    faces.push(rowEls);
  }

  function refreshLabels() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const { fLeg, face, gLeg } = faces[r][c];
        const f = cm.keyLabel(1, r, c);
        const b = cm.keyLabel(0, r, c);
        const g = cm.keyLabel(2, r, c);
        fLeg.textContent = f;
        face.textContent = b;
        gLeg.textContent = g;
        const cell = (fLeg.parentElement as HTMLElement);
        cell.classList.toggle("blank", b === "" && f === "" && g === "");
        cell.classList.toggle("is-shift", b === "f" || b === "g");
      }
    }
  }

  function setShift(shift: Shift) {
    el.dataset.shift = shift;
  }

  refreshLabels();
  return { el, refreshLabels, setShift };
}
