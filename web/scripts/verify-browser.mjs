// End-to-end browser verification: serve the built app, load it in Chromium,
// drive real input, assert the display renders, and screenshot every skin.
//
//   cd web && npm run build && node scripts/verify-browser.mjs
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { chromium } from "playwright";

const DIST = new URL("../dist/", import.meta.url).pathname;
const SHOTS = new URL("../verify-shots/", import.meta.url).pathname;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm" };

const server = createServer(async (req, res) => {
  try {
    const p = join(DIST, req.url === "/" ? "index.html" : decodeURIComponent(req.url.split("?")[0]));
    const body = await readFile(p);
    res.setHeader("Content-Type", MIME[extname(p)] ?? "application/octet-stream");
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

let fail = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); if (!cond) fail++; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForSelector(".seg-row", { timeout: 10000 });

// 49 keys: ENTER is a 2U keycap spanning rows 3-4 of col 5; its upper cell has
// no switch (keys::ENTER_SPAN_CELL) so no keycap is drawn there.
ok("keypad has 49 keys (2U ENTER)", (await page.locator(".key").count()) === 49);
const enter2u = await page.evaluate(() => {
  const at = (r, c) => document.querySelector(`.key[data-row="${r}"][data-col="${c}"]`);
  const h = (e) => (e ? Math.round(e.getBoundingClientRect().height) : 0);
  const enter = at(4, 5), oneU = at(4, 6);
  return {
    absentCellHasNoKey: at(3, 5) === null,
    enterFace: enter?.querySelector(".face").textContent,
    enterRow: enter ? getComputedStyle(enter).gridRow : "",
    enterH: h(enter), oneUH: h(oneU),
    gap: parseFloat(getComputedStyle(document.querySelector(".keypad")).gap),
    base34: at(3, 4)?.querySelector(".face").textContent,
    fEnter: enter?.querySelector(".leg-f").textContent,
    gEnter: enter?.querySelector(".leg-g").textContent,
  };
});
ok("no keycap at the ENTER stabiliser cell (3,5)", enter2u.absentCellHasNoKey);
ok(`ENTER spans two grid rows (${enter2u.enterRow})`, /span 2/.test(enter2u.enterRow));
ok(`ENTER is 2U tall (${enter2u.enterH} == 2x${enter2u.oneUH} + ${enter2u.gap} gap)`,
  enter2u.enterH === enter2u.oneUH * 2 + enter2u.gap);
ok(`x<>y moved to base (3,4) (${enter2u.base34})`, enter2u.base34 === "x<>y");
ok(`f+ENTER is WSIZE, g+ENTER is FLOAT (${enter2u.fEnter}/${enter2u.gEnter})`,
  enter2u.fEnter === "WSIZE" && enter2u.gEnter === "FLOAT");

// The 2U ENTER wears a lighter shade so the tall keycap reads as its own thing.
const shades = await page.evaluate(() => ({
  enter: getComputedStyle(document.querySelector(".key--2u")).backgroundImage,
  plain: getComputedStyle(document.querySelector('.key[data-row="4"][data-col="6"]')).backgroundImage,
}));
ok("2U ENTER is a different shade from the 1U keys", shades.enter !== shades.plain);

// The aux OLED is a 0.91" panel; it must not read as a full-width text pane.
const oledW = Math.round((await page.locator(".oled canvas").boundingBox()).width);
ok(`aux OLED is small (${oledW}px <= 280)`, oledW <= 280);

// The moved host key must actually drive the moved function: 3 ENTER 4 x -> 3.
{
  const sp = await browser.newPage({ viewport: { width: 1100, height: 820 } });
  await sp.goto(base, { waitUntil: "networkidle" });
  await sp.waitForSelector(".seg-row");
  for (const k of ["3", "Enter", "4"]) await sp.keyboard.press(k);
  await sp.keyboard.type("x"); // x<>y at its new cell (3,4)
  await sp.waitForTimeout(150);
  const v = (await sp.locator(".status-val").textContent())?.trim();
  ok(`x<>y works from its new host key (3 ENTER 4 x -> ${JSON.stringify(v)})`, v === "x = 3");

  // Landscape gives 1U keys a fixed height; the 2U key must still span two rows.
  await sp.setViewportSize({ width: 844, height: 390 });
  await sp.waitForTimeout(150);
  const land = await sp.evaluate(() => {
    const at = (r, c) => document.querySelector(`.key[data-row="${r}"][data-col="${c}"]`);
    const h = (e) => Math.round(e.getBoundingClientRect().height);
    return { enter: h(at(4, 5)), oneU: h(at(4, 6)),
      gap: parseFloat(getComputedStyle(document.querySelector(".keypad")).gap) };
  });
  ok(`2U ENTER stays double-height in landscape (${land.enter} == 2x${land.oneU} + ${land.gap})`,
    land.enter === land.oneU * 2 + land.gap);
  await sp.close();
}
ok("display has 3 rows", (await page.locator(".seg-row").count()) === 3);
ok("a key legend came from the engine (ENTER present)",
  (await page.locator(".face", { hasText: "ENTER" }).count()) >= 1);

// Drive 2 ENTER 3 + via the physical-keyboard path -> x = 5, and lit segments.
await page.keyboard.press("2");
await page.keyboard.press("Enter");
await page.keyboard.press("3");
await page.keyboard.press("+");
const status = (await page.locator(".status").textContent())?.trim();
ok(`status shows x = 5 (got ${JSON.stringify(status)})`, status === "x = 5");
ok("some segments are lit", (await page.locator(".seg.on").count()) > 0);

// Personality switch: 16C -> SCI relabels keys.
await page.locator(".perso button", { hasText: "SCI" }).click();
ok("SCI personality active", (await page.locator(".perso button.active", { hasText: "SCI" }).count()) === 1);
await page.locator(".perso button", { hasText: "16C" }).click();

// Screenshot every 7-seg skin, and check the segments actually take the skin's
// COLOUR. Counting `.seg.on` elements is not enough: when the `.seg` fill rules
// were once lost, `fill` fell back to its initial value (black) and the display
// rendered black-on-black while every element-count assertion still passed.
const SKIN_LIT = {
  "led-red": "rgb(255, 59, 48)", "led-green": "rgb(61, 255, 114)",
  "led-amber": "rgb(255, 176, 32)", "vfd-cyan": "rgb(116, 244, 255)",
  lcd: "rgb(27, 32, 21)", // #1b2015
};
await mkdir(SHOTS, { recursive: true });
const skins = await page.locator(".skin-select option").evaluateAll((os) => os.map((o) => o.value));
for (const s of skins) {
  await page.selectOption(".skin-select", s);
  await page.waitForTimeout(120);
  const paint = await page.evaluate(() => {
    const on = document.querySelector(".seg.on"), off = document.querySelector(".seg:not(.on)");
    return {
      on: getComputedStyle(on).fill,
      off: getComputedStyle(off).fill,
      filter: getComputedStyle(on).filter,
    };
  });
  ok(`skin ${s}: lit segments are ${SKIN_LIT[s] ?? "?"} (got ${paint.on})`, paint.on === SKIN_LIT[s]);
  ok(`skin ${s}: lit segments are not black`, paint.on !== "rgb(0, 0, 0)");
  ok(`skin ${s}: unlit segments are a faded tint (${paint.off})`, /^rgba\(/.test(paint.off));
  await page.locator("#faceplate").screenshot({ path: join(SHOTS, `${s}.png`) });
}
ok(`screenshot each 7-seg skin (${skins.length})`, skins.length === 5);
await page.selectOption(".skin-select", "led-red");

// Switch to the RGB dot-matrix module and confirm it draws lit pixels.
await page.locator(".module button", { hasText: "Matrix" }).click();
await page.waitForTimeout(150);
ok("matrix canvas visible", await page.locator(".matrix canvas").isVisible());
const brightPixels = await page.locator(".matrix canvas").evaluate((c) => {
  const ctx = c.getContext("2d");
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let n = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] > 120 || data[i + 1] > 120 || data[i + 2] > 120) n++;
  return n;
});
ok(`matrix has lit dots (${brightPixels}px)`, brightPixels > 50);
const palettes = await page.locator(".skin-select option").evaluateAll((os) => os.map((o) => o.value));
for (const p of palettes) {
  await page.selectOption(".skin-select", p);
  await page.waitForTimeout(120);
  await page.locator("#faceplate").screenshot({ path: join(SHOTS, `matrix-${p}.png`) });
}
ok(`screenshot each matrix palette (${palettes.length})`, palettes.length === 4);

// Help overlay via '?', with build versions (web + engine SHAs).
await page.keyboard.press("Shift+Slash");
ok("help overlay opens on ?", await page.locator(".overlay .overlay-card").isVisible());
ok("help shows build versions (web + engine)", (await page.locator(".overlay p.build code").count()) === 2);
await page.keyboard.press("Escape");
ok("help overlay closes on Esc", !(await page.locator(".overlay").isVisible()));

// Long value stays one line (status capped, not wrapped).
await page.locator(".module button", { hasText: "7-Seg" }).click();
for (const k of "2.0") await page.keyboard.press(k);
await page.keyboard.press("Q"); // sqrt(2): ~77 digits
const stH = (await page.locator(".status").boundingBox()).height;
ok(`status stays one line for a long value (${Math.round(stH)}px)`, stH < 28);

// Colophon: attribution + AGPL source offer must be present (AGPL §13) and the
// outbound links must point where we claim.
const colophon = (await page.locator("footer.colophon").textContent()) ?? "";
ok("colophon shows copyright", /©\s*2026\s+Yann Ramin/.test(colophon));
ok("colophon names AGPL-3.0", /AGPL-3\.0/.test(colophon));
const href = (sel) => page.locator(sel).first().getAttribute("href");
ok("links to calcumaker.co", (await href('footer.colophon a[href*="calcumaker.co"]')) === "https://calcumaker.co");
ok("links to the GitHub source",
  (await href('footer.colophon a[href*="github.com"]')) === "https://github.com/calcumaker/calcumaker-web");
ok("links to the AGPL text",
  (await href('footer.colophon a[href*="gnu.org"]')) === "https://www.gnu.org/licenses/agpl-3.0.html");
ok("external links are rel=noopener",
  (await page.locator('footer.colophon a[rel~="noopener"]').count()) === 3);

// Arbitrary precision reaches the UI: 500! is 1135 chars. The status line used
// to blank out (fixed 256-byte transfer buffer) and, once fixed, its `nowrap`
// max-content width stretched the page. Both must stay fixed.
{
  const bp = await browser.newPage({ viewport: { width: 1100, height: 820 } });
  await bp.goto(base, { waitUntil: "networkidle" });
  await bp.waitForSelector(".seg-row");
  for (const k of "500") await bp.keyboard.press(k);
  await bp.keyboard.press("G"); // g shift
  await bp.keyboard.press("4"); // g-layer: x!
  await bp.waitForTimeout(400);
  const st = await bp.evaluate(() => {
    const e = document.querySelector(".status");
    return { text: e.textContent, title: e.getAttribute("title"), h: e.getBoundingClientRect().height };
  });
  ok("big value reaches the status line (not blanked by a fixed buffer)",
    st.text.startsWith("x = 1220136825991110068701"));
  ok(`big value is summarised with its length (${JSON.stringify(st.text.slice(-14))})`,
    /\(1135 chars\)$/.test(st.text.trim()));
  ok(`big value keeps the status to one line (${Math.round(st.h)}px)`, st.h < 28);
  ok("tooltip states the length rather than dumping 1135 chars",
    /1135 characters/.test(st.title ?? "") && !/1220136825991110068701/.test(st.title ?? ""));

  // The aux OLED is a real 128x32 panel drawn with the 5x7 font (21 chars x 4
  // rows == App::aux_lines()). Fixed aspect, so it can never change height, and
  // it must actually light pixels rather than render an empty canvas.
  const full = await bp.evaluate(() => {
    const c = document.querySelector(".oled canvas");
    const ctx = c.getContext("2d");
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 150 && data[i + 2] > 150) lit++;
    return {
      w: c.width, h: c.height, lit,
      box: Math.round(document.querySelector(".oled").getBoundingClientRect().height),
      keypadTop: Math.round(document.querySelector(".keypad").getBoundingClientRect().top),
      aria: document.querySelector(".oled").getAttribute("aria-label") ?? "",
    };
  });
  // 128x32 active area + a 2px bezel each side, at 6 backing px per OLED pixel.
  ok(`aux OLED canvas is 128x32 (+bezel) at 6x (${full.w}x${full.h})`,
    full.w === (128 + 4) * 6 && full.h === (32 + 4) * 6);
  ok(`aux OLED lights pixels (${full.lit})`, full.lit > 500);
  ok("aux OLED exposes its text to screen readers", /16C/.test(full.aria));

  await bp.keyboard.press("X"); // CLx — empties the aux body rows
  await bp.waitForTimeout(200);
  const empty = await bp.evaluate(() => ({
    box: Math.round(document.querySelector(".oled").getBoundingClientRect().height),
    keypadTop: Math.round(document.querySelector(".keypad").getBoundingClientRect().top),
  }));
  ok(`aux OLED is fixed height, full vs empty (${full.box} == ${empty.box})`, full.box === empty.box);
  ok(`aux OLED doesn't shift the keypad (${full.keypadTop} == ${empty.keypadTop})`,
    full.keypadTop === empty.keypadTop);

  // Lowercase must render as lowercase (the firmware font used to fold case).
  await bp.keyboard.press("1"); await bp.keyboard.press("Enter");
  await bp.keyboard.press("0"); await bp.keyboard.press("/");
  await bp.waitForTimeout(200);
  const msgAria = await bp.evaluate(() =>
    document.querySelector(".oled").getAttribute("aria-label") ?? "");
  ok(`aux OLED shows lowercase messages (${JSON.stringify(msgAria.slice(-16))})`,
    /divide by zero/.test(msgAria));

  await bp.close();
}

