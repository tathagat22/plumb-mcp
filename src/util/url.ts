/**
 * Guards the one real trust boundary in Plumb's tool surface: headless
 * Chrome navigating to a URL the *caller* supplied (`plumb_import_web`'s
 * `url`, `plumb_brand`'s `references`) rather than one the user typed
 * themselves (`plumb-mcp verify <url>`, which legitimately targets
 * `localhost` and is NOT run through this check). Without it, an agent
 * induced — directly or via a prompt-injected page — to pass
 * `file:///etc/passwd` or a cloud metadata IP gets those bytes back inside
 * a tool result.
 */

const BLOCKED_HOSTNAME_SUFFIXES = [".localhost"];

function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127) return true; // loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local / cloud metadata)
  if (a === 0) return true; // 0.0.0.0/8
  return false;
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost") return true;
  if (BLOCKED_HOSTNAME_SUFFIXES.some((s) => host.endsWith(s))) return true;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true; // IPv6 loopback
  if (host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true; // IPv6 link-local / ULA
  if (isPrivateIPv4(host)) return true;
  return false;
}

export interface UrlCheckResult {
  ok: boolean;
  reason?: string;
}

/**
 * Only `http:`/`https:` to a non-private host is allowed. Everything else —
 * `file:`, `chrome:`, `data:`, loopback, RFC1918, link-local/cloud-metadata —
 * is rejected. Callers should skip/report the URL, not crash the whole call.
 */
export function checkNavigableUrl(input: string): UrlCheckResult {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: `"${input}" is not a valid absolute URL.` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `Scheme "${url.protocol}" is not allowed — only http/https.` };
  }
  if (isPrivateHostname(url.hostname)) {
    return { ok: false, reason: `"${url.hostname}" is a local/private address and is not allowed.` };
  }
  return { ok: true };
}

/** Throws with a clear message if `input` fails {@link checkNavigableUrl}. */
export function assertNavigableUrl(input: string): void {
  const check = checkNavigableUrl(input);
  if (!check.ok) throw new Error(check.reason);
}
