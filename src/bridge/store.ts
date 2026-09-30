import type { FigmaNode } from "../figma/types";
import type { InventoryPage } from "./protocol";

/** A previously-served plugin response, keyed by `${nodeId}:${depth}`. */
export interface CachedNodeResult {
  doc: FigmaNode | null;
  nodeName: string | null;
  /** The fileVersion the response was generated at — invalidates on edit. */
  fileVersion: number;
}

/** The current selection, as a lightweight notice from the paired plugin. */
export interface BridgeSelection {
  nodeId: string | null;
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

/** Most node subtrees kept in {@link BridgeStore.nodeCache}. A full screen can
 *  serialize to several MB, so an unbounded map grows with every distinct
 *  node the agent ever asks for until the next file edit. */
export const NODE_CACHE_MAX = 24;

/**
 * Insertion-ordered LRU: a hit is re-inserted at the tail, and a set past the
 * cap evicts from the head. Same surface as the Map it replaces.
 */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();
  constructor(private readonly max: number) {}

  get size(): number {
    return this.map.size;
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as K;
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }
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
  /** The latest selection notice from the paired plugin — id only, no doc. */
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
   * Cleared wholesale on every fileVersion bump — simple, correct — and
   * bounded to the most recent {@link NODE_CACHE_MAX} subtrees in between.
   */
  nodeCache = new LruCache<string, CachedNodeResult>(NODE_CACHE_MAX);

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
