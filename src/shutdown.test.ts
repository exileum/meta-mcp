import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupShutdownHandlers, SHUTDOWN_SIGNALS, type ShutdownSignal } from "./shutdown.js";

type SignalListener = (signal: ShutdownSignal) => void;

interface Harness {
  listeners: Map<ShutdownSignal, SignalListener>;
  close: ReturnType<typeof vi.fn>;
  exit: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
  fire: (signal: ShutdownSignal) => Promise<void>;
}

function setupHarness(closeBehavior: () => Promise<void> = () => Promise.resolve()): Harness {
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

  setupShutdownHandlers({ close }, { exit: exit as never, log });

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

  afterEach(() => {
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
});
