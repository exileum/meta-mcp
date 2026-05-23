// Subset of the SDK's RFC 5424 `LoggingLevel` — the four levels this server emits.
export type LogLevel = "debug" | "info" | "warning" | "error";

export interface Logger {
  debug(data: unknown): void;
  info(data: unknown): void;
  warning(data: unknown): void;
  error(data: unknown): void;
}

// Structural subset of `McpServer` (just the method we call) so this module
// stays decoupled from the SDK generics and tests can pass a plain fake.
export interface LoggingServer {
  sendLoggingMessage(params: {
    level: LogLevel;
    logger?: string;
    data: unknown;
  }): Promise<void>;
}

// Default when no server-backed logger is injected (tests, sandbox); lets call sites skip null-checks.
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
      .catch(() => { /* swallow */ });
  };
  return {
    debug: emit("debug"),
    info: emit("info"),
    warning: emit("warning"),
    error: emit("error"),
  };
}
