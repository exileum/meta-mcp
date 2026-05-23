#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, MetaConfig } from "./config.js";
import {
  type HttpTransportConfig,
  parseHttpTransportConfig,
  startHttpTransport,
} from "./http-transport.js";
import { MetaClient } from "./services/meta-client.js";
import { registerAll } from "./register-all.js";
import { setupFatalErrorHandlers, setupShutdownHandlers } from "./shutdown.js";
import { createMcpLogger } from "./utils/logger.js";

const require = createRequire(import.meta.url);
const { version: SERVER_VERSION } = require("../package.json") as { version: string };

const SERVER_INSTRUCTIONS = [
  "Meta MCP server for managing Instagram and Threads via the Meta Graph API.",
  "Instagram tools require INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_USER_ID; Threads tools require THREADS_ACCESS_TOKEN and THREADS_USER_ID.",
  "Token-rotation tools (meta_exchange_token, meta_refresh_token) additionally need META_APP_ID and META_APP_SECRET.",
  "Most publishing tools follow a two-step flow internally: create a container, wait for processing (up to 30s for images, up to 5 minutes for videos), then publish — exposed as a single MCP tool call.",
  "When the client sets a progressToken on a publish call, the server emits notifications/progress events while polling container status.",
  "Tool responses include a _rateLimit field when the Meta API returns rate-limit headers; check it to throttle subsequent calls.",
].join(" ");

// Server is built before the client so the client can be handed a logger that
// emits to the MCP `notifications/message` channel. `capabilities.logging`
// must be declared or sendLoggingMessage is a silent no-op (#62).
function buildServer(config: MetaConfig): McpServer {
  const server = new McpServer({
    name: "meta-mcp",
    version: SERVER_VERSION,
  }, {
    instructions: SERVER_INSTRUCTIONS,
    capabilities: { logging: {} },
  });
  const client = new MetaClient(config, { logger: createMcpLogger(server, "meta-client") });
  registerAll(server, client);
  return server;
}

async function main(): Promise<void> {
  let config: MetaConfig;
  let httpConfig: HttpTransportConfig | null = null;
  try {
    config = loadConfig();
    const kind = (process.env.MCP_TRANSPORT ?? "stdio").trim().toLowerCase();
    if (kind === "http") {
      httpConfig = parseHttpTransportConfig(process.env);
    } else if (kind !== "stdio") {
      throw new Error(`MCP_TRANSPORT must be "stdio" or "http" (got "${kind}")`);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  if (httpConfig) {
    const handle = await startHttpTransport({
      ...httpConfig,
      createServer: () => buildServer(config),
    });
    setupShutdownHandlers(handle);
  } else {
    const server = buildServer(config);
    await server.connect(new StdioServerTransport());
    setupShutdownHandlers(server);
  }
}

// ── Smithery Sandbox ──

export function createSandboxServer(): McpServer {
  const mockConfig: MetaConfig = {
    appId: "",
    appSecret: "",
    instagramAccessToken: "",
    instagramUserId: "",
    threadsAccessToken: "",
    threadsUserId: "",
  };
  return buildServer(mockConfig);
}

// Guard keeps `import { createSandboxServer }` and test imports side-effect-free —
// without it, importing this module would always run main() and connect stdio.
function isInvokedAsCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isInvokedAsCli()) {
  setupFatalErrorHandlers();
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
