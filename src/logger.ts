/**
 * Structured logging for the long-running server processes.
 *
 * Two constraints shape this module, and between them they rule out every
 * off-the-shelf logger:
 *
 *   1. **stdout is the MCP protocol channel.** A single stray byte written to
 *      stdout corrupts the JSON-RPC framing and the client drops the session.
 *      Every log line goes to stderr, always, with no configuration that can
 *      move it.
 *   2. **This package ships four runtime dependencies on purpose.** Pulling in
 *      pino (and its transport chain) to format a few dozen lines a session
 *      would be the largest dependency in the tree. The same reasoning already
 *      produced the zero-dependency `.env` loader in `src/env.ts`.
 *
 * Output format is human-readable by default, because the audience is a
 * developer reading their editor's MCP server log:
 *
 *   INFO  bridge  listening on 127.0.0.1:31337  session=my-app port=31337
 *
 * Set `PLUMB_LOG_FORMAT=json` for one JSON object per line instead, when the
 * logs are being shipped somewhere that parses them:
 *
 *   {"ts":"2026-08-19T01:00:00.000Z","level":"info","module":"bridge",…}
 *
 * `PLUMB_LOG_LEVEL` (debug | info | warn | error, default info) filters both.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Ordering for level filtering. Higher passes more. */
const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const DEFAULT_LEVEL: LogLevel = "info";

/** Structured context attached to a line. Values are stringified defensively. */
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** A logger for a sub-area, e.g. `bridge.upload`, inheriting this config. */
  child(module: string): Logger;
}

function parseLevel(raw: string | undefined): LogLevel {
  const v = raw?.trim().toLowerCase();
  return v && v in LEVEL_RANK ? (v as LogLevel) : DEFAULT_LEVEL;
}

/** Current threshold, read per-call so tests and CLIs can flip it at runtime. */
export function currentLevel(env: NodeJS.ProcessEnv = process.env): LogLevel {
  return parseLevel(env.PLUMB_LOG_LEVEL);
}

function useJson(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PLUMB_LOG_FORMAT?.trim().toLowerCase() === "json";
}

/**
 * Render a field value for the text format. Errors keep their message (a
 * stack would swamp a one-line log), everything non-primitive goes through
 * JSON so an object never prints as `[object Object]`.
 */
function renderValue(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (v instanceof Error) return v.message;
  if (typeof v === "string") return /\s/.test(v) ? JSON.stringify(v) : v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/** JSON-safe copy of the fields — an Error keeps its message and stack. */
function serializeFields(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = value instanceof Error ? { message: value.message, stack: value.stack } : value;
  }
  return out;
}

export function formatLine(
  level: LogLevel,
  module: string,
  msg: string,
  fields: LogFields,
  timestamp: string,
  json: boolean,
): string {
  if (json) {
    let body: string;
    try {
      body = JSON.stringify({
        ts: timestamp,
        level,
        module,
        msg,
        ...serializeFields(fields),
      });
    } catch {
      // A circular value in `fields` must never take down the caller — drop
      // the context rather than the line.
      body = JSON.stringify({ ts: timestamp, level, module, msg, fieldsError: "unserializable" });
    }
    return body + "\n";
  }

  const pairs = Object.entries(fields)
    .map(([k, v]) => `${k}=${renderValue(v)}`)
    .join(" ");
  return `${level.toUpperCase().padEnd(5)} ${module}  ${msg}${pairs ? "  " + pairs : ""}\n`;
}

/** Swappable sink — the tests capture lines instead of writing to stderr. */
export type Sink = (line: string) => void;

const stderrSink: Sink = (line) => {
  process.stderr.write(line);
};

let sink: Sink = stderrSink;

/** Redirect log output. Returns a function that restores the previous sink. */
export function setLogSink(next: Sink): () => void {
  const previous = sink;
  sink = next;
  return () => {
    sink = previous;
  };
}

function emit(level: LogLevel, module: string, msg: string, fields: LogFields = {}): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[currentLevel()]) return;
  sink(formatLine(level, module, msg, fields, new Date().toISOString(), useJson()));
}

/**
 * A logger scoped to one module — the name shows up on every line it writes.
 *
 * ```ts
 * const log = createLogger("bridge");
 * log.info("listening", { host, port });
 * ```
 */
export function createLogger(module: string): Logger {
  return {
    debug: (msg, fields) => emit("debug", module, msg, fields),
    info: (msg, fields) => emit("info", module, msg, fields),
    warn: (msg, fields) => emit("warn", module, msg, fields),
    error: (msg, fields) => emit("error", module, msg, fields),
    child: (sub) => createLogger(`${module}.${sub}`),
  };
}
