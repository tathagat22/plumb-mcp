import { afterEach, describe, expect, it } from "vitest";
import { BRIDGE_PORTS } from "./protocol";
import { DEFAULT_BRIDGE_HOST, resolveBridgeHost, resolveBridgePorts } from "./ports";

/**
 * Port/host resolution is the seam that lets one machine run more than ten
 * concurrent sessions, lets a container publish a known port, and lets the
 * bridge tests stop depending on which ports happen to be free. All three
 * break silently if a malformed value disables the bridge instead of falling
 * back, so the degradation paths are pinned here.
 */
describe("resolveBridgePorts", () => {
  afterEach(() => {
    delete process.env.PLUMB_BRIDGE_PORT;
    delete process.env.PLUMB_BRIDGE_PORTS;
  });

  it("defaults to the built-in pool the Figma plugin scans", () => {
    expect(resolveBridgePorts({})).toEqual([...BRIDGE_PORTS]);
  });

  it("returns a copy, so a caller mutating the result can't corrupt the default", () => {
    const first = resolveBridgePorts({});
    first.push(9999);
    expect(resolveBridgePorts({})).toEqual([...BRIDGE_PORTS]);
  });

  it("honours PLUMB_BRIDGE_PORT as a single pinned port", () => {
    expect(resolveBridgePorts({ PLUMB_BRIDGE_PORT: "31400" })).toEqual([31400]);
  });

  it("honours PLUMB_BRIDGE_PORTS as an ordered pool", () => {
    expect(resolveBridgePorts({ PLUMB_BRIDGE_PORTS: "31400,31401,31402" })).toEqual([
      31400, 31401, 31402,
    ]);
  });

  it("tolerates whitespace and drops duplicates while preserving order", () => {
    expect(resolveBridgePorts({ PLUMB_BRIDGE_PORTS: " 31401 , 31400 ,31401, " })).toEqual([
      31401, 31400,
    ]);
  });

  it("prefers PLUMB_BRIDGE_PORT over PLUMB_BRIDGE_PORTS when both are set", () => {
    expect(
      resolveBridgePorts({ PLUMB_BRIDGE_PORT: "31400", PLUMB_BRIDGE_PORTS: "31500,31501" }),
    ).toEqual([31400]);
  });

  it("allows port 0 — the ephemeral-port request used by tests and probes", () => {
    expect(resolveBridgePorts({ PLUMB_BRIDGE_PORTS: "0" })).toEqual([0]);
  });

  it.each([
    ["not-a-number", { PLUMB_BRIDGE_PORTS: "nope,also-nope" }],
    ["out of range", { PLUMB_BRIDGE_PORTS: "70000,-1" }],
    ["non-integer", { PLUMB_BRIDGE_PORTS: "31400.5" }],
    ["empty string", { PLUMB_BRIDGE_PORTS: "   " }],
  ])("falls back to the default pool when the value is %s", (_label, env) => {
    // A bad env var must degrade to the default, never leave the bridge with
    // an empty pool — that would silently disable the plugin path entirely.
    expect(resolveBridgePorts(env)).toEqual([...BRIDGE_PORTS]);
  });

  it("keeps the valid ports when only some entries are junk", () => {
    expect(resolveBridgePorts({ PLUMB_BRIDGE_PORTS: "31400,junk,70000,31401" })).toEqual([
      31400, 31401,
    ]);
  });
});

describe("resolveBridgeHost", () => {
  it("defaults to loopback — the security posture pairing assumes", () => {
    expect(resolveBridgeHost({})).toBe(DEFAULT_BRIDGE_HOST);
    expect(DEFAULT_BRIDGE_HOST).toBe("127.0.0.1");
  });

  it("honours PLUMB_BRIDGE_HOST so a container can publish the port", () => {
    expect(resolveBridgeHost({ PLUMB_BRIDGE_HOST: "0.0.0.0" })).toBe("0.0.0.0");
  });

  it("treats a blank value as unset rather than binding an empty host", () => {
    expect(resolveBridgeHost({ PLUMB_BRIDGE_HOST: "   " })).toBe(DEFAULT_BRIDGE_HOST);
  });
});
