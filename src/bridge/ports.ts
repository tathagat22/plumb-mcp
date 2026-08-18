/**
 * Bridge port-pool resolution.
 *
 * `BRIDGE_PORTS` is the built-in loopback range the Figma plugin scans for a
 * running server (`figma-plugin/ui.html` hardcodes the same list), so it must
 * stay the default. But three real situations need to override it:
 *
 *   1. More than ten concurrent `plumb-mcp` sessions on one machine — the pool
 *      is exhausted and the eleventh silently loses the plugin path.
 *   2. Containers (`docker compose`, k8s) where the bridge must bind one known,
 *      published port rather than "whichever of ten is free".
 *   3. Tests, which must not depend on whether the developer happens to have
 *      real `plumb-mcp` sessions occupying the default range.
 *
 * Kept out of `protocol.ts` so that module stays a pure, env-free description
 * of the wire format.
 */
import { BRIDGE_PORTS } from "./protocol";

/** Highest valid TCP port. Port 0 (ephemeral) is deliberately allowed — it is
 *  how tests and container health probes ask the OS for any free port. */
const MAX_PORT = 65535;

function parsePortList(raw: string): number[] {
  const ports: number[] = [];
  for (const piece of raw.split(",")) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 0 || n > MAX_PORT) continue;
    if (!ports.includes(n)) ports.push(n);
  }
  return ports;
}

/**
 * The ordered list of ports `startBridge` will try, in order.
 *
 * `PLUMB_BRIDGE_PORT` sets a single port; `PLUMB_BRIDGE_PORTS` sets a
 * comma-separated pool (`"31400,31401,31402"`). A malformed or entirely
 * out-of-range value falls back to the built-in pool rather than leaving the
 * bridge with nothing to bind — a bad env var must degrade, not disable.
 */
export function resolveBridgePorts(env: NodeJS.ProcessEnv = process.env): number[] {
  const single = env.PLUMB_BRIDGE_PORT?.trim();
  if (single) {
    const parsed = parsePortList(single);
    if (parsed.length) return parsed;
  }
  const many = env.PLUMB_BRIDGE_PORTS?.trim();
  if (many) {
    const parsed = parsePortList(many);
    if (parsed.length) return parsed;
  }
  return [...BRIDGE_PORTS];
}

/** Loopback is the default bind address, and the security posture the pairing
 *  model assumes: the bridge speaks to a Figma plugin running on the same
 *  machine. */
export const DEFAULT_BRIDGE_HOST = "127.0.0.1";

/**
 * The interface the bridge binds.
 *
 * Overridable only because a container has to publish the port to be reachable
 * at all (`0.0.0.0` inside the container, mapped to loopback on the host —
 * see `docker-compose.yml`). Binding a routable interface on a shared network
 * exposes the pairing handshake to anyone who can reach the port, so the
 * default stays loopback and the override is opt-in.
 */
export function resolveBridgeHost(env: NodeJS.ProcessEnv = process.env): string {
  const host = env.PLUMB_BRIDGE_HOST?.trim();
  return host || DEFAULT_BRIDGE_HOST;
}
