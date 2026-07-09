// Calcumaker 16 — browser faceplate. Loads the real engine (calcumaker-core +
// GMP + MPFR + MPC) as wasm and drives it exactly like calcumaker-emu: presses
// in, display out. Two interchangeable display modules (7-seg / RGB matrix),
// mirroring the hardware. All client-side.

import "./styles.css";
import { Calcumaker } from "./wasm/calcumaker";
import { createDisplay } from "./display/seg7";
import { createMatrix, MATRIX_PALETTES } from "./display/matrix";
import { createKeypad, cellFor } from "./keypad/keypad";

const SKINS = [
  { id: "led-red", name: "Red LED" },
  { id: "led-green", name: "Green LED" },
  { id: "led-amber", name: "Amber LED" },
  { id: "vfd-cyan", name: "Cyan VFD" },
  { id: "lcd", name: "Gray LCD" },
] as const;

const PALETTE_NAMES: Record<string, string> = {
  rgb: "Per-row RGB", amber: "Amber", green: "Green", white: "White",
};

/**
 * The engine is arbitrary-precision: `500!` is 1,135 characters and `1000!` is
 * over 2,500. Rendering that verbatim in the status line is useless even when
 * clipped — you see a wall of digits with no idea how many. Keep the head and
 * tail (the parts you actually read) and state the length. The full value stays
 * one click away via copy-to-clipboard.
 */
const STATUS_MAX = 56;
const HEAD = 30;
const TAIL = 12;

/** `[value, meta]` — meta is rendered in its own non-shrinking element so the
 *  length never gets clipped away by the value's ellipsis on narrow screens. */
function summarize(x: string): [string, string] {
  if (x.length <= STATUS_MAX) return [x, ""];
  return [`${x.slice(0, HEAD)}…${x.slice(-TAIL)}`, `(${x.length} chars)`];
}

async function main() {
  const cm = await Calcumaker.load();

  const root = document.getElementById("faceplate")!;
  root.textContent = "";
  root.dataset.skin = SKINS[0].id;
  root.dataset.module = "seg";

  // --- chrome ----------------------------------------------------------------
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

  // Display-module switch (the two boards are interchangeable hardware).
  const modWrap = document.createElement("div");
  modWrap.className = "switch module";
  let module: "seg" | "matrix" = "seg";
  const modBtns = (["seg", "matrix"] as const).map((m) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = m === "seg" ? "7-Seg" : "Matrix";
    b.classList.toggle("active", m === module);
    b.addEventListener("click", () => {
      module = m;
      root.dataset.module = m;
      modBtns.forEach((x) => x.classList.toggle("active", x === b));
      fillStyleSelect();
      render();
    });
    modWrap.appendChild(b);
    return b;
  });

  // One <select> whose contents follow the active module (skins vs palettes).
  const styleSel = document.createElement("select");
  styleSel.className = "skin-select";
  function fillStyleSelect() {
    styleSel.textContent = "";
    if (module === "seg") {
      for (const s of SKINS) styleSel.add(new Option(s.name, s.id));
      styleSel.value = root.dataset.skin!;
    } else {
      for (const p of MATRIX_PALETTES) styleSel.add(new Option(PALETTE_NAMES[p] ?? p, p));
      styleSel.value = "rgb";
      matrix.setPalette("rgb");
    }
  }
  styleSel.addEventListener("change", () => {
    if (module === "seg") root.dataset.skin = styleSel.value;
    else matrix.setPalette(styleSel.value);
  });

  const help = document.createElement("button");
  help.type = "button";
  help.className = "help-btn";
  help.textContent = "?";
  help.title = "Keyboard help";

  const annun = document.createElement("div");
  annun.className = "annun";
  const annF = document.createElement("span");
  annF.textContent = "f";
  const annG = document.createElement("span");
  annG.textContent = "g";
  annun.append(annF, annG);

  bar.append(brand, persoWrap, modWrap, annun, styleSel, help);

  // --- display modules + aux -------------------------------------------------
  const screen = document.createElement("div");
  screen.className = "screen";
  const display = createDisplay();
  const matrix = createMatrix();
  const aux = document.createElement("pre");
  aux.className = "aux";
  screen.append(display.el, matrix.el, aux);

  const status = document.createElement("div");
  status.className = "status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const statusVal = document.createElement("span");
  statusVal.className = "status-val";
  const statusMeta = document.createElement("span");
  statusMeta.className = "status-meta";
  status.append(statusVal, statusMeta);
  status.addEventListener("click", () => {
    navigator.clipboard?.writeText(cm.xFull()).then(() => {
      statusVal.textContent = "✓ copied to clipboard";
      statusMeta.textContent = "";
      status.classList.add("copied");
      setTimeout(() => { status.classList.remove("copied"); render(); }, 900);
    });
  });

  const keypad = createKeypad(cm, (r, c) => { cm.press(r, c); render(); });

  const overlay = buildHelpOverlay();

  root.append(bar, screen, status, keypad.el, overlay.el);
  fillStyleSelect();

  function render() {
    if (module === "seg") display.update(cm.segRows());
    else matrix.update([cm.textRow(0), cm.textRow(1), cm.textRow(2)]);
    const shift = cm.shift();
    keypad.setShift(shift);
    annF.classList.toggle("on", shift === "f");
    annG.classList.toggle("on", shift === "g");
    aux.textContent = [0, 1, 2, 3].map((i) => cm.auxLine(i)).join("\n");
    const msg = cm.message();
    if (msg) {
      statusVal.textContent = msg;
      statusMeta.textContent = "";
      status.title = msg;
    } else {
      const x = cm.xFull();
      const [val, meta] = summarize(x);
      statusVal.textContent = `x = ${val}`;
      statusMeta.textContent = meta;
      // Don't put a 1000-digit value in the tooltip (or the aria-live region).
      status.title = x.length > STATUS_MAX
        ? `x has ${x.length} characters — click to copy the full value`
        : `${x}\n(click to copy X)`;
    }
  }

  help.addEventListener("click", () => overlay.toggle());
  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "?") { overlay.toggle(); e.preventDefault(); return; }
    let ch: string | null = null;
    if (e.key === "Enter") ch = "\n";
    else if (e.key === "Backspace") ch = "\x08";
    else if (e.key === "Escape") {
      if (overlay.isOpen()) { overlay.toggle(); return; }
      const s = cm.shift();
      if (s === "f") cm.pressShift("f");
      else if (s === "g") cm.pressShift("g");
      render();
      e.preventDefault();
      return;
    } else if (e.key.length === 1) ch = e.key;
    if (ch === null) return;
    const cell = cellFor(ch);
    if (cell) { cm.press(cell[0], cell[1]); render(); e.preventDefault(); }
  });

  render();
}

