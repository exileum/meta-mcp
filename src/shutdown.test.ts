import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  setupFatalErrorHandlers,
  setupShutdownHandlers,
  SHUTDOWN_SIGNALS,
  type ShutdownSignal,
} from "./shutdown.js";

type SignalListener = (signal: ShutdownSignal) => void;

interface Harness {
  listeners: Map<ShutdownSignal, SignalListener>;
  close: ReturnType<typeof vi.fn>;
  exit: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
  fire: (signal: ShutdownSignal) => Promise<void>;
}

function setupHarness(
  closeBehavior: () => Promise<void> = () => Promise.resolve(),
  timeoutMs?: number
): Harness {
  const listeners = new Map<ShutdownSignal, SignalListener>();

  const processOnSpy = vi.spyOn(process, "on");
  processOnSpy.mockImplementation(((event: string | symbol, listener: SignalListener) => {
    if (SHUTDOWN_SIGNALS.includes(event as ShutdownSignal)) {
      listeners.set(event as ShutdownSignal, listener);
    }
    return process;
  }) as typeof process.on);

  const close = vi.fn(closeBehavior);
  const exit = vi.fn();
  const log = vi.fn();

  setupShutdownHandlers({ close }, { exit: exit as never, log, timeoutMs });

  const fire = async (signal: ShutdownSignal): Promise<void> => {
    const listener = listeners.get(signal);
    if (!listener) {
      throw new Error(`No listener registered for ${signal}`);
    }
    listener(signal);
    await new Promise<void>((resolve) => setImmediate(resolve));
  };

  return { listeners, close, exit, log, fire };
}

describe("setupShutdownHandlers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("registers handlers for SIGINT and SIGTERM", () => {
    const { listeners } = setupHarness();
    expect([...listeners.keys()].sort()).toEqual(["SIGINT", "SIGTERM"]);
  });

  it("calls server.close() and exits cleanly on SIGINT", async () => {
    const harness = setupHarness();
    await harness.fire("SIGINT");
    expect(harness.close).toHaveBeenCalledTimes(1);
    expect(harness.exit).toHaveBeenCalledWith(0);
    expect(harness.log).toHaveBeenCalledWith(
      "[meta-mcp] SIGINT received — shutting down gracefully"
    );
  });

  it("calls server.close() and exits cleanly on SIGTERM", async () => {
    const harness = setupHarness();
    await harness.fire("SIGTERM");
    expect(harness.close).toHaveBeenCalledTimes(1);
    expect(harness.exit).toHaveBeenCalledWith(0);
    expect(harness.log).toHaveBeenCalledWith(
      "[meta-mcp] SIGTERM received — shutting down gracefully"
    );
  });

  it("exits with code 1 when server.close() rejects", async () => {
    const harness = setupHarness(() => Promise.reject(new Error("transport boom")));
    await harness.fire("SIGTERM");
    expect(harness.close).toHaveBeenCalledTimes(1);
    expect(harness.exit).toHaveBeenCalledWith(1);
    expect(harness.log).toHaveBeenCalledWith(
      "[meta-mcp] Error during shutdown: transport boom"
    );
  });

  it("ignores a second signal received during shutdown", async () => {
    let resolveClose: () => void = () => undefined;
    const closePromise = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });
    const harness = setupHarness(() => closePromise);

    const firstListener = harness.listeners.get("SIGINT");
    const secondListener = harness.listeners.get("SIGTERM");
    if (!firstListener || !secondListener) throw new Error("missing listeners");

    firstListener("SIGINT");
    await new Promise<void>((resolve) => setImmediate(resolve));
    secondListener("SIGTERM");
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(harness.close).toHaveBeenCalledTimes(1);
    expect(harness.exit).not.toHaveBeenCalled();
    expect(harness.log).toHaveBeenCalledWith(
      "[meta-mcp] SIGTERM received during shutdown — ignoring"
    );

    resolveClose();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(harness.exit).toHaveBeenCalledWith(0);
  });

  it("exits with code 1 when server.close() exceeds the shutdown deadline", async () => {
    const harness = setupHarness(() => new Promise<void>(() => undefined), 10);
    await harness.fire("SIGTERM");
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(harness.close).toHaveBeenCalledTimes(1);
    expect(harness.exit).toHaveBeenCalledWith(1);
    expect(harness.log).toHaveBeenCalledWith(
      "[meta-mcp] Error during shutdown: shutdown timed out after 10ms"
    );
  });
});

