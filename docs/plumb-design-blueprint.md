# Plumb Write Direction — Build Blueprint

Status: contracts locked. This document is the single reference every downstream
build agent reads. It synthesizes the 7 subsystem designs into ONE architecture,
resolves every interface mismatch, and assigns every new file to a build task.

Do NOT invent shapes that contradict this file. Where a subsystem design and
this blueprint disagree, THIS BLUEPRINT WINS (the mismatch was resolved here).

---

## 0. The one-paragraph architecture

Today Plumb reads: Figma → `serialize()` → `normalize/*` → PDS → code, verified by
`plumb_verify`/`plumb_fit`. The write direction is the mirror image:

```
prompt
  → DESIGN DSL            (src/dsl/schema.ts — the authoring surface, LOCKED here)
  → compile()             (src/dsl/* — lowers DSL DOWN to the PDS IR, reusing
                           TokenInterner + HandleMinter so IR is byte-shape
                           identical to normalize() output)
  → PdsDocument + sidecar (components + AssetSpec[])
  → resolve assets        (src/assets/* — keyless-first providers, server-side
                           egress, bytes staged on the loopback bridge)
  → lowerToEmitPlan()     (src/emit/plan.ts — PDS → fully-resolved, Figma-native
                           EmitPlan; the server-side inverse of the normalizer)
  → apply-design (WS)     (bridge → plugin; bytes ride GET /asset/:key, NOT WS)
  → figma-plugin/emit.ts  (mechanical executor: create nodes, load fonts, wire
                           auto-layout, createImage; returns EmitResult.ids)
  → apply-foundations     (Variables/styles) + apply-motion (reactions/flows)
  → plumb_review          (re-serialize the built nodes, run verify for STRUCTURE
                           + a deterministic rubric for DESIGN; loop until done)
```

Symmetry payoff: after emit we re-serialize the created Figma nodes back to PDS
and run the EXISTING verify — `EmitResult.ids` (authored `el` → Figma node id) is
the join key that makes the round-trip work.

---

## 1. RESOLVED MISMATCHES (read this first)

The 7 designs collided in several places. These are the binding resolutions.

1. **Wire payload for `apply-design` = `EmitPlan`, NOT raw `PdsDocument`.**
   The write-transport design proposed shipping `doc: PdsDocument`; the emit
   design proposed a pre-lowered `EmitPlan`. **EmitPlan wins.** PDS is lossy and
   read-optimized (token refs `$cN`, repeat compression, `more` boundaries,
   dominant-fill shortcuts). The plugin must stay mechanical, so ALL
   CSS→Figma conversion (rgb 0..1, gradient matrices, degrees-CCW, `{family,style}`
   fonts, enum strings) happens server-side in `src/emit/plan.ts`. The plugin
   just assigns.