// Responsive: no horizontal overflow at portrait phone widths (regression guard
// for the keypad forcing the faceplate wider than the screen, and for the
// nowrap status line stretching the body grid's max-content column).
for (const w of [320, 360, 390]) {
  const mp = await browser.newPage({ viewport: { width: w, height: 844 } });
  await mp.goto(base, { waitUntil: "networkidle" });
  await mp.waitForSelector(".seg-row");
  // Put a 1135-char value in the status line before measuring.
  for (const k of "500") await mp.keyboard.press(k);
  await mp.keyboard.press("G");
  await mp.keyboard.press("4");
  await mp.waitForTimeout(300);
  const { sw, iw, keyW } = await mp.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
    keyW: Math.round(document.querySelector(".key").getBoundingClientRect().width),
  }));
  ok(`no horizontal overflow at ${w}px (scrollW ${sw} <= ${iw}; key ${keyW}px)`, sw <= iw);
  if (w === 390) await mp.screenshot({ path: join(SHOTS, "mobile-390.png"), fullPage: true });
  await mp.close();
}

// Tap behaviour: double-tap-to-zoom disabled via touch-action, while pinch-zoom
// stays available (we must NOT set user-scalable=no / maximum-scale — a11y).
const ta = (sel) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).touchAction, sel);
ok("body disables double-tap zoom (touch-action: manipulation)", (await ta("body")) === "manipulation");
ok("keys disable double-tap zoom", (await ta(".key")) === "manipulation");
const vp = await page.evaluate(() => document.querySelector('meta[name="viewport"]')?.content ?? "");
ok(`viewport still allows pinch-zoom (${vp})`, !/user-scalable\s*=\s*no|maximum-scale/i.test(vp));

