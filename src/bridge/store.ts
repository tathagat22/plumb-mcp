import type { FigmaNode } from "../figma/types";
import type { InventoryPage } from "./protocol";

/** A previously-served plugin response, keyed by `${nodeId}:${depth}`. */
export interface CachedNodeResult {
  doc: FigmaNode | null;
  nodeName: string | null;
  /** The fileVersion the response was generated at — invalidates on edit. */
  fileVersion: number;
}

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
  /**
   * Monotonic counter bumped on every inventory push (plugin debounces those
   * on `documentchange`, so the bump tracks "the file has changed somehow").
   * Cached node responses store the fileVersion they were generated at —
   * a mismatch on lookup means the cache is stale.
   */
  fileVersion = 0;
  /**
   * Server-side cache of `requestNode` responses, keyed `${nodeId}:${depth}`.
   * Hit rate matters most during drill-down loops and verify cycles where
   * the agent re-asks for parent/sibling subtrees that haven't changed.
   * Cleared wholesale on every fileVersion bump — simple, correct.
   */
  nodeCache = new Map<string, CachedNodeResult>();

  /** Clear pairing-scoped state — called when the plugin disconnects. */
  reset(): void {
    this.paired = false;
    this.pluginVersion = null;
    this.selection = null;
    this.inventory = null;
    this.fileVersion = 0;
    // `lastSeen` is a heartbeat from the plugin that just went away. Leaving
    // it set makes health/status report a recent heartbeat for a dead session,
    // which reads as "the plugin is fine, your tool call is just slow".
    this.lastSeen = 0;
    this.nodeCache.clear();
  }
}

export const bridge = new BridgeStore();
