import type { FigmaNode } from "../figma/types";

/** Localhost ports the bridge tries to bind, and the plugin scans to find it. */
export const BRIDGE_PORTS = [31337, 31338, 31339, 31340, 31341];

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
  | { t: "pong" };

/** Messages the server sends back to the plugin. */
export type ServerMessage =
  | { t: "plumb-hello"; serverVersion: string }
  | { t: "paired" }
  | { t: "pair-rejected"; reason: string }
  | { t: "ping" };
