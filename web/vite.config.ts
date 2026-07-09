import { defineConfig } from "vite";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

// Stamp the build with the calcumaker-web + engine (calcumaker) commit SHAs so
// the page can report exactly what it's running. Computed at config time; falls
// back to "unknown" when git isn't available (e.g. a source tarball).
function gitSha(cwd: string): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}
const webSha = gitSha(process.cwd());
const coreSha = gitSha(resolve(process.cwd(), "../../calcumaker")); // sibling engine repo

// All client-side; the .wasm ships as a static asset next to the bundle.
export default defineConfig({
  base: "./",
  build: { target: "es2022" },
  define: {
    __CM_WEB_SHA__: JSON.stringify(webSha),
    __CM_CORE_SHA__: JSON.stringify(coreSha),
    __CM_BUILT_AT__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  // wasm-shim uses no top-level await from us, but keep esbuild happy for it.
  optimizeDeps: { exclude: ["@bjorn3/browser_wasi_shim"] },
});
