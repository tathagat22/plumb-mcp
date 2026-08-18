/// <reference types="@figma/plugin-typings" />

/**
 * Server requests, relayed through the UI iframe.
 *
 * The main thread cannot open a socket, so every server request arrives via
 * `figma.ui.postMessage` and every reply goes back the same way. This is the
 * dispatch table for both directions, plus the timeout and queueing that keep
 * a wedged export from stalling the whole plugin.
 */

import { applyDesign } from "./emit";
import { applyFoundations } from "./foundations";
import { wireMotion } from "./motion-emit";
import { collectAssets, collectSpecific } from "./assets";
import { buildVariableMap, serialize } from "./serialize";

/* ------------------------------------------------------------------ */
/* Server requests, relayed through the UI iframe                      */
/* ------------------------------------------------------------------ */

export function reply(message: unknown): void {
  figma.ui.postMessage({ type: "plugin-reply", reply: message });
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function handleGetScreenshot(
  reqId: string,
  nodeId: string,
  scale?: number,
  format?: "PNG" | "JPG",
): Promise<void> {
  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node || node.type === "PAGE" || node.type === "DOCUMENT") {
      reply({ t: "screenshot", reqId, format: "", nodeName: null, error: "node not found" });
      return;
    }
    const f = format ?? "PNG";
    const s = scale ?? 2;
    const settings: any = { format: f, constraint: { type: "SCALE", value: s } };
    const bytes: Uint8Array = await (node as any).exportAsync(settings);
    // Ship the raw bytes through the UI iframe and out over loopback HTTP — no
    // base64. The UI will send the matching `screenshot` WS reply once the
    // upload completes; the bridge resolves the pending promise with the
    // on-disk path it wrote.
    figma.ui.postMessage({
      type: "upload-screenshot",
      reqId,
      bytes,
      format: f,
      nodeName: (node as any).name ?? null,
    });
  } catch (e) {
    reply({ t: "screenshot", reqId, format: "", nodeName: null, error: errMsg(e) });
  }
}

export async function handleGetSearch(
  reqId: string,
  query?: string,
  type?: string,
): Promise<void> {
  try {
    const q = (query ?? "").trim().toLowerCase();
    const t = (type ?? "").toUpperCase();
    const matches: any[] = [];
    const MAX = 50;
    function visit(n: any, page: string, parent: string): void {
      if (matches.length >= MAX) return;
      if (n.visible === false) return;
      const nameOk = !q || ((n.name ?? "") as string).toLowerCase().indexOf(q) !== -1;
      const typeOk = !t || n.type === t;
      if (nameOk && typeOk && n.type !== "PAGE" && n.type !== "DOCUMENT") {
        const bb = n.absoluteBoundingBox;
        const m: any = {
          id: n.id,
          name: n.name,
          type: n.type,
          page,
          w: bb ? Math.round(bb.width) : 0,
          h: bb ? Math.round(bb.height) : 0,
        };
        if (parent) m.parentName = parent;
        matches.push(m);
      }
      // Skip INSTANCE children — they are component mirrors that would flood results.
      if (Array.isArray(n.children) && n.type !== "INSTANCE") {
        for (const c of n.children) visit(c, page, n.name);
      }
    }
    for (const page of figma.root.children) {
      for (const child of page.children) visit(child, page.name, "");
    }
    reply({ t: "search", reqId, matches, error: null });
  } catch (e) {
    reply({ t: "search", reqId, matches: [], error: errMsg(e) });
  }
}

export async function handleGetComponents(reqId: string): Promise<void> {
  try {
    const components: any[] = [];
    const instanceNodes: any[] = []; // collect first, resolve mainComponent after
    const instanceCount = new Map<string, number>();

    function visit(n: any, page: string): void {
      if (n.visible === false) return;
      if (n.type === "COMPONENT" || n.type === "COMPONENT_SET") {
        const bb = n.absoluteBoundingBox;
        const c: any = {
          id: n.id,
          name: n.name,
          page,
          w: bb ? Math.round(bb.width) : 0,
          h: bb ? Math.round(bb.height) : 0,
          instanceCount: 0,
        };
        if (n.description) c.description = n.description;
        components.push(c);
      } else if (n.type === "INSTANCE") {
        instanceNodes.push({ node: n, page });
      }
      if (Array.isArray(n.children) && n.type !== "INSTANCE") {
        for (const c of n.children) visit(c, page);
      }
    }
    for (const page of figma.root.children) {
      for (const child of page.children) visit(child, page.name);
    }

    // Under documentAccess: "dynamic-page", `n.mainComponent` (sync) throws.
    // Use the async variant — and resolve them in parallel batches, because
    // sequential `await` over 10k+ instances will time out the MCP client
    // (the 60s default isn't enough at 5–50 ms per page-load).
    const BATCH = 64;
    const resolved: Array<{ n: any; page: string; main: any | null }> = [];
    for (let i = 0; i < instanceNodes.length; i += BATCH) {
      const slice = instanceNodes.slice(i, i + BATCH);
      const mains = await Promise.all(
        slice.map(({ node: n }) =>
          (n as InstanceNode)
            .getMainComponentAsync()
            .catch(() => null),
        ),
      );
      for (let j = 0; j < slice.length; j++) {
        resolved.push({ n: slice[j]!.node, page: slice[j]!.page, main: mains[j] });
      }
    }
    const instances: any[] = [];
    for (const { n, page, main } of resolved) {
      if (!main) continue; // deleted / orphaned / unresolvable
      instances.push({ id: n.id, name: n.name, componentId: main.id, page });
      instanceCount.set(main.id, (instanceCount.get(main.id) ?? 0) + 1);
    }
    for (const c of components) c.instanceCount = instanceCount.get(c.id) ?? 0;

    reply({ t: "components", reqId, components, instances, error: null });
  } catch (e) {
    reply({ t: "components", reqId, components: [], instances: [], error: errMsg(e) });
  }
}

