import { defineConfig } from "vite";
import { cssCacheBust } from "./vite-plugins/cssCacheBust";

export default defineConfig({
  // cssCacheBust: the Verse8 editor container caches .css for 4 hours; see the plugin.
  plugins: [cssCacheBust()],
  // Verse8 serves the game from a sub-path; root-absolute URLs 404 there.
  base: "./",
  optimizeDeps: { include: ["@agent8/gameserver"] },
  server: {
    port: Number(process.env.PORT) || 5280, // 5190 is taken by another local project
    watch: { ignored: ["**/.git/**", "**/node_modules/**", "**/dist/**", "**/proto/**"] },
  },
  build: {
    outDir: "dist",
    reportCompressedSize: false,
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      output: {
        advancedChunks: { groups: [{ name: "three", test: /node_modules[\\/]three[\\/]/ }] },
      },
    },
  },
});
