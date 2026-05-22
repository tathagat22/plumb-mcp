import type { FigmaNode } from "../figma/types";

/** Localhost ports the bridge tries to bind, and the plugin scans to find it. */
export const BRIDGE_PORTS = [31337, 31338, 31339, 31340, 31341];

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

/** An exported asset, carried base64-encoded over the bridge. */
export interface WireAsset {
  id: string;
  name: string;
  format: "SVG" | "PNG";
  dataBase64: string;
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
  | { t: "pong" };

/** Messages the server sends back to the plugin. */
export type ServerMessage =
  | { t: "plumb-hello"; serverVersion: string }
  | { t: "paired" }
  | { t: "pair-rejected"; reason: string }
  | { t: "get-node"; reqId: string; nodeId: string }
  | { t: "get-assets"; reqId: string; nodeId: string }
  | { t: "ping" };
