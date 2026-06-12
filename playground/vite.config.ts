import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The playground deploys to the existing GitHub Pages site under /play, served
// from the VitePress site's `public` dir. Source lives here; built assets land
// in ../docs/public/play so `npm run docs:build` ships them at /plumb-mcp/play/.
export default defineConfig({
  base: "/plumb-mcp/play/",
  plugins: [react()],
  // The pure engine lives in ../src — let the dev server read above the root.
  server: { fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] } },
  build: {
    outDir: fileURLToPath(new URL("../docs/public/play", import.meta.url)),
    emptyOutDir: true,
  },
});
