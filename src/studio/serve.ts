/**
 * Serve the built Plumb Studio SPA from the bridge's loopback HTTP server.
 *
 * The Studio app is built (Vite) into `dist/studio/` and ships in the npm
 * package's `dist`. At runtime this module lives in the bundled `dist/index.js`,
 * so `./studio` resolves next to it. SPA-style fallback to index.html for client
 * routes; path-traversal guarded.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

const STUDIO_DIR = fileURLToPath(new URL("./studio", import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

/** Whether the built Studio assets are present (false in source/dev runs). */
export function studioAvailable(): boolean {
  return existsSync(join(STUDIO_DIR, "index.html"));
}

/** Handle a GET for the Studio SPA. Assumes non-/upload, non-WS requests. */
export function serveStudio(req: IncomingMessage, res: ServerResponse): void {
  if (!studioAvailable()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(
      "Plumb Studio assets aren't built here. Use the published `plumb-mcp`, or run `npm run build` from source.",
    );
    return;
  }

  let urlPath = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
  if (urlPath === "/" || urlPath === "") urlPath = "/index.html";

  let filePath = normalize(join(STUDIO_DIR, urlPath));
  // Path-traversal guard: never serve outside the studio dir.
  if (filePath !== STUDIO_DIR && !filePath.startsWith(STUDIO_DIR + sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  // SPA fallback: unknown client routes (no file extension) → index.html.
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = join(STUDIO_DIR, "index.html");
  }

  const type = CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": extname(filePath) === ".html" ? "no-store" : "public, max-age=3600",
  });
  createReadStream(filePath).pipe(res);
}
