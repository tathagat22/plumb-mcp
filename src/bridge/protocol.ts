import type { FigmaNode } from "../figma/types";

/** Localhost ports the bridge tries to bind, and the plugin scans to find it. */
export const BRIDGE_PORTS = [
  31337, 31338, 31339, 31340, 31341, 31342, 31343, 31344, 31345, 31346,
];

/** One screen (top-level frame) in the file inventory. */
export interface InventoryFrame {
  id: string;
  name: string;
  w: number;
  h: number;
}

export interface InventoryPage {
  id: string;
  name: string;
  frames: InventoryFrame[];
}

/** One match returned from plumb_search. */
export interface SearchMatch {
  id: string;
  name: string;
  type: string;
  page: string;
  w: number;
  h: number;
  parentName?: string;
}

/** One component definition. */
export interface ComponentInfo {
  id: string;
  name: string;
  description?: string;
  page: string;
  w: number;
  h: number;
  instanceCount: number;
}

/** One instance usage of a component. */
export interface InstanceInfo {
  id: string;
  name: string;
  componentId: string;
  page: string;
  overrides?: string[];
}

/** An exported asset. Bytes ride the binary HTTP upload channel; this
 *  manifest entry just carries metadata and the on-disk temp path the bridge
 *  wrote. `path` is null in `list: true` mode (no bytes shipped). */
export interface WireAsset {
  id: string;
  name: string;
  format: "SVG" | "PNG" | "JPG" | "GIF" | "WEBP";
  path: string | null;
  /** The id of the nearest ancestor that was also exported — lets the agent
   *  navigate the asset hierarchy (e.g. "this icon is inside that header"). */
  parentId?: string;
}

/** Messages the plugin (WebSocket client) sends to the server. */
export type PluginMessage =
  | { t: "pair"; pluginVersion: string }
  | {
      t: "selection";
      doc: FigmaNode | null;
      fileName: string;
      pageName: string;
      nodeName: string | null;
    }
  | { t: "inventory"; fileName: string; pages: InventoryPage[] }
  | { t: "node"; reqId: string; doc: FigmaNode | null; nodeName: string | null }
  | { t: "assets"; reqId: string; assets: WireAsset[]; error: string | null }
  | {
      t: "screenshot";
      reqId: string;
      format: string;
      nodeName: string | null;
      error: string | null;
    }
  | { t: "search"; reqId: string; matches: SearchMatch[]; error: string | null }
  | {
      t: "components";
      reqId: string;
      components: ComponentInfo[];
      instances: InstanceInfo[];
      error: string | null;
    }
  | { t: "pong" };

/** Messages the server sends back to the plugin. */
export type ServerMessage =
  | { t: "plumb-hello"; serverVersion: string; sessionLabel: string }
  | { t: "paired" }
  | { t: "pair-rejected"; reason: string }
  | { t: "get-node"; reqId: string; nodeId: string }
  | {
      t: "get-assets";
      reqId: string;
      nodeId: string;
      ids?: string[];
      list?: boolean;
      /** When true, IMAGE-fill nodes are exported as the original uploaded
       *  bytes (via getImageByHash) instead of a rasterised PNG render. */
      raw?: boolean;
    }
  | {
      t: "get-screenshot";
      reqId: string;
      nodeId: string;
      scale?: number;
      format?: "PNG" | "JPG";
    }
  | { t: "get-search"; reqId: string; query?: string; type?: string }
  | { t: "get-components"; reqId: string }
  | { t: "ping" };
