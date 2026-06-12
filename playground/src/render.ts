/**
 * Render a generated HTML document in an `<iframe srcdoc>` and capture its
 * laid-out, computed-style state — the browser equivalent of the CLI's headless
 * CDP capture. We append the shared `captureFn` as a script that runs after the
 * page (and the Tailwind CDN) settle, then postMessages the result to the parent.
 */
import { captureFn } from "../../src/render/captureFn";
import type { RenderedElement } from "../../src/verify";

// Inject the exact same capture function used over CDP, serialised. It runs in
// the iframe's own context, waits for layout + Tailwind JIT to settle, and
// posts the captured elements back to the parent window.
const captureScript = `<script>(function(){
  function run(){
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ setTimeout(function(){
      try { var r = (${captureFn.toString()})("[data-plumb-id]"); parent.postMessage({ __plumbCapture: true, rendered: r }, "*"); }
      catch (e) { parent.postMessage({ __plumbCapture: true, error: String(e) }, "*"); }
    }, 400); }); });
  }
  if (document.readyState === "complete") run();
  else window.addEventListener("load", run);
})();<\/script>`;

function withCapture(html: string): string {
  return html.includes("</body>")
    ? html.replace("</body>", `${captureScript}</body>`)
    : html + captureScript;
}

/** Set the iframe's content to `html` and resolve with its captured elements. */
export function renderAndCapture(
  iframe: HTMLIFrameElement,
  html: string,
  timeoutMs = 8000,
): Promise<RenderedElement[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { __plumbCapture?: boolean; rendered?: RenderedElement[]; error?: string };
      if (!d || !d.__plumbCapture) return;
      if (iframe.contentWindow && e.source !== iframe.contentWindow) return;
      cleanup();
      if (d.error) reject(new Error(`Capture failed: ${d.error}`));
      else resolve(Array.isArray(d.rendered) ? d.rendered : []);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("The render didn't report back in time — the generated HTML may be malformed."));
    }, timeoutMs);
    window.addEventListener("message", onMessage);
    iframe.srcdoc = withCapture(html);
  });
}