/** Serialize main-thread operations that produce upload streams across all
 *  paired sessions. Without this, two MCP servers each kicking off `get-assets`
 *  at once would interleave their per-asset upload-ack chains; Figma's IPC
 *  has already been observed buffering & redelivering postMessages under
 *  pressure (see ui.html and the upload-ack gating there). Reads (get-node,
 *  get-search, get-components) skip the queue so a quick lookup from session
 *  B isn't stuck behind a 400ms export from session A. */
let uploadOpQueue: Promise<unknown> = Promise.resolve();

// Just under the server's own longest (apply-design) watchdog, 600s — see
// src/bridge/server.ts. Without this, one session's slow op can hold the
// shared queue past every OTHER session's own (shorter) watchdog: the
// caller gives up, but the queued op still runs later and blocks everyone
// behind it. A timed-out op is abandoned from the queue's point of view
// (the underlying promise may still finish in the background) so the next
// session's request is never stuck waiting on a peer's dead request.
const UPLOAD_OP_TIMEOUT_MS = 590_000;

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`queued op exceeded ${ms}ms — releasing the queue for other sessions`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export function queueUploadOp<T>(fn: () => Promise<T>): Promise<T> {
  const run = () => withTimeout(fn(), UPLOAD_OP_TIMEOUT_MS);
  const next = uploadOpQueue.then(run, run);
  uploadOpQueue = next.catch(() => undefined);
  return next;
}

export async function dispatchServerRequest(req: any): Promise<void> {
  if (!req || typeof req.t !== "string") return;
  // Heavy mutations + exports share the UI↔IPC byte channel and must not
  // interleave across sessions — serialize them through the upload queue.
  if (
    req.t === "get-assets" ||
    req.t === "get-screenshot" ||
    req.t === "apply-design" ||
    req.t === "apply-foundations" ||
    req.t === "apply-motion"
  ) {
    await queueUploadOp(() => handleServerRequest(req));
    return;
  }
  await handleServerRequest(req);
}

export async function handleServerRequest(req: any): Promise<void> {
  if (!req || typeof req.t !== "string") return;

  if (req.t === "get-node") {
    const node = await figma.getNodeByIdAsync(req.nodeId);
    if (!node || node.type === "PAGE" || node.type === "DOCUMENT") {
      reply({ t: "node", reqId: req.reqId, doc: null, nodeName: null });
      return;
    }
    const scene = node as SceneNode;
    const varMap = await buildVariableMap();
    reply({
      t: "node",
      reqId: req.reqId,
      doc: serialize(
        scene,
        varMap,
        typeof req.depth === "number" ? req.depth : undefined,
      ),
      nodeName: scene.name,
    });
    return;
  }

  if (req.t === "get-assets") {
    try {
      const list = req.list === true;
      const raw = req.raw === true;
      const ids: string[] | undefined = Array.isArray(req.ids) ? req.ids : undefined;

      if (ids && ids.length > 0) {
        const assets = await collectSpecific(ids, req.reqId, list, raw);
        reply({ t: "assets", reqId: req.reqId, assets, error: null });
        return;
      }

      const node = await figma.getNodeByIdAsync(req.nodeId);
      if (!node || node.type === "PAGE" || node.type === "DOCUMENT") {
        reply({ t: "assets", reqId: req.reqId, assets: [], error: "node not found" });
        return;
      }
      const assets = await collectAssets(node as SceneNode, req.reqId, { list, raw });
      reply({ t: "assets", reqId: req.reqId, assets, error: null });
    } catch (e) {
      reply({
        t: "assets",
        reqId: req.reqId,
        assets: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return;
  }

  if (req.t === "get-screenshot") {
    await handleGetScreenshot(req.reqId, req.nodeId, req.scale, req.format);
    return;
  }

  if (req.t === "get-search") {
    await handleGetSearch(req.reqId, req.query, req.type);
    return;
  }

  if (req.t === "get-components") {
    await handleGetComponents(req.reqId);
    return;
  }

  // ---- Write direction: three sequenced mutations ------------------------
  if (req.t === "apply-design") {
    try {
      const result = await applyDesign(req.plan, (phase, done, total, note) =>
        reply({ t: "apply-progress", reqId: req.reqId, phase, done, total, note }),
      );
      reply({ t: "applied", reqId: req.reqId, result, error: null });
    } catch (e) {
      reply({ t: "applied", reqId: req.reqId, result: null, error: errMsg(e) });
    }
    return;
  }

  if (req.t === "apply-foundations") {
    try {
      const result = await applyFoundations(req.plan, req.dryRun);
      reply({ t: "foundations", reqId: req.reqId, result, error: null });
    } catch (e) {
      reply({ t: "foundations", reqId: req.reqId, result: null, error: errMsg(e) });
    }
    return;
  }

  if (req.t === "apply-motion") {
    try {
      const idMap = new Map<string, string>(Object.entries(req.idMap ?? {}));
      const result = await wireMotion(req.plan, idMap);
      reply({ t: "motion", reqId: req.reqId, result, error: null });
    } catch (e) {
      reply({ t: "motion", reqId: req.reqId, result: null, error: errMsg(e) });
    }
    return;
  }
}
