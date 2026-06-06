import { defineConfig } from "vite";

// Tauri wants a fixed dev port and no terminal-clearing so its CLI output stays visible.
// See https://tauri.app/start/frontend/vite/
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    // Two HTML entries: the transparent overlay (index.html) and the M6 settings
    // window (settings.html), each with its own module graph.
    rollupOptions: {
      input: {
        main: "index.html",
        settings: "settings.html",
      },
    },
  },
});
