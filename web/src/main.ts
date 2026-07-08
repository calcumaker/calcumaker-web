// Calcumaker 16 — browser faceplate. Loads the real engine (calcumaker-core +
// GMP + MPFR) as wasm and drives it exactly like calcumaker-emu: presses in,
// segment bytes out. All client-side.

import "./styles.css";
import { Calcumaker } from "./wasm/calcumaker";
import { createDisplay } from "./display/seg7";
import { createKeypad, cellFor } from "./keypad/keypad";

const SKINS = [
  { id: "led-red", name: "Red LED" },
  { id: "led-green", name: "Green LED" },
  { id: "led-amber", name: "Amber LED" },
  { id: "vfd-cyan", name: "Cyan VFD" },
  { id: "lcd", name: "Gray LCD" },
] as const;

async function main() {
  const cm = await Calcumaker.load();

  const root = document.getElementById("faceplate")!;
  root.textContent = "";
  root.dataset.skin = SKINS[0].id;

  // --- chrome: brand, personality + skin switchers, shift annunciators -------
  const bar = document.createElement("header");
  bar.className = "bar";
  const brand = document.createElement("div");
  brand.className = "brand";
  brand.innerHTML = `<b>CALCUMAKER</b><span>16</span>`;

  // Personality names: read each by briefly selecting it, then restore 16C.
  const persoNames: string[] = [];
  for (let i = 0; i < cm.numPersonalities(); i++) {
    cm.setKeymap(i);
    persoNames.push(cm.keymapName());
  }
  cm.setKeymap(0);

  const persoWrap = document.createElement("div");
  persoWrap.className = "switch perso";
  const persoBtns = persoNames.map((name, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = name;
    b.addEventListener("click", () => {
      cm.setKeymap(i);
      persoBtns.forEach((x, j) => x.classList.toggle("active", j === i));
      keypad.refreshLabels();
      render();
    });
    persoWrap.appendChild(b);
    return b;
  });
  persoBtns[0].classList.add("active");

  const skinSel = document.createElement("select");
  skinSel.className = "skin-select";
  skinSel.title = "Display skin";
  for (const s of SKINS) {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = s.name;
    skinSel.appendChild(o);
  }
  skinSel.addEventListener("change", () => (root.dataset.skin = skinSel.value));

  const annun = document.createElement("div");
  annun.className = "annun";
  const annF = document.createElement("span");
  annF.textContent = "f";
  const annG = document.createElement("span");
  annG.textContent = "g";
  annun.append(annF, annG);

  bar.append(brand, persoWrap, annun, skinSel);

  // --- display + aux panel ---------------------------------------------------
  const screen = document.createElement("div");
  screen.className = "screen";
  const display = createDisplay();
  const aux = document.createElement("pre");
  aux.className = "aux";
  screen.append(display.el, aux);

  const status = document.createElement("div");
  status.className = "status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  // --- keypad ----------------------------------------------------------------
  const keypad = createKeypad(cm, (r, c) => {
    cm.press(r, c);
    render();
  });

  root.append(bar, screen, status, keypad.el);

  function render() {
    display.update(cm.segRows());
    const shift = cm.shift();
    keypad.setShift(shift);
    annF.classList.toggle("on", shift === "f");
    annG.classList.toggle("on", shift === "g");
    aux.textContent = [0, 1, 2, 3].map((i) => cm.auxLine(i)).join("\n");
    const msg = cm.message();
    status.textContent = msg ? msg : `x = ${cm.xFull()}`;
  }

  // Physical keyboard, mirroring the emu.
  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    let ch: string | null = null;
    if (e.key === "Enter") ch = "\n";
    else if (e.key === "Backspace") ch = "\x08";
    else if (e.key === "Escape") {
      const s = cm.shift();
      if (s === "f") cm.pressShift("f");
      else if (s === "g") cm.pressShift("g");
      render();
      e.preventDefault();
      return;
    } else if (e.key.length === 1) ch = e.key;
    if (ch === null) return;
    const cell = cellFor(ch);
    if (cell) {
      cm.press(cell[0], cell[1]);
      render();
      e.preventDefault();
    }
  });

  render();
}

main().catch((e) => {
  const root = document.getElementById("faceplate");
  if (root) {
    root.textContent = `Failed to load engine: ${e}. Build the wasm first (scripts/build-wasm.sh).`;
  }
  console.error(e);
});
