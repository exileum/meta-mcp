// RFC 5424 severity levels the MCP logging utility defines are
// debug/info/notice/warning/error/critical/alert/emergency; this server only
// emits the four it has events for. The union is a subset of the SDK's
// `LoggingLevel`, so values stay assignable to `sendLoggingMessage`.
export type LogLevel = "debug" | "info" | "warning" | "error";

export interface Logger {
  debug(data: unknown): void;
  info(data: unknown): void;
  warning(data: unknown): void;
  error(data: unknown): void;
}

// Structural subset of `McpServer` — we type only the one method we call so the
// logger module stays decoupled from the SDK generics and tests can pass a
// plain fake. Mirrors the `ProgressExtra` shape in progress.ts.
export interface LoggingServer {
  sendLoggingMessage(params: {
    level: LogLevel;
    logger?: string;
    data: unknown;
  }): Promise<void>;
}

// Default sink — used by MetaClient when no server-backed logger is injected
// (unit tests, the Smithery sandbox client before connect). Every method is a
// no-op so call sites never need to null-check the logger.
export const NOOP_LOGGER: Logger = {
  debug() {},
  info() {},
  warning() {},
  error() {},
};

/**
 * Build a {@link Logger} that forwards each call to the MCP structured-logging
 * channel via `server.sendLoggingMessage()` (emitted as a `notifications/message`
 * event). Requires the server to have declared `capabilities: { logging: {} }`;
 * without it the SDK drops the message silently. The SDK also filters out levels
 * below any client-set `logging/setLevel`, so callers don't gate by level here.
 *
 * Emission is fire-and-forget with a swallowed rejection: a closed transport
 * (client disconnect, cancelled request) must never turn a successful API
 * operation into a failure — same contract as `makeProgressNotifier`.
 */
export function createMcpLogger(server: LoggingServer, name = "meta-mcp"): Logger {
  const emit = (level: LogLevel) => (data: unknown): void => {
    void server
      .sendLoggingMessage({ level, logger: name, data })
      .catch(() => { /* transport closed — drop the log, never propagate */ });
  };
  return {
    debug: emit("debug"),
    info: emit("info"),
    warning: emit("warning"),
    error: emit("error"),
  };
}
