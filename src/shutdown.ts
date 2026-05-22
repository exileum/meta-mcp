import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;
export type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];

export interface ShutdownOptions {
  exit?: (code: number) => never;
  log?: (msg: string) => void;
}

export function setupShutdownHandlers(
  server: Pick<McpServer, "close">,
  options: ShutdownOptions = {}
): void {
  const exit = options.exit ?? ((code) => process.exit(code));
  const log = options.log ?? ((msg) => console.error(msg));

  let shuttingDown = false;

  const shutdown = async (signal: ShutdownSignal): Promise<void> => {
    if (shuttingDown) {
      log(`[meta-mcp] ${signal} received during shutdown — ignoring`);
      return;
    }
    shuttingDown = true;
    log(`[meta-mcp] ${signal} received — shutting down gracefully`);
    try {
      await server.close();
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