// Landscape (short viewport): the display AND the whole keypad must be on screen
// without scrolling — width-based queries don't fire at ~844px wide.
for (const [w, h] of [[844, 390], [667, 375]]) {
  const lp = await browser.newPage({ viewport: { width: w, height: h } });
  await lp.goto(base, { waitUntil: "networkidle" });
  await lp.waitForSelector(".seg-row");
  const r = await lp.evaluate(() => ({
    keypadBottom: Math.round(document.querySelector(".keypad").getBoundingClientRect().bottom),
    ih: window.innerHeight,
    segVisible: document.querySelector(".seg-row").getBoundingClientRect().height > 8,
  }));
  ok(`landscape ${w}x${h}: keypad fully visible (bottom ${r.keypadBottom} <= ${r.ih}) and display shown`,
    r.keypadBottom <= r.ih && r.segVisible);
  if (w === 844) await lp.screenshot({ path: join(SHOTS, "landscape-844.png") });
  await lp.close();
}

// Shift keys wear the device's colours: f gold, g blue (g used to be gold too).
const shiftColors = await page.evaluate(() => {
  const bg = (sel) => {
    const e = document.querySelector(sel);
    return e ? getComputedStyle(e).backgroundImage : "";
  };
  return {
    f: bg(".key.is-shift-f"), g: bg(".key.is-shift-g"),
    nf: document.querySelectorAll(".key.is-shift-f").length,
    ng: document.querySelectorAll(".key.is-shift-g").length,
  };
});
ok(`exactly one f and one g shift key (${shiftColors.nf}/${shiftColors.ng})`,
  shiftColors.nf === 1 && shiftColors.ng === 1);