/** A SHA as a link to its commit — plain text when the sha isn't a real one. */
function commitLink(repo: string, sha: string): string {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) return `<code>${sha}</code>`;
  return `<a href="https://github.com/calcumaker/${repo}/commit/${sha}" target="_blank" rel="noopener noreferrer"><code>${sha}</code></a>`;
}

function buildHelpOverlay() {
  const el = document.createElement("div");
  el.className = "overlay";
  el.hidden = true;
  el.innerHTML = `
    <div class="overlay-card">
      <h2>Keyboard</h2>
      <ul>
        <li><b>0–9</b> digits &nbsp; <b>a–f</b> hex A–F</li>
        <li><b>F</b> / <b>G</b> (uppercase) — gold / blue shift</li>
        <li><b>Enter</b> ENTER &nbsp; <b>;</b> also ENTER</li>
        <li><b>Backspace</b> BSP &nbsp; <b>.</b> decimal</li>
        <li><b>+ - * /</b> arithmetic</li>
        <li><b>&amp; | ^ ~</b> and / or / xor / not</li>
        <li><b>H D O B</b> hex / dec / oct / bin &nbsp; <b>W</b> word size</li>
        <li><b>Esc</b> cancel a pending shift &nbsp; <b>?</b> this help</li>
      </ul>
      <p>Click any key on the faceplate too. The f/face/g legends come straight
      from the engine's keymap.</p>
      <p class="build">build · web ${commitLink("calcumaker-web", __CM_WEB_SHA__)}
      · engine (core) ${commitLink("calcumaker", __CM_CORE_SHA__)} · ${__CM_BUILT_AT__}</p>
      <p class="build legal">© 2026 Yann Ramin ·
      <a href="https://calcumaker.co" target="_blank" rel="noopener noreferrer">calcumaker.co</a> ·
      <a href="https://github.com/calcumaker/calcumaker-web" target="_blank" rel="noopener noreferrer">Source</a> ·
      <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener noreferrer">AGPL-3.0</a>
      </p>
    </div>`;
  el.addEventListener("click", (e) => { if (e.target === el) toggle(); });
  const toggle = () => { el.hidden = !el.hidden; };
  return { el, toggle, isOpen: () => !el.hidden };
}

main().catch((e) => {
  const root = document.getElementById("faceplate");
  if (root) root.textContent = `Failed to load engine: ${e}. Build the wasm first (scripts/build-wasm.sh).`;
  console.error(e);
});
