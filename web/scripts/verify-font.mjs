// The web's 5×7 font must stay byte-identical to the firmware's.
//
// `web/src/display/font5x7.ts` is what the OLED and matrix renderers blit; the
// device blits `calcumaker-matrix-fw/src/font.rs`. If they drift, the emulator
// stops showing what the hardware would. This parses both and compares.
//
//   node scripts/verify-font.mjs
import { readFile } from "node:fs/promises";

const TS_PATH = new URL("../src/display/font5x7.ts", import.meta.url);
// Sibling checkout — same layout local and in CI (see release-bundle.yml).
const RS_PATH = new URL("../../../calcumaker/firmware/calcumaker-matrix-fw/src/font.rs", import.meta.url);

let fail = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); if (!cond) fail++; };

// --- the TS table: the object literal is valid JS, so evaluate it directly ----
const tsSrc = await readFile(TS_PATH, "utf8");
const open = tsSrc.indexOf("{", tsSrc.indexOf("const TABLE"));
const close = tsSrc.indexOf("\n};", open);
const tsTable = Object.fromEntries(
  Object.entries(eval(`(${tsSrc.slice(open, close + 2)})`)).map(([k, v]) => [k, [...v]]),
);

// --- the Rust table: parse the match arms -------------------------------------
const rsSrc = await readFile(RS_PATH, "utf8");
const rsTable = {};
for (const m of rsSrc.matchAll(/b'(\\.|[^'])'\s*=>\s*\[([^\]]+)\]/g)) {
  const esc = { "\\\\": "\\", "\\'": "'", '\\"': '"', "\\n": "\n" };
  const ch = esc[m[1]] ?? m[1];
  rsTable[ch] = m[2].split(",").map((x) => parseInt(x.trim(), 16));
}

const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

ok(`firmware font parsed (${Object.keys(rsTable).length} glyphs)`, Object.keys(rsTable).length >= 95);
ok(`web font parsed (${Object.keys(tsTable).length} glyphs)`, Object.keys(tsTable).length >= 95);

// Every glyph the firmware defines must match the web table exactly.
const mismatched = Object.entries(rsTable).filter(([ch, bytes]) => !tsTable[ch] || !eq(tsTable[ch], bytes));
ok(`every firmware glyph matches the web table${mismatched.length ? ` (bad: ${mismatched.map(([c]) => JSON.stringify(c)).join(" ")})` : ""}`,
  mismatched.length === 0);

// Both must cover all printable ASCII — otherwise text renders as hollow boxes.
const printable = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i));
const tsMissing = printable.filter((c) => !(c in tsTable));
const rsMissing = printable.filter((c) => !(c in rsTable));
ok(`web covers printable ASCII 0x20-0x7E${tsMissing.length ? ` (missing ${JSON.stringify(tsMissing.join(""))})` : ""}`,
  tsMissing.length === 0);
ok(`firmware covers printable ASCII 0x20-0x7E${rsMissing.length ? ` (missing ${JSON.stringify(rsMissing.join(""))})` : ""}`,
  rsMissing.length === 0);

// Lowercase must be distinct from uppercase (the old font folded case).
ok("firmware no longer uppercases before lookup", !/to_ascii_uppercase/.test(rsSrc));
ok("lowercase glyphs differ from uppercase ('a' vs 'A')", !eq(rsTable.a, rsTable.A));

// A 7-row font: every column bitmap must fit in 7 bits.
const tooTall = Object.entries(tsTable).filter(([, cols]) => cols.some((c) => c > 0x7f));
ok(`all glyph columns fit 7 rows${tooTall.length ? ` (bad: ${tooTall.map(([c]) => c).join("")})` : ""}`, tooTall.length === 0);
ok("every glyph is exactly 5 columns", Object.values(tsTable).every((c) => c.length === 5));

console.log(fail === 0 ? "\nFONT PARITY GREEN" : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
