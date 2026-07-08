import { defineConfig } from "vite";

// All client-side; the .wasm ships as a static asset next to the bundle.
export default defineConfig({
  base: "./",
  build: { target: "es2022" },
  // wasm-shim uses no top-level await from us, but keep esbuild happy for it.
  optimizeDeps: { exclude: ["@bjorn3/browser_wasi_shim"] },
});
