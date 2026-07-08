// Faceplate bootstrap. Loads the engine and wires the display + keypad.
//
// Skeleton for M1+: the display renderer (src/display/) and keypad (src/keypad/)
// land in M2/M3. For now this proves the load path once the M0 wasm exists.

import { Calcumaker } from "./wasm/calcumaker";

async function main() {
  const cm = await Calcumaker.load();

  // Smoke: 2 3 + should show "5". (Matrix cells wired properly in M3; here we
  // just confirm the engine is alive once M0 produces the module.)
  // eslint-disable-next-line no-console
  console.log("segRows[0] bytes:", Array.from(cm.segRows()[0]));

  const root = document.getElementById("faceplate")!;
  root.textContent = "Calcumaker 16 engine loaded. Display + keypad: M2/M3.";
}

main().catch((e) => {
  const root = document.getElementById("faceplate");
  if (root) root.textContent = `Failed to load engine: ${e}. Build the wasm first (scripts/build-wasm.sh).`;
  console.error(e);
});
