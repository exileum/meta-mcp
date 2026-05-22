import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;
export type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];

export const SHUTDOWN_TIMEOUT_MS = 5_000;

export interface ShutdownOptions {
  exit?: (code: number) => never;
  log?: (msg: string) => void;
  timeoutMs?: number;
}

export function setupShutdownHandlers(
  server: Pick<McpServer, "close">,
  options: ShutdownOptions = {}
): void {
  const exit = options.exit ?? ((code) => process.exit(code));
  const log = options.log ?? ((msg) => console.error(msg));
  const timeoutMs = options.timeoutMs ?? SHUTDOWN_TIMEOUT_MS;

  let shuttingDown = false;

  const closeWithDeadline = async (): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`shutdown timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
    });
    try {
      await Promise.race([server.close(), deadline]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const shutdown = async (signal: ShutdownSignal): Promise<void> => {
    if (shuttingDown) {
      log(`[meta-mcp] ${signal} received during shutdown — ignoring`);
      return;
    }
    shuttingDown = true;
    log(`[meta-mcp] ${signal} received — shutting down gracefully`);
    try {
      await closeWithDeadline();
      exit(0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`[meta-mcp] Error during shutdown: ${message}`);
      exit(1);
    }
  };

  for (const signal of SHUTDOWN_SIGNALS) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }
}

export interface FatalErrorOptions {
  exit?: (code: number) => never;
  log?: (msg: string) => void;
}

export function setupFatalErrorHandlers(options: FatalErrorOptions = {}): void {
  const exit = options.exit ?? ((code) => process.exit(code));
  const log = options.log ?? ((msg) => console.error(msg));

  process.on("unhandledRejection", (reason) => {
    const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
    log(`[meta-mcp] Unhandled promise rejection — ${detail}`);
    exit(1);
  });

  process.on("uncaughtException", (err) => {
    log(`[meta-mcp] Uncaught exception — ${err.stack ?? err.message}`);
    exit(1);
  });
}
