type LogLevel = "info" | "warn" | "error" | "debug";

interface LogEntry {
  ts: string;
  level: LogLevel;
  investigationId: string;
  event: string;
  data?: Record<string, unknown>;
}

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
  white: "\x1b[97m",
};

const LEVEL_COLOR: Record<LogLevel, string> = {
  info: C.cyan,
  warn: C.yellow,
  error: C.red,
  debug: C.gray,
};

const LEVEL_LABEL: Record<LogLevel, string> = {
  info: "INFO ",
  warn: "WARN ",
  error: "ERROR",
  debug: "DEBUG",
};

/**
 * Formats a structured `LogEntry` into a human-readable console line.
 *
 * The output includes:
 * - ISO timestamp
 * - severity label
 * - investigation identifier
 * - event description
 * - optional structured metadata
 *
 * Example output:
 *
 * 2026-03-10T07:24:37.784Z INFO  [7eb218bd] Agent started {"target":"email"}
 */
function format(entry: LogEntry): string {
  const color = LEVEL_COLOR[entry.level];
  const label = LEVEL_LABEL[entry.level];
  const ts = `${C.dim}${entry.ts}${C.reset}`;
  const lvl = `${color}${C.bold}${label}${C.reset}`;
  const id = `${C.gray}[${entry.investigationId.slice(0, 8)}]${C.reset}`;
  const msg = `${C.white}${entry.event}${C.reset}`;
  const data = entry.data
    ? ` ${C.dim}${JSON.stringify(entry.data)}${C.reset}`
    : "";

  return `${ts} ${lvl} ${id} ${msg}${data}`;
}

/**
 * Logger interface used by the OSINT agent runtime.
 *
 * The logger is designed to:
 * - provide structured logging
 * - attach investigation context automatically
 * - standardize tool execution logging
 */
export interface AgentLogger {
  /** General lifecycle events */
  info(event: string, data?: Record<string, unknown>): void;
  /** Non-fatal anomalies (deduplication, skips, etc.) */
  warn(event: string, data?: Record<string, unknown>): void;
  /** Fatal or recoverable errors */
  error(event: string, err?: unknown, data?: Record<string, unknown>): void;
  /** Verbose internal state (hidden in production if desired) */
  debug(event: string, data?: Record<string, unknown>): void;
  /** Dedicated tool lifecycle shorthand */
  tool(
    name: string,
    phase: "call" | "skip" | "success" | "error" | "db_skip",
    data?: Record<string, unknown>
  ): void;
}

const TOOL_PHASE_COLOR: Record<string, string> = {
  call: C.blue,
  skip: C.yellow,
  success: C.green,
  error: C.red,
  db_skip: C.gray,
};

/**
 * Creates a structured logger bound to a specific investigation.
 *
 * The returned logger automatically prefixes every log entry with the
 * investigation identifier, making it easy to correlate logs across
 * concurrent agent runs.
 *
 * Example:
 *
 * ```ts
 * const log = createAgentLogger(investigationId);
 *
 * log.info("Agent started", {
 *   targetType: "email",
 *   targetValue: "alice@example.com"
 * });
 *
 * log.tool("email_recon", "call", { email: "alice@example.com" });
 *
 * log.tool("email_recon", "success", { results: 3 });
 *
 * log.error("Agent loop failed", err);
 * ```
 */
export function createAgentLogger(investigationId: string): AgentLogger {
  const shortId = investigationId.slice(0, 8);

  function emit(
    level: LogLevel,
    event: string,
    data?: Record<string, unknown>
  ) {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      investigationId: shortId,
      event,
      data,
    };

    const line = format(entry);

    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  return {
    info: (event, data) => emit("info", event, data),
    warn: (event, data) => emit("warn", event, data),
    debug: (event, data) => emit("debug", event, data),

    error(event, err, data) {
      const errData: Record<string, unknown> = { ...data };
      if (err instanceof Error) {
        errData.message = err.message;
        errData.stack = err.stack?.split("\n").slice(0, 4).join(" | ");
      } else if (err !== undefined) {
        errData.raw = String(err);
      }
      emit("error", event, errData);
    },

    tool(name, phase, data) {
      const phaseColor = TOOL_PHASE_COLOR[phase] ?? C.white;
      const tag = `${phaseColor}[${phase.toUpperCase()}]${C.reset}`;
      const toolName = `${C.bold}${name}${C.reset}`;
      const entry: LogEntry = {
        ts: new Date().toISOString(),
        level:
          phase === "error"
            ? "error"
            : phase === "skip" || phase === "db_skip"
              ? "warn"
              : "info",
        investigationId: shortId,
        event: `${tag} ${toolName}`,
        data,
      };
      const line = format(entry);
      phase === "error" ? console.error(line) : console.log(line);
    },
  };
}
