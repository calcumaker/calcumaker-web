// Generate README hero screenshots of both display modules from the built dist.
//
//   cd web && npm run build && node scripts/screenshots.mjs
// Writes docs/screenshot-7seg.png and docs/screenshot-matrix.png (committed).
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { chromium } from "playwright";

const DIST = new URL("../dist/", import.meta.url).pathname;
const DOCS = new URL("../../docs/", import.meta.url).pathname;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm" };

const server = createServer(async (req, res) => {
  try {
    const p = join(DIST, req.url === "/" ? "index.html" : decodeURIComponent(req.url.split("?")[0]));
    const body = await readFile(p);
    res.setHeader("Content-Type", MIME[extname(p)] ?? "application/octet-stream");
    res.end(body);
  } catch { res.statusCode = 404; res.end("not found"); }
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ args: ["--force-color-profile=srgb"] });
const page = await browser.newPage({ viewport: { width: 1000, height: 840 }, deviceScaleFactor: 2 });
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForSelector(".seg-row");

// Showcase value: HEX DEADBEEF — fills the row, shows hex letters on both modules.
for (const k of "Hdeadbeef") await page.keyboard.press(k);

await mkdir(DOCS, { recursive: true });
await page.locator("#faceplate").screenshot({ path: join(DOCS, "screenshot-7seg.png") });

await page.locator(".module button", { hasText: "Matrix" }).click();
await page.waitForTimeout(150);
await page.locator("#faceplate").screenshot({ path: join(DOCS, "screenshot-matrix.png") });

await browser.close();
server.close();
console.log("wrote docs/screenshot-7seg.png and docs/screenshot-matrix.png");