ok("f shift key is gold", /240,\s*194,\s*90/.test(shiftColors.f));
ok(`g shift key is blue, not gold`,
  /110,\s*168,\s*255/.test(shiftColors.g) && !/240,\s*194,\s*90/.test(shiftColors.g));

// RAN# is seeded from crypto at load: two fresh loads must not replay the same
// sequence (the no_std core can't reach entropy — calcumaker@5b75275).
async function ranAcrossLoad() {
  const rp = await browser.newPage({ viewport: { width: 1100, height: 820 } });
  await rp.goto(base, { waitUntil: "networkidle" });
  await rp.waitForSelector(".seg-row");
  await rp.locator(".perso button", { hasText: "SCI" }).click(); // RAN# is SCI g-layer
  await rp.keyboard.press("G");
  await rp.keyboard.type("^"); // SCI_LAYER_G[2][2] = RAN#
  await rp.waitForTimeout(200);
  const v = (await rp.locator(".status-val").textContent()) ?? "";
  await rp.close();
  return v;
}
const ran1 = await ranAcrossLoad(), ran2 = await ranAcrossLoad();
ok(`RAN# produces a value (${JSON.stringify(ran1.slice(0, 12))})`, /x = 0\./.test(ran1));
ok(`RAN# differs across page loads (seeded from crypto)`, ran1 !== ran2);

ok(`no page errors (${errors.length})`, errors.length === 0);
if (errors.length) console.log(errors.join("\n"));

await browser.close();
server.close();
console.log(fail === 0 ? "\nBROWSER VERIFY GREEN" : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