type FatalEvent = "unhandledRejection" | "uncaughtException";
type FatalListener = (payload: unknown) => void;

const FATAL_EVENTS: readonly FatalEvent[] = ["unhandledRejection", "uncaughtException"];

interface FatalHarness {
  events: Map<FatalEvent, FatalListener>;
  exit: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
  fire: (event: FatalEvent, payload: unknown) => void;
}

function setupFatalHarness(): FatalHarness {
  const events = new Map<FatalEvent, FatalListener>();

  const processOnSpy = vi.spyOn(process, "on");
  processOnSpy.mockImplementation(((event: string | symbol, listener: FatalListener) => {
    if (FATAL_EVENTS.includes(event as FatalEvent)) {
      events.set(event as FatalEvent, listener);
    }
    return process;
  }) as typeof process.on);

  const exit = vi.fn();
  const log = vi.fn();

  setupFatalErrorHandlers({ exit: exit as never, log });

  const fire = (event: FatalEvent, payload: unknown): void => {
    const listener = events.get(event);
    if (!listener) {
      throw new Error(`No listener registered for ${event}`);
    }
    listener(payload);
  };

  return { events, exit, log, fire };
}

describe("setupFatalErrorHandlers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("registers handlers for unhandledRejection and uncaughtException", () => {
    const { events } = setupFatalHarness();
    expect([...events.keys()].sort()).toEqual(["uncaughtException", "unhandledRejection"]);
  });

  it("logs the Error stack and exits 1 on unhandledRejection", () => {
    const harness = setupFatalHarness();
    harness.fire("unhandledRejection", new Error("boom"));
    expect(harness.exit).toHaveBeenCalledWith(1);
    expect(harness.log).toHaveBeenCalledTimes(1);
    expect(harness.log).toHaveBeenCalledWith(
      expect.stringContaining("[meta-mcp] Unhandled promise rejection — ")
    );
    expect(harness.log).toHaveBeenCalledWith(expect.stringContaining("boom"));
  });

  it("stringifies non-Error rejection reasons", () => {
    const harness = setupFatalHarness();
    harness.fire("unhandledRejection", "string-reason");
    expect(harness.exit).toHaveBeenCalledWith(1);
    expect(harness.log).toHaveBeenCalledWith(
      "[meta-mcp] Unhandled promise rejection — string-reason"
    );
  });

  it("falls back to reason.message when reason.stack is undefined", () => {
    const harness = setupFatalHarness();
    const sparseReason = new Error("sparse-reason");
    sparseReason.stack = undefined;
    harness.fire("unhandledRejection", sparseReason);
    expect(harness.exit).toHaveBeenCalledWith(1);
    expect(harness.log).toHaveBeenCalledWith(
      "[meta-mcp] Unhandled promise rejection — sparse-reason"
    );
  });

  it("logs the Error stack and exits 1 on uncaughtException", () => {
    const harness = setupFatalHarness();
    harness.fire("uncaughtException", new Error("crash"));
    expect(harness.exit).toHaveBeenCalledWith(1);
    expect(harness.log).toHaveBeenCalledTimes(1);
    expect(harness.log).toHaveBeenCalledWith(
      expect.stringContaining("[meta-mcp] Uncaught exception — ")
    );
    expect(harness.log).toHaveBeenCalledWith(expect.stringContaining("crash"));
  });

  it("falls back to err.message when err.stack is undefined", () => {
    const harness = setupFatalHarness();
    const sparseErr = new Error("sparse");
    sparseErr.stack = undefined;
    harness.fire("uncaughtException", sparseErr);
    expect(harness.exit).toHaveBeenCalledWith(1);
    expect(harness.log).toHaveBeenCalledWith("[meta-mcp] Uncaught exception — sparse");
  });
});
