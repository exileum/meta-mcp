import { beforeEach, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

describe("src/index.ts module", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("can be imported without registering shutdown handlers", async () => {
    const sigintBefore = process.listenerCount("SIGINT");
    const sigtermBefore = process.listenerCount("SIGTERM");

    const indexModule = await import("./index.js");

    expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
    expect(typeof indexModule.createSandboxServer).toBe("function");
  });

  it("createSandboxServer() returns an McpServer regardless of invalid env vars", async () => {
    // Canary: this value fails MetaConfigSchema's numeric regex, so any
    // accidental loadConfig() call from the import or the factory would throw
    // (or process.exit if it hit main()'s catch) and fail this test loudly.
    const previous = process.env.META_APP_ID;
    process.env.META_APP_ID = "definitely-not-numeric";
    try {
      const { createSandboxServer } = await import("./index.js");
      const server = createSandboxServer();
      expect(server).toBeInstanceOf(McpServer);
    } finally {
      if (previous === undefined) {
        delete process.env.META_APP_ID;
      } else {
        process.env.META_APP_ID = previous;
      }
    }
  });
});
