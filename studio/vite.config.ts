import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Studio is served by the Plumb bridge at the loopback server root, and built
// into ../dist/studio so it ships in the npm package's `dist`.
export default defineConfig({
  base: "/",
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("../dist/studio", import.meta.url)),
    emptyOutDir: true,
  },
});
