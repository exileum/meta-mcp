import { describe, it, expect, vi } from "vitest";
import { createMcpLogger, NOOP_LOGGER, LoggingServer } from "./logger.js";

function fakeServer(impl?: () => Promise<void>): { sendLoggingMessage: ReturnType<typeof vi.fn> } & LoggingServer {
  return {
    sendLoggingMessage: vi.fn(impl ?? (() => Promise.resolve())),
  };
}

describe("createMcpLogger", () => {
  it("forwards each level to sendLoggingMessage with the default logger name", () => {
    const server = fakeServer();
    const logger = createMcpLogger(server);

    logger.debug({ method: "GET", path: "/me" });
    logger.info({ operation: "delete" });
    logger.warning({ usage_pct: 92 });
    logger.error({ http_status: 400 });

    expect(server.sendLoggingMessage).toHaveBeenNthCalledWith(1, {
      level: "debug",
      logger: "meta-mcp",
      data: { method: "GET", path: "/me" },
    });
    expect(server.sendLoggingMessage).toHaveBeenNthCalledWith(2, {
      level: "info",
      logger: "meta-mcp",
      data: { operation: "delete" },
    });
    expect(server.sendLoggingMessage).toHaveBeenNthCalledWith(3, {
      level: "warning",
      logger: "meta-mcp",
      data: { usage_pct: 92 },
    });
    expect(server.sendLoggingMessage).toHaveBeenNthCalledWith(4, {
      level: "error",
      logger: "meta-mcp",
      data: { http_status: 400 },
    });
  });

  it("uses the provided logger name", () => {
    const server = fakeServer();
    const logger = createMcpLogger(server, "meta-client");

    logger.debug({ x: 1 });

    expect(server.sendLoggingMessage).toHaveBeenCalledWith({
      level: "debug",
      logger: "meta-client",
      data: { x: 1 },
    });
  });

  it("swallows a rejected send (closed transport) without throwing", async () => {
    const server = fakeServer(() => Promise.reject(new Error("Not connected")));
    const logger = createMcpLogger(server);

    expect(() => logger.error({ boom: true })).not.toThrow();
    // Flush the microtask queue so the internal .catch() runs; an unhandled
    // rejection here would fail the test run.
    await Promise.resolve();
    expect(server.sendLoggingMessage).toHaveBeenCalledTimes(1);
  });
});

describe("NOOP_LOGGER", () => {
  it("is a no-op for every level and never throws", () => {
    expect(() => {
      NOOP_LOGGER.debug({ a: 1 });
      NOOP_LOGGER.info({ a: 1 });
      NOOP_LOGGER.warning({ a: 1 });
      NOOP_LOGGER.error({ a: 1 });
    }).not.toThrow();
  });
});