2. **One inbound byte channel: `GET /asset/:key.:ext`.** Every subsystem that
   described an inbound route (write-transport `/asset/:token`, emit `/asset/:ref`,
   asset-engine `/asset/:key`) collapses into ONE route with the SAME charset as
   `/upload` (`[A-Za-z0-9_-]+`). The key is the universal asset identity (see #3).
   Providers egress server-side (Node); the plugin only ever GETs from loopback,
   which is already allow-listed — no provider domain is ever added to the manifest.

3. **ONE asset identity key threads the whole pipeline.**
   `PdsNode.assetId` === `ResolvedAsset.assetId` === asset-engine `AssetRef.key`
   === `EmitAsset.ref` === IMAGE-paint `assetRef` === `GET /asset/:key`.
   The compiler drops the resolved key on `PdsNode.assetId`; `lowerToEmitPlan`
   copies it to `EmitAsset.ref` + the paint; the plugin GETs `/asset/:key`.

4. **Bytes are eager-hydrated by the UI thread.** The UI pre-fetches every
   `plan.assets[i].ref` via `GET /asset/:key`, attaches `data: Uint8Array` on the
   plan, and postMessages the hydrated plan to main ONCE. No per-asset
   `fetch-asset`/`asset-bytes` relay round-trip (that lazy path is a documented
   future option for 100+ asset plans; not built now). Sub-8KB SVGs are inlined
   as `svgInline` and skip the GET entirely.

5. **ui.html forward filter becomes FULLY GENERIC**, not an `apply-` allow-set.
   Forward ANY frame where `msg.reqId` is set and `msg.t` is a string. This honors
   the "UI dispatcher must be generic" rule and covers every current + future verb
   (get-*, apply-design, apply-foundations, apply-motion) with zero further edits.

6. **EmitResult naming unified.** write-transport `nodeMap`, emit `ids`, critique
   `elMap` are the SAME map (authored `el` → Figma node id, because EmitPlan op
   `key` === PDS `el`). Canonical name: **`EmitResult.ids`**. `plumb_review`
   consumes `ids` as its `elMap`.

7. **`apply-design` gets a heartbeat.** Keep write-transport's non-terminal
   `apply-progress` message. It does NOT resolve the pending request; it resets a
   600s watchdog and drives Studio. `emitDocument` must ping at each phase boundary.

8. **Three separate write verbs, sequenced by the orchestrator**, not one mega-call:
   `apply-foundations` (pure JSON Variables/styles) → `apply-design` (geometry +
   assets, returns `ids`) → `apply-motion` (reactions/flows, CONSUMES `ids`).
   Motion runs LAST because reactions reference destination node ids.

9. **PDS additive fields (all optional, reader-compatible).** Merge into
   `src/pds.ts`: `PdsNode.textAlign`, `PdsNode.overflow`, `PdsNode.overlayCfg`;
   `MotionSpec` authoring ext (`navigation, direction, matchLayers, timeout, keys,
   url, setVars, preserveScroll, resetState, spring`); `PdsPrototype` +
   `PdsDocument.prototype`. `text-transform` is NOT added — bake into `chars` and
   record a warning (lossy on round-trip, acceptable).

10. **Canonical `AssetKind`** lives in `src/assets/types.ts` and is mirrored in
    `src/dsl/schema.ts`. Superset: `icon | photo | illustration | avatar | pattern
    | font | mockup | logo | generated`. `"bg"` is a role, not a kind.

11. **DSL request type = `AssetSpec`** (asset-engine name wins over the DSL
    design's `AssetRef`). The compiler emits `AssetSpec`; the asset engine returns
    `ResolvedAsset` (whose `assetId` is the inbound key).

12. **Compile entrypoint is `compile(doc, ctx)`** exported from `src/dsl/`
    (barrel re-exports it). The write tool imports `{ compile }`. There is no
    separate `compileDesign`; treat any reference to `compileDesign` as `compile`.

---

## 2. PROTOCOL ADDITIONS — paste into `src/bridge/protocol.ts`

Add this block. Note `apply-design` carries `EmitPlan`; PdsDocument is NOT on the
wire. Emit* interfaces are the shared wire contract (server lowering ↔ plugin
executor). Import nothing from PDS here — EmitPlan is self-contained.

```ts
// ============================================================================
// WRITE DIRECTION — emit / foundations / motion wire contract
// ============================================================================

// ---- Inbound assets: bytes live at GET /asset/:ref.:ext on the bridge ------
export interface EmitAsset {
  /** Plan-local id; equals PdsNode.assetId. GET /asset/<ref>.<ext>. */
  ref: string;
  ext: "png" | "jpg" | "webp" | "gif" | "svg";
  mime?: string;
  /** image → figma.createImage(bytes); svg → figma.createNodeFromSvg(text). */
  kind: "image" | "svg";
  /** Filled by the UI thread before forwarding to main; ABSENT on the WS wire. */
  data?: Uint8Array;
  w?: number;
  h?: number;
}

export interface FontFace {
  family: string;
  /** e.g. "Regular", "Bold", "Semi Bold". */
  style: string;
}

export type EmitNodeType =
  | "frame" | "text" | "rect" | "ellipse" | "line" | "vector" | "instance" | "group";

export interface EmitLayout {
  mode: "HORIZONTAL" | "VERTICAL";
  gap?: number;
  gapCross?: number;
  pad: { t: number; r: number; b: number; l: number };
  primary?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counter?: "MIN" | "CENTER" | "MAX" | "BASELINE";
  wrap?: boolean;
}

export interface EmitChildLayout {
  grow?: number;
  align?: "MIN" | "CENTER" | "MAX" | "STRETCH" | "INHERIT";
  sizingH?: "FIXED" | "HUG" | "FILL";
  sizingV?: "FIXED" | "HUG" | "FILL";
}

export type EmitPaint =
  | { type: "SOLID"; color: { r: number; g: number; b: number }; opacity?: number; boundVar?: string }
  | {
      type: "GRADIENT_LINEAR" | "GRADIENT_RADIAL" | "GRADIENT_ANGULAR" | "GRADIENT_DIAMOND";
      stops: { position: number; color: { r: number; g: number; b: number; a: number } }[];
      transform?: [[number, number, number], [number, number, number]];
      opacity?: number;
    }
  | { type: "IMAGE"; assetRef: string; scaleMode?: "FILL" | "FIT" | "CROP" | "TILE"; opacity?: number };

export type EmitEffect =
  | {
      type: "DROP_SHADOW" | "INNER_SHADOW";
      color: { r: number; g: number; b: number; a: number };
      offset: { x: number; y: number };
      radius: number;
      spread?: number;
    }
  | { type: "LAYER_BLUR" | "BACKGROUND_BLUR"; radius: number };

export interface EmitTextRun {
  start: number;
  end: number;
  font?: FontFace;
  fontSize?: number;
  fills?: EmitPaint[];
  lineHeightPx?: number;
  letterSpacing?: number;
  decoration?: "UNDERLINE" | "STRIKETHROUGH";
}

export interface EmitText {
  characters: string;
  font: FontFace; // MUST be a member of EmitPlan.fonts
  fontSize: number;
  lineHeightPx?: number;
  letterSpacing?: number;
  align?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  decoration?: "UNDERLINE" | "STRIKETHROUGH";
  autoResize?: "NONE" | "HEIGHT" | "WIDTH_AND_HEIGHT" | "TRUNCATE";
  runs?: EmitTextRun[];
}

export interface EmitNode {
  type: EmitNodeType;
  name?: string;
  size: { w: number; h: number };
  pos?: { x: number; y: number };
  absolute?: boolean;
  layout?: EmitLayout;
  child?: EmitChildLayout;
  fills?: EmitPaint[];
  strokes?: EmitPaint[];
  strokeWeight?: number;
  strokeAlign?: "INSIDE" | "OUTSIDE" | "CENTER";
  strokeSides?: { t: number; r: number; b: number; l: number };
  dashPattern?: number[];
  cornerRadius?: number | [number, number, number, number]; // [tl,tr,br,bl]
  effects?: EmitEffect[];
  opacity?: number;
  clip?: boolean;
  rotation?: number; // Figma-native degrees CCW (server pre-converts)
  blendMode?: string;
  constraints?: { h?: string; v?: string };
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  text?: EmitText;
  vectorPaths?: { data: string; windingRule?: "NONZERO" | "EVENODD" }[];
  instanceOf?: string;
  componentProps?: Record<string, string | boolean | number>;
}

export interface EmitOp {
  key: string; // stable plumb key = PDS `el`; written to pluginData 'plumbKey'
  parent: string | null; // parent op key; null for root
  node: EmitNode;
}

export type EmitTarget =
  | { kind: "page"; pos?: { x: number; y: number }; pageName?: string }
  | { kind: "into"; nodeId: string }
  | { kind: "replace"; nodeId: string };

export interface EmitPlan {
  planId: string;
  target: EmitTarget;
  mode: "create" | "sync";
  prune?: boolean;
  fonts: FontFace[]; // deduped {family,style} of every op + run; loaded up-front
  assets?: EmitAsset[];
  ops: EmitOp[]; // ORDERED, parent-before-child
  reveal?: boolean;
}

export interface EmitWarning {
  key: string;
  field: string;
  message: string;
}

export interface EmitResult {
  rootId: string; // created/updated root Figma id
  rootKey: string;
  created: number;
  updated: number;
  deleted: number;
  ids: Record<string, string>; // authored el (op.key) → Figma node id
  warnings: EmitWarning[];
}

// ---- Foundations (Variables / text / effect / grid styles) -----------------
export type VarValue = { hex: string } | { number: number } | { alias: string };
export interface VarSpec {
  name: string; // "primary/500" (slash = Figma group)
  type: "COLOR" | "FLOAT";
  values: Record<string, VarValue>; // modeName → value|alias
  scopes?: string[];
}
export interface VarCollectionSpec { name: string; modes: string[]; variables: VarSpec[]; }
export interface TextStyleSpec {
  name: string;
  family: string;
  weight: number;
  sizePx: number;
  lineHeightPercent?: number;
  letterSpacingPx?: number;
  textCase?: "ORIGINAL" | "UPPER";
  boundVars?: { fontSize?: string; lineHeight?: string };
}
export interface EffectStyleSpec { name: string; effects: ShadowEffectWire[]; }
export interface ShadowEffectWire {
  type: "drop-shadow" | "inner-shadow";
  x: number; y: number; blur: number; spread: number; color: string;
}
export interface GridStyleSpec {
  name: string;
  pattern: "COLUMNS" | "GRID" | "ROWS";
  count?: number;
  gutterPx?: number;
  marginPx?: number;
  sectionSizePx?: number;
  alignment?: "STRETCH" | "CENTER" | "MIN" | "MAX";
}
export interface FoundationsPlan {
  collections: VarCollectionSpec[];
  textStyles: TextStyleSpec[];
  effectStyles: EffectStyleSpec[];
  gridStyles: GridStyleSpec[];
}
export interface FoundationsResult {
  collections: { name: string; id: string; modeIds: Record<string, string>; variableIds: Record<string, string> }[];
  textStyleIds: Record<string, string>;
  effectStyleIds: Record<string, string>;
  gridStyleIds: Record<string, string>;
  warnings: string[];
}

// ---- Motion (prototype reactions / flow starts / device / scroll) ----------
export interface WireSpec {
  trigger:
    | "ON_CLICK" | "ON_HOVER" | "ON_PRESS" | "ON_DRAG"
    | "MOUSE_ENTER" | "MOUSE_LEAVE" | "MOUSE_UP" | "MOUSE_DOWN"
    | "AFTER_TIMEOUT" | "ON_KEY_DOWN";
  navigation:
    | "NAVIGATE" | "SWAP" | "OVERLAY" | "SCROLL_TO"
    | "BACK" | "CLOSE" | "URL" | "SET_VAR";
  target?: string; // destination PDS el (resolved via idMap)
  kind?:
    | "SMART_ANIMATE" | "DISSOLVE" | "MOVE_IN" | "MOVE_OUT" | "PUSH"
    | "SLIDE_IN" | "SLIDE_OUT" | "SCROLL_ANIMATE" | "INSTANT";
  direction?: "LEFT" | "RIGHT" | "TOP" | "BOTTOM";
  durationMs?: number; // emit divides by 1000
  easing?: string; // named | "bezier:x1,y1,x2,y2" | "spring:mass,stiff,damp"
  matchLayers?: boolean;
  timeoutMs?: number;
  keys?: number[];
  url?: string;
  setVars?: Record<string, string | number | boolean>; // key = Figma variable id
  preserveScroll?: boolean;
  resetState?: boolean;
}
export interface WireBinding { sourceEl: string; specs: WireSpec[]; }
export interface WireOverlay {
  position:
    | "CENTER" | "TOP_LEFT" | "TOP_CENTER" | "TOP_RIGHT"
    | "BOTTOM_LEFT" | "BOTTOM_CENTER" | "BOTTOM_RIGHT" | "MANUAL";
  at?: { x: number; y: number };
  backdrop?: string;
  closeOnClickOutside?: boolean;
}
export interface WireFrame {
  el: string;
  overflow?: "NONE" | "HORIZONTAL" | "VERTICAL" | "BOTH";
  overlay?: WireOverlay; // applied to the DESTINATION frame, not the click source
}
export interface WirePrototype {
  starts: { el: string; name: string }[];
  device?: {
    kind: "none" | "preset" | "custom";
    preset?: string;
    size?: { w: number; h: number };
    rotation?: "NONE" | "CW_90";
  };
  background?: string;
}
export interface MotionPlan {
  bindings: WireBinding[];
  frames: WireFrame[];
  prototype?: WirePrototype;
}
export interface MotionResult { wired: number; misses: string[]; error: string | null; }

// ---- Progress heartbeat ----------------------------------------------------
export interface ApplyProgressMessage {
  t: "apply-progress";
  reqId: string;
  phase: "variables" | "assets" | "nodes" | "layout" | "motion" | "finalize";
  done: number;
  total: number;
  note?: string;
}

// ============================================================================
// ServerMessage union — ADD these variants
// ============================================================================
//   | { t: "apply-design"; reqId: string; plan: EmitPlan }
//   | { t: "apply-foundations"; reqId: string; plan: FoundationsPlan; dryRun?: boolean }
//   | { t: "apply-motion"; reqId: string; plan: MotionPlan; idMap?: Record<string, string> }

// ============================================================================
// PluginMessage union — ADD these variants
// ============================================================================
//   | ApplyProgressMessage                                   // NON-TERMINAL
//   | { t: "applied"; reqId: string; result: EmitResult | null; error: string | null }
//   | { t: "foundations"; reqId: string; result: FoundationsResult | null; error: string | null }
//   | { t: "motion"; reqId: string; result: MotionResult | null; error: string | null }
```

Also add the exports and widen `BRIDGE_PORTS` is unchanged (already 31337-31346).

---

## 3. BRIDGE — `src/bridge/server.ts` additions

### requestX wrappers (mirror the existing `request(build, timeoutMs, label)`):

```ts
export function requestApply(
  plan: EmitPlan,
  onProgress?: (p: ApplyProgressMessage) => void,
): Promise<{ result: EmitResult | null; error: string | null }>;
// 600_000ms watchdog, RESET by each apply-progress (heartbeat).

export function requestApplyFoundations(
  plan: FoundationsPlan,
  dryRun?: boolean,
): Promise<FoundationsResult>;
// request((reqId)=>({t:"apply-foundations",reqId,plan,dryRun}), 120_000, "foundations")

export function requestApplyMotion(
  plan: MotionPlan,
  idMap?: Record<string, string>,
): Promise<MotionResult>;
// request((reqId)=>({t:"apply-motion",reqId,plan,idMap}), 120_000, "motion")

/** Stage bytes for the plugin to pull. Returns the key for GET /asset/:key.:ext.
 *  TTL 10 min, lazy-expired on GET. Called by plumb_apply after the asset engine
 *  resolves each asset. (Asset engine's inbound.registerAsset delegates here, or
 *  owns the map — pick ONE; server.ts is the canonical home for the HTTP route.) */
export function stageInboundAsset(bytes: Buffer | Uint8Array, ext: string): string;
```

### server.ts internal edits:

- `interface Pending { resolve; reject; timer }` — make `timer` reassignable.
- Add `const progressListeners = new Map<string, (p: ApplyProgressMessage) => void>();`
- Add `const inbound = new Map<string, { bytes: Buffer; contentType: string; expires: number }>();`
- `rejectAllPending()` must also `progressListeners.clear()`.
- **ws.on("message") switch — add cases:**
  ```ts
  case "apply-progress": {
    const p = pending.get(msg.reqId);
    if (p) { clearTimeout(p.timer); p.timer = setTimeout(/* same reject */, 600_000); }
    progressListeners.get(msg.reqId)?.(msg);
    break; // NON-TERMINAL: do NOT resolvePending
  }
  case "applied":
    progressListeners.delete(msg.reqId);
    resolvePending(msg.reqId, { result: msg.result, error: msg.error });
    break;
  case "foundations":
    resolvePending(msg.reqId, msg.result ?? { /* throw on error */ });
    break;
  case "motion":
    resolvePending(msg.reqId, msg.result ?? { wired: 0, misses: [], error: msg.error });
    break;
  ```
- **`handleHttp()`:** change `Access-Control-Allow-Methods` to `"GET, POST, OPTIONS"`.
  In the `GET` branch, BEFORE `serveStudio`, match
  `/^\/asset\/([A-Za-z0-9_-]+)\.([a-z0-9]+)$/` and stream the staged Buffer with
  the right `Content-Type` (404 on miss/expired; lazy-expire on read).

---

## 4. `figma-plugin/ui.html` — the GENERIC filter (the single most bug-prone edit)

At ~line 320, replace the `get-` prefix check with a fully generic reqId check,
and eager-hydrate asset bytes on `apply-design` before forwarding to main:

```js
// window.onmessage from the WebSocket (server → plugin):
if (msg.reqId && typeof msg.t === "string") {
  var mainReqId = rewriteIn(port, msg.reqId);
  routing[mainReqId] = { port: port, origReqId: msg.reqId };
  var copy = {}; for (var k in msg) copy[k] = msg[k];
  copy.reqId = mainReqId;
  if (msg.t === "apply-design" && copy.plan && copy.plan.assets) {
    // Eager-hydrate: GET each /asset/:ref.:ext, attach data, THEN forward once.
    hydrateAssets(port, copy, function (hydrated) {
      toMain({ type: "server-request", req: hydrated });
    });
  } else {
    toMain({ type: "server-request", req: copy });
  }
  return;
}
```

`hydrateAssets(port, req, cb)`: for each `req.plan.assets[i]` where `!a.svgInline`,
`GET http://localhost:<port>/asset/<a.ref>.<a.ext>` → `arrayBuffer` →
`a.data = new Uint8Array(buf)`; when all done, `cb(req)`.

**forwardReply guard (reply relay, plugin → server):** `apply-progress` is
NON-TERMINAL — forward it but DO NOT delete `routing[reqId]`, or the terminal
`applied` gets stranded:

```js
function forwardReply(reply) {
  var route = routing[reply.reqId];
  if (!route) return;
  var out = {}; for (var k in reply) out[k] = reply[k];
  out.reqId = route.origReqId;
  wsFor(route.port).send(JSON.stringify(out));
  if (reply.t !== "apply-progress") delete routing[reply.reqId]; // keep routing alive for heartbeats
}
```

No `fetch-asset`/`asset-bytes` verbs are needed with eager hydration.

---

## 5. `figma-plugin/code.ts` — dispatch hooks

```ts
import { applyDesign } from "./emit";          // geometry executor
import { applyFoundations } from "./foundations"; // Variables/styles executor
import { wireMotion } from "./motion";          // prototype executor

// dispatchServerRequest(): route the three heavy mutations through the existing
// queueUploadOp serializer (they share the UI↔IPC byte channel + must not
// interleave across sessions):
if (req.t === "apply-design" || req.t === "apply-foundations" || req.t === "apply-motion") {
  queueUploadOp(() => handleServerRequest(req));
  return;
}

// handleServerRequest(): if-chain additions
if (req.t === "apply-design") {
  try {
    const result = await applyDesign(req.plan, (phase, done, total, note) =>
      reply({ t: "apply-progress", reqId: req.reqId, phase, done, total, note }));
    reply({ t: "applied", reqId: req.reqId, result, error: null });
  } catch (e) {
    reply({ t: "applied", reqId: req.reqId, result: null, error: errMsg(e) });
  }
  return;
}
if (req.t === "apply-foundations") {
  try { reply({ t: "foundations", reqId: req.reqId, result: await applyFoundations(req.plan, req.dryRun), error: null }); }
  catch (e) { reply({ t: "foundations", reqId: req.reqId, result: null, error: errMsg(e) }); }
  return;
}
if (req.t === "apply-motion") {
  try {
    const idMap = new Map(Object.entries(req.idMap ?? {}));
    reply({ t: "motion", reqId: req.reqId, result: await wireMotion(req.plan, idMap), error: null });
  } catch (e) { reply({ t: "motion", reqId: req.reqId, result: null, error: errMsg(e) }); }
  return;
}
```

**Paper cut #2:** replace hardcoded `PLUGIN_VERSION = "0.0.1"` with the package
version (0.12.0) in code.ts AND ui.html.

---

## 6. `figma-plugin/manifest.json` — paper cut #1

`networkAccess.allowedDomains` currently lists ports 31337-31341. Widen BOTH the
`http://127.0.0.1:<port>` and `ws://127.0.0.1:<port>` entries to 31337-**31346**
(the full `BRIDGE_PORTS` range) so WS control + the new `/asset` GET work on every
bridge port. Also add `figma-plugin/emit.ts`, `foundations.ts`, `motion.ts` to
`figma-plugin/tsconfig.json` `include`.

---

## 7. DSL → PDS lowering rules (`src/dsl/*`)

`compile(doc: DesignDoc, ctx: CompileContext): Promise<CompileResult>` where:

```ts
interface CompileContext { assets: AssetResolver; measure?: TextMeasurer; page?: { width?: number }; }
interface CompileResult {
  doc: PdsDocument;                                                   // shape-identical to normalize()
  components: Record<string, { id: string; el: string; props: PropDef[] }>; // sidecar
  assetRequests: AssetSpec[];
  warnings: string[];
}
```

Pipeline: `tokens → sections → components/blocks → layout → assemble PdsDocument`.
REUSE `TokenInterner` (src/normalize/tokens.ts) and `HandleMinter`
(src/normalize/handles.ts) so tokens use identical `$cN/$tN/$rN/$sN` + compound
`$lN/$fN/$eN` encodings — the emitted IR is indistinguishable from Figma-sourced
PDS, so verify/fit are untouched.

Lowering table (implemented across tokens.ts / blocks.ts / layout.ts / compile.ts):

| DSL construct | → PDS |
| --- | --- |
| `Brand.colors[role]` | `internColor(hex)` → `tokens.color[$cN]`; role kept in a RefMap |
| `Brand.type[name]` | synth `FigmaTypeStyle` → `internText` → `tokens.text[$tN]` |
| `Brand.radius[key]` | `internRadius` → `tokens.radius[$rN]` |
| `Brand.shadow[key]` | `internShadow(css)` → `tokens.shadow[$sN]` |
| Gradient / image bg | `Fill[]` → `internFills` → `node.fills = $fN` (+ `node.assetId` for image) |
| `Page` | `PdsNode{type:"frame", box:{w:width,h:measured}, layout:{flow:col,pad}, fill:bg}`, children = sections |
| `Section` (any role) | registry `lowerSection()` expands to a Stack Block, then Stack lowering |
| `Stack` | `PdsNode{type:"frame", layout:{flow=dir, gap, pad, justify(map), align(map), wrap, gapCross}}` → `internLayout` → `node.layout=$lN`; box+sizing from layout.ts |
| `Text` | `PdsNode{type:"text", text:$tN, chars, fill:$cN, textDecoration, textAlign, textGrow(resize), box from ctx.measure}` |
| `Image` | `await resolve(spec)`; `PdsNode{type:"rect", fills:[ImageFill{assetId=key,scaleMode}], assetId:key, box}` |
| `Icon` | `await resolve(spec)`; inline → `PdsNode{type:"vector", vectorPath:d, fill:$cN, iconHint}`; else `assetId` |
| `Button` | `PdsNode{type:"frame", pattern:"button", layout row(pad by size,gap), fill/stroke by variant→brand roles, radius, children=[Icon?, Text]}` |
| `Field` | `Stack(col){ Text(label)?, Stack(input: border, radius, pad, Text(placeholder muted)) }` |
| `Instance` | clone component template w/ props/slots substituted; root node gets `component={id:"dsl:<name>"}` + `props`→`internProps($pN)` |
| `Slot` (in body) | replaced by `Instance.slots[name]` children at expansion |
| `Spacer`/`Divider` | `PdsNode` rect/frame fixed box / 1px line + stroke |
| `self`/`grow`/sizing | layout.ts sets `node.grow`, `node.selfAlign`, `node.sizing` |
| `pos` | `node.pos` (parent emitted without layout → absolute children) |
| `interactions` | `node.motion` (MotionSpec[] via src/emit/motion/compile.ts) |
| `Page.start/overlay/scroll` | `PdsDocument.prototype` + `node.overflow` / `node.overlayCfg` |

Variant → brand role map for Button: `primary`→fill primary / text onPrimary;
`outline`→stroke primary; `ghost`→transparent; `link`→text-only underline;
`secondary`→fill surface/muted.

Assemble into `PdsDocument{ file, root, tokens: interner.table(), nodes,
meta{nodeCount,estTokens,depthUsed}, next }` exactly like
`src/normalize/normalize.ts`.

Box sizing is DERIVED + best-effort (layout.ts two-pass flexbox). Emit
`sizing`/`grow` intent (hug/fill) so Figma auto-layout finalizes on emit; verify
tolerates. Text boxes come from `ctx.measure` or a documented estimator fallback.

Asset resolution: batch-resolve unique `AssetSpec`s up front, cache by
`(query,kind,seed)`. A rejected resolve MUST be caught and downgraded to a
placeholder (never fail the whole page).

---

## 8. Asset engine (`src/assets/*`)

Provider-agnostic. `resolveAsset(spec, reg, ctx)` = search → rank → fetch best →
recolor → `registerAsset` (stage bytes, get key) → `ResolvedAsset{assetId:key,...}`.
`resolveIconSet` locks ONE Iconify pack across the whole design.

### Provider registry (`registerDefaultProviders`), all behind `AssetProvider`:

| Provider | Kinds | Key env | Keyless fallback |
| --- | --- | --- | --- |
| iconify | icon | none | always available |
| unsplash | photo | `UNSPLASH_ACCESS_KEY` | drops if absent |
| pexels | photo | `PEXELS_API_KEY` | drops if absent |
| pixabay | photo | `PIXABAY_API_KEY` | drops if absent |
| picsum | photo | none | always (photo fallback) |
| illustrations (unDraw/Open Doodles/Humaaans) | illustration | none | bundled SVG manifest |
| dicebear | avatar | none | always |
| heroPatterns | pattern | none | bundled templates |
| mockups | mockup | none | bundled frames + MockupRecipe |
| googleFonts | font | `GOOGLE_FONTS_API_KEY` | css2 @font-face parse |

Rules: server-side egress only; manifest stays loopback-only; missing key silently
drops that provider (never crash); license hard-gated + `ATTRIBUTIONS.md`; two-tier
disk cache under `PLUMB_ASSETS_DIR/.cache`; sub-8KB SVG inlined as `svgInline`.
Later (same interface, not now): Openverse, Wikimedia, Clearbit/Brandfetch,
Haikei/BGJar, Storyset/DrawKit, Fontsource/Bunny, placehold.co, nano-banana.

---

## 9. FILE MAP — every new/edited file assigned to a build task

### Task: `dsl-compiler`
| File | New/Edit | Purpose |
| --- | --- | --- |
| `src/dsl/schema.ts` | DONE | Authoritative DSL types + zod (this blueprint's deliverable) |
| `src/dsl/tokens.ts` | NEW | Brand → TokenTable via reused TokenInterner + RefMap resolvers |
| `src/dsl/layout.ts` | NEW | Two-pass flexbox measure → box/sizing/grow/selfAlign |
| `src/dsl/blocks.ts` | NEW | Recursive Block → PdsNode lowerer (mints el via HandleMinter) |
| `src/dsl/sections.ts` | NEW | Pluggable section registry + built-in lowerers |
| `src/dsl/components.ts` | NEW | Component template expansion + `dsl:<name>` ids + sidecar |
| `src/dsl/compile.ts` | NEW | `compile(doc, ctx): CompileResult` orchestrator |
| `src/dsl/motion.ts` | NEW | DSL motion authoring types (re-exported from schema.ts too) |
| `src/dsl/index.ts` | NEW | Barrel: types, DesignDocSchema, compile, registerSection |
| `src/dsl/examples/landing.ts` | NEW | Worked example: landing page |
| `src/dsl/examples/feature-card.ts` | NEW | Worked example: component + instance |
| `src/pds.ts` | EDIT | Additive: `textAlign`, `overflow`, `overlayCfg`, MotionSpec ext, `PdsPrototype`, `PdsDocument.prototype` |

### Task: `asset-providers`
| File | New/Edit | Purpose |
| --- | --- | --- |
| `src/assets/types.ts` | NEW | Canonical AssetKind/StyleTag/IconWeight, LicenseRef, AssetCandidate, FetchedAsset, AssetSpec, MockupRecipe, FontMeta |
| `src/assets/provider.ts` | NEW | AssetProvider + AssetProviderContext |
| `src/assets/registry.ts` | NEW | AssetRegistry + registerDefaultProviders |
| `src/assets/search.ts` | NEW | searchAssets / resolveAsset / resolveIconSet |
| `src/assets/rank.ts` | NEW | scoreCandidate / rankCandidates / pickIconPack |
| `src/assets/inbound.ts` | NEW | registerAsset → AssetRef{key}; delegates staging to server.stageInboundAsset; svgInline<8KB |
| `src/assets/recolor.ts` | NEW | SVG recolor |
| `src/assets/license.ts` | NEW | LicenseRef presets + AttributionCollector |
| `src/assets/cache.ts` | NEW | Two-tier disk cache |
| `src/assets/http.ts` | NEW | fetch helpers (UA, timeout, retry) |
| `src/assets/index.ts` | NEW | Barrel + buildContext() |
| `src/assets/providers/*.ts` | NEW | iconify, unsplash, pexels, pixabay, picsum, illustrations, dicebear, heroPatterns, mockups, googleFonts |
| `src/assets/providers/bundled/` | NEW | Curated SVGs + JSON manifests |

### Task: `asset-tool`
| File | New/Edit | Purpose |
| --- | --- | --- |
| `src/tools/asset.ts` | NEW | `plumb_asset` (mode search\|resolve), `readOnlyHint:false` |
| `src/server.ts` | EDIT | register `plumb_asset` |

### Task: `plugin-emit`
| File | New/Edit | Purpose |
| --- | --- | --- |
| `src/emit/plan.ts` | NEW | `lowerToEmitPlan(pds, opts): EmitPlan` (server-side inverse of normalizer) |
| `figma-plugin/emit.ts` | NEW | `applyDesign(plan, onProgress): EmitResult` — mechanical executor |
| `figma-plugin/code.ts` | EDIT | import + dispatch hooks (§5), queueUploadOp routing, PLUGIN_VERSION |
| `figma-plugin/ui.html` | EDIT | generic filter + hydrateAssets + forwardReply guard (§4), PLUGIN_VERSION |
| `figma-plugin/manifest.json` | EDIT | ports → 31346 (§6) |
| `figma-plugin/tsconfig.json` | EDIT | include emit.ts/foundations.ts/motion.ts |
| `src/bridge/protocol.ts` | EDIT | Emit* + apply-design/applied/apply-progress (§2) |
| `src/bridge/server.ts` | EDIT | requestApply + stageInboundAsset + /asset route + ws cases (§3) |

### Task: `write-tool`
| File | New/Edit | Purpose |
| --- | --- | --- |
| `src/tools/apply.ts` | NEW | `plumb_apply` — compile → resolve assets → stage → lowerToEmitPlan → requestApply → re-serialize + verify; `readOnlyHint:false` |
| `src/server.ts` | EDIT | register `plumb_apply` |

### Task: `foundations` (design-brain)
| File | New/Edit | Purpose |
| --- | --- | --- |
| `src/design/brief.ts` | NEW | DesignBrief + briefSchema + deriveBrief |
| `src/design/foundations.ts` | NEW | Foundations IR + FoundationsPlan + FoundationSeed + FoundationsResult |
| `src/design/synth.ts` | NEW | synthesizeFoundations / compileFoundationsPlan / foundationSeed |
| `src/design/color.ts` | NEW | OKLCH ramps + hexToRgba01 + WCAG contrastRatio |
| `src/tools/brief.ts` | NEW | `plumb_brief` (readOnly) |
| `src/tools/foundations.ts` | NEW | `plumb_foundations` (`readOnlyHint:false`) |
| `figma-plugin/foundations.ts` | NEW | `applyFoundations(plan, dryRun)` — two-pass Variables + styles |
| `src/bridge/protocol.ts` | EDIT | FoundationsPlan/Result + apply-foundations/foundations |
| `src/bridge/server.ts` | EDIT | requestApplyFoundations + ws case |
| `src/server.ts` | EDIT | register `plumb_brief` + `plumb_foundations` |

### Task: `motion`
| File | New/Edit | Purpose |
| --- | --- | --- |
| `src/emit/motion/compile.ts` | NEW | DSL interactions → MotionSpec[] on PdsNodes + PdsPrototype |
| `src/emit/motion/plan.ts` | NEW | `buildMotionPlan(pds): MotionPlan` |
| `figma-plugin/motion.ts` | NEW | `wireMotion(plan, idMap): MotionResult` — setReactionsAsync/flows/device |
| `src/bridge/protocol.ts` | EDIT | MotionPlan/WireSpec/... + apply-motion/motion |
| `src/bridge/server.ts` | EDIT | requestApplyMotion + ws case |
| `src/tools/motion.ts` | NEW (optional) | `plumb_wire` incremental motion tool |
| `src/server.ts` | EDIT | register `plumb_wire` (if included) |

### Task: `critique`
| File | New/Edit | Purpose |
| --- | --- | --- |
| `src/review/index.ts` | NEW | buildReviewResponse (blends structure + design), types |
| `src/review/pdsAdapter.ts` | NEW | remapBuiltToAuthored(built, ids) + pdsToRendered(built) |
| `src/review/rubric.ts` | NEW | critiqueDesign — 6 dimensions |
| `src/review/contrast.ts` | NEW | WCAG relativeLuminance + contrastRatio |
| `src/tools/review.ts` | NEW | `plumb_review` (readOnly) |
| `src/server.ts` | EDIT | register `plumb_review` |

`plumb_review` consumes `EmitResult.ids` as its `elMap` (join key authored el →
Figma id); the authored PDS is passed inline or via `authoredPath` (a JSON the
compile step writes). It reuses resolveVerifyTarget, verifyAgainst, scoreOf,
renderBar, requestScreenshot, emitStudio (kind:"fit") unchanged.

---

## 10. Orchestration (the loop)

```
prompt
 → plumb_brief         (DesignBrief)
 → plumb_foundations   (synth → FoundationsPlan → apply-foundations → FoundationSeed)
 → build DesignDoc     (agent authors DSL, seeded by FoundationSeed; validate DesignDocSchema)
 → plumb_apply         (compile → assets → lowerToEmitPlan → apply-design → EmitResult.ids)
 → plumb_wire          (buildMotionPlan → apply-motion, consumes ids)   [if interactions]
 → plumb_review        (re-serialize built + verify + rubric → done? fixes[])
 → if !done: re-author DSL from fixes[].dslHint, re-apply (mode:"sync" keeps plumbKey)
```

`mode:"sync"` idempotent re-apply hinges on `plumbKey` (= authored `el`) stability:
the compiler MUST derive `el` from semantic identity (DSL id/path), NOT positional
ordinals, or sync deletes+recreates and loses convergence.

---

## 11. Cross-cutting invariants (do not break)

- Binary NEVER over WS: inbound bytes ride `GET /asset/:key`; outbound
  (screenshots/exports) ride `POST /upload/:reqId` — unchanged.
- The plugin is a mechanical executor: NO CSS parsing / math in emit.ts. All
  conversion is server-side in `src/emit/plan.ts` (inverse of `serialize()`).
- Fonts: `EmitPlan.fonts` is the deduped set; `applyDesign` `loadFontAsync` ALL of
  them (with fallback → warning) BEFORE creating any TEXT; `setCharacters` only
  after `fontName` is a loaded face.
- Auto-layout order: create frame → set `layoutMode`+gap/pad/align → append
  children → THEN per-child `layoutSizing*`/`layoutGrow` (guarded try/catch).
- Rotation: server emits Figma-native degrees CCW; plugin just assigns.
- Overlay preset position/backdrop come from the DESTINATION frame
  (`overlayPositionType`/`overlayBackground`), never the click action.
- `setReactionsAsync` REPLACES all reactions — one WireBinding batches ALL specs
  per source node.
- Any resolve/emit failure is per-node/per-asset stub-and-continue with a warning
  (strict:false default), mirroring `serialize()`'s defense-in-depth. Callers MUST
  surface `warnings`, not just `error`.
