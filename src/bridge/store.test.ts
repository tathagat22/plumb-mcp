import { describe, expect, it } from "vitest";
import { LruCache, NODE_CACHE_MAX, bridge } from "./store";

describe("LruCache", () => {
  it("evicts the least recently used entry past its cap", () => {
    const c = new LruCache<string, number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a"); // a is now most recent
    c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    expect(c.get("c")).toBe(3);
    expect(c.size).toBe(2);
  });

  it("re-setting a key refreshes it instead of duplicating it", () => {
    const c = new LruCache<string, number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.set("a", 9);
    c.set("c", 3);
    expect(c.get("a")).toBe(9);
    expect(c.get("b")).toBeUndefined();
  });
});

describe("bridge.nodeCache", () => {
  it("never holds more than NODE_CACHE_MAX subtrees", () => {
    for (let i = 0; i < NODE_CACHE_MAX * 3; i++) {
      bridge.nodeCache.set(`n${i}:all`, { doc: null, nodeName: null, fileVersion: 0 });
    }
    expect(bridge.nodeCache.size).toBe(NODE_CACHE_MAX);
    bridge.reset();
    expect(bridge.nodeCache.size).toBe(0);
  });
});
