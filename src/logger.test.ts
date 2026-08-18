import { afterEach, describe, expect, it } from "vitest";
import { createLogger, currentLevel, formatLine, setLogSink } from "./logger";

/**
 * The invariant worth pinning hardest is the one that breaks the protocol:
 * nothing this module produces may reach stdout, because stdout carries MCP
 * JSON-RPC framing. Everything else here — level filtering, JSON validity,
 * hostile field values — is about the logger never being the thing that takes
 * a long-running server down.
 */

/** Capture emitted lines for the duration of a callback. */
function capture(fn: () => void): string[] {
  const lines: string[] = [];
  const restore = setLogSink((line) => lines.push(line));
  try {
    fn();
  } finally {
    restore();
  }
  return lines;
}

afterEach(() => {
  delete process.env.PLUMB_LOG_LEVEL;
  delete process.env.PLUMB_LOG_FORMAT;
});

describe("level filtering", () => {
  it("defaults to info — debug is dropped, info and above pass", () => {
    const lines = capture(() => {
      const log = createLogger("test");
      log.debug("dropped");
      log.info("kept");
      log.warn("kept");
      log.error("kept");
    });
    expect(lines).toHaveLength(3);
    expect(lines.join("")).not.toContain("dropped");
  });

  it("honours PLUMB_LOG_LEVEL=debug", () => {
    process.env.PLUMB_LOG_LEVEL = "debug";
    const lines = capture(() => createLogger("test").debug("now visible"));
    expect(lines).toHaveLength(1);
  });

  it("honours PLUMB_LOG_LEVEL=error", () => {
    process.env.PLUMB_LOG_LEVEL = "error";
    const lines = capture(() => {
      const log = createLogger("test");
      log.warn("dropped");
      log.error("kept");
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("kept");
  });

  it("falls back to info on an unrecognised level rather than silencing logs", () => {
    process.env.PLUMB_LOG_LEVEL = "verbose";
    expect(currentLevel()).toBe("info");
    const lines = capture(() => createLogger("test").info("kept"));
    expect(lines).toHaveLength(1);
  });

  it("is case- and whitespace-insensitive", () => {
    process.env.PLUMB_LOG_LEVEL = "  WARN ";
    expect(currentLevel()).toBe("warn");
  });
});

describe("JSON format", () => {
  it("emits one valid JSON object per line with the required fields", () => {
    process.env.PLUMB_LOG_FORMAT = "json";
    const lines = capture(() =>
      createLogger("bridge").info("listening", { host: "127.0.0.1", port: 31337 }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.endsWith("\n")).toBe(true);

    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      level: "info",
      module: "bridge",
      msg: "listening",
      host: "127.0.0.1",
      port: 31337,
    });
    expect(typeof parsed.ts).toBe("string");
    expect(Number.isNaN(Date.parse(String(parsed.ts)))).toBe(false);
  });

  it("serialises an Error field to message + stack instead of {}", () => {
    process.env.PLUMB_LOG_FORMAT = "json";
    const lines = capture(() =>
      createLogger("bridge").error("upload write failed", { err: new Error("ENOSPC") }),
    );
    const parsed = JSON.parse(lines[0]!) as { err?: { message?: string; stack?: string } };
    expect(parsed.err?.message).toBe("ENOSPC");
    expect(parsed.err?.stack).toContain("ENOSPC");
  });

  it("survives a circular field rather than throwing into the caller", () => {
    process.env.PLUMB_LOG_FORMAT = "json";
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;

    const lines = capture(() => createLogger("bridge").warn("weird", { circular }));
    // A logger that throws would take down whatever WebSocket handler called
    // it — the line degrades instead.
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed.msg).toBe("weird");
    expect(parsed.fieldsError).toBe("unserializable");
  });
});

describe("text format", () => {
  it("is the default and reads as a log line, not JSON", () => {
    const lines = capture(() =>
      createLogger("bridge").info("listening", { port: 31337, session: "my app" }),
    );
    expect(lines[0]).toBe(`INFO  bridge  listening  port=31337 session="my app"\n`);
  });

  it("omits the trailing separator when there are no fields", () => {
    const lines = capture(() => createLogger("bridge").warn("plugin disconnected"));
    expect(lines[0]).toBe("WARN  bridge  plugin disconnected\n");
  });

  it("renders an object field as JSON, never [object Object]", () => {
    const lines = capture(() => createLogger("bridge").info("pool", { ports: [31337, 31338] }));
    expect(lines[0]).toContain("ports=[31337,31338]");
    expect(lines[0]).not.toContain("object Object");
  });

  it("renders an Error field as its message, not a full stack dump", () => {
    const line = formatLine("error", "bridge", "boom", { err: new Error("nope") }, "T", false);
    expect(line).toBe("ERROR bridge  boom  err=nope\n");
  });
});

describe("child loggers", () => {
  it("dot-joins the module path", () => {
    const lines = capture(() => createLogger("bridge").child("upload").info("staged"));
    expect(lines[0]).toContain("bridge.upload");
  });

  it("nests further without losing the prefix", () => {
    const lines = capture(() =>
      createLogger("bridge").child("upload").child("sweep").info("staged"),
    );
    expect(lines[0]).toContain("bridge.upload.sweep");
  });

  it("leaves the parent logger's module untouched", () => {
    const parent = createLogger("bridge");
    parent.child("upload");
    const lines = capture(() => parent.info("still the parent"));
    expect(lines[0]).toContain("INFO  bridge  ");
  });
});

describe("stdout is never touched", () => {
  it("routes every level to the sink, leaving the MCP channel clean", () => {
    // The default sink is stderr; this asserts the contract at the seam that
    // would have to change for a line to escape to stdout.
    const seen: string[] = [];
    const restore = setLogSink((l) => seen.push(l));
    const before = process.stdout.write;
    let stdoutWrites = 0;
    process.stdout.write = ((...args: unknown[]) => {
      stdoutWrites += 1;
      return (before as unknown as (...a: unknown[]) => boolean).apply(process.stdout, args);
    }) as typeof process.stdout.write;
    try {
      const log = createLogger("test");
      log.info("a");
      log.warn("b");
      log.error("c");
    } finally {
      process.stdout.write = before;
      restore();
    }
    expect(seen).toHaveLength(3);
    expect(stdoutWrites).toBe(0);
  });
});
