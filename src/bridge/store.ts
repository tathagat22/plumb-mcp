import type { FigmaNode } from "../figma/types";
import type { InventoryPage } from "./protocol";

/** The current selection the paired plugin has streamed. */
export interface BridgeSelection {
  doc: FigmaNode;
  fileName: string;
  pageName: string;
  nodeName: string;
  receivedAt: number;
}

/** The file's screen inventory streamed by the paired plugin. */
export interface BridgeInventory {
  fileName: string;
  pages: InventoryPage[];
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
  /** The file's screen inventory (all pages → top-level frames). */
  inventory: BridgeInventory | null = null;
  /** Last time any message arrived from the plugin (epoch ms). */
  lastSeen = 0;

  /** Clear pairing-scoped state — called when the plugin disconnects. */
  reset(): void {
    this.paired = false;
    this.pluginVersion = null;
    this.selection = null;
    this.inventory = null;
  }
}

export const bridge = new BridgeStore();
