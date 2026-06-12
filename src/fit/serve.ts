/**
 * A throwaway localhost HTTP server for one HTML document.
 *
 * The fit loop renders generated HTML by serving it on an ephemeral port and
 * pointing headless Chrome at it (file:// breaks the Tailwind CDN script under
 * some CORS/MIME rules; a real http origin is reliable). One server per pass,
 * closed immediately after capture.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface ServedPage {
  /** http://127.0.0.1:<port>/ — navigate Chrome here. */
  url: string;
  /** Shut the server down. Always call it (finally) after capture. */
  close: () => Promise<void>;
}

/**
 * Serve `html` for every request on a random loopback port. Resolves once the
 * server is listening and the URL is known.
 */
export function serveHtml(html: string): Promise<ServedPage> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((_req, res) => {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(html);
    });
    server.on("error", reject);
    // Port 0 → OS assigns a free port. Bind loopback only.
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo | null;
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("Failed to bind the local render server."));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}/`,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}
