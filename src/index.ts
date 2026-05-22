#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, MetaConfig } from "./config.js";
import { MetaClient } from "./services/meta-client.js";
import { registerAll } from "./register-all.js";
import { setupFatalErrorHandlers, setupShutdownHandlers } from "./shutdown.js";

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

async function main(): Promise<void> {
  let config: MetaConfig;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  const client = new MetaClient(config);
  const server = new McpServer({
    name: "meta-mcp",
    version: SERVER_VERSION,
  }, {
    instructions: SERVER_INSTRUCTIONS,
  });

  registerAll(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  setupShutdownHandlers(server);
}

// ── Smithery Sandbox ──

export function createSandboxServer(): McpServer {
  const sandbox = new McpServer({
    name: "meta-mcp",
    version: SERVER_VERSION,
  }, {
    instructions: SERVER_INSTRUCTIONS,
  });

  const mockConfig: MetaConfig = {
    appId: "",
    appSecret: "",
    instagramAccessToken: "",
    instagramUserId: "",
    threadsAccessToken: "",
    threadsUserId: "",
  };
  const mockClient = new MetaClient(mockConfig);

  registerAll(sandbox, mockClient);

  return sandbox;
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
