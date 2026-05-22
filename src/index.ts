#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, MetaConfig } from "./config.js";
import { MetaClient } from "./services/meta-client.js";
import { registerAll } from "./register-all.js";
import { setupShutdownHandlers } from "./shutdown.js";

const require = createRequire(import.meta.url);
const { version: SERVER_VERSION } = require("../package.json") as { version: string };

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
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
