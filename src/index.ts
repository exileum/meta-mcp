#!/usr/bin/env node

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, MetaConfig } from "./config.js";
import { MetaClient } from "./services/meta-client.js";
import { registerAll } from "./register-all.js";

const require = createRequire(import.meta.url);
const { version: SERVER_VERSION } = require("../package.json") as { version: string };

const server = new McpServer({
  name: "meta-mcp",
  version: SERVER_VERSION,
});

let config: MetaConfig;
try {
  config = loadConfig();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
const client = new MetaClient(config);

registerAll(server, client);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

// ── Smithery Sandbox ──

export function createSandboxServer() {
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
