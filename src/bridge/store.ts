import type { FigmaNode } from "../figma/types";

/** The current selection the paired plugin has streamed. */
export interface BridgeSelection {
  doc: FigmaNode;
  fileName: string;
  pageName: string;
  nodeName: string;
  receivedAt: number;
}

/**
 * In-memory bridge state, shared between the WebSocket bridge and the MCP
 * tools — one process, one module instance.
 */
class BridgeStore {
  /** The port the bridge bound, or null if the bridge is not running. */
  port: number | null = null;
  /** Whether a plugin has completed the one-time pairing. */
  paired = false;
  pluginVersion: string | null = null;
  /** The latest selection streamed by the paired plugin. */
  selection: BridgeSelection | null = null;
  /** Last time any message arrived from the plugin (epoch ms). */
  lastSeen = 0;

  /** Clear pairing + selection — called when the plugin disconnects. */
  reset(): void {
    this.paired = false;
    this.pluginVersion = null;
    this.selection = null;
  }
}

export const bridge = new BridgeStore();
