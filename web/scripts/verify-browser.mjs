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

ok("keypad has 50 keys", (await page.locator(".key").count()) === 50);
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

// Screenshot every 7-seg skin.
await mkdir(SHOTS, { recursive: true });
const skins = await page.locator(".skin-select option").evaluateAll((os) => os.map((o) => o.value));
for (const s of skins) {
  await page.selectOption(".skin-select", s);
  await page.waitForTimeout(120);
  await page.locator("#faceplate").screenshot({ path: join(SHOTS, `${s}.png`) });
}
ok(`screenshot each 7-seg skin (${skins.length})`, skins.length === 5);

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

// Responsive: no horizontal overflow at portrait phone widths (regression guard
// for the keypad forcing the faceplate wider than the screen).
for (const w of [320, 360, 390]) {
  const mp = await browser.newPage({ viewport: { width: w, height: 844 } });
  await mp.goto(base, { waitUntil: "networkidle" });
  await mp.waitForSelector(".seg-row");
  const { sw, iw, keyW } = await mp.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
    keyW: Math.round(document.querySelector(".key").getBoundingClientRect().width),
  }));
  ok(`no horizontal overflow at ${w}px (scrollW ${sw} <= ${iw}; key ${keyW}px)`, sw <= iw);
  if (w === 390) await mp.screenshot({ path: join(SHOTS, "mobile-390.png"), fullPage: true });
  await mp.close();
}

ok(`no page errors (${errors.length})`, errors.length === 0);
if (errors.length) console.log(errors.join("\n"));

await browser.close();
server.close();
console.log(fail === 0 ? "\nBROWSER VERIFY GREEN" : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
