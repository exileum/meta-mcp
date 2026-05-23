import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PORT,
  type HttpTransportHandle,
  parseHttpTransportConfig,
  startHttpTransport,
} from "./http-transport.js";
import { createSandboxServer } from "./index.js";

describe("parseHttpTransportConfig", () => {
  it("applies defaults when nothing is set", () => {
    const config = parseHttpTransportConfig({});
    expect(config).toEqual({
      host: DEFAULT_HTTP_HOST,
      port: DEFAULT_HTTP_PORT,
      allowedHosts: undefined,
    });
  });

  it("parses a valid port and host", () => {
    const config = parseHttpTransportConfig({ MCP_HTTP_PORT: "8080", MCP_HTTP_HOST: "0.0.0.0" });
    expect(config.port).toBe(8080);
    expect(config.host).toBe("0.0.0.0");
  });

  it.each(["0", "70000", "-1", "abc", "30.5"])("rejects invalid port %j", (value) => {
    expect(() => parseHttpTransportConfig({ MCP_HTTP_PORT: value })).toThrow(/MCP_HTTP_PORT/);
  });

  it("treats a blank port as unset", () => {
    expect(parseHttpTransportConfig({ MCP_HTTP_PORT: "   " }).port).toBe(DEFAULT_HTTP_PORT);
  });

  it("splits, trims, and filters MCP_HTTP_ALLOWED_HOSTS", () => {
    const config = parseHttpTransportConfig({
      MCP_HTTP_ALLOWED_HOSTS: " example.com:3000 , , api.example.com:3000 ",
    });
    expect(config.allowedHosts).toEqual(["example.com:3000", "api.example.com:3000"]);
  });
});

describe("startHttpTransport (end-to-end)", () => {
  let handle: HttpTransportHandle | undefined;

  const start = async (allowedHosts?: string[]): Promise<URL> => {
    handle = await startHttpTransport({
      host: "127.0.0.1",
      port: 0,
      allowedHosts,
      createServer: () => createSandboxServer(),
      log: () => undefined,
    });
    return new URL(`http://127.0.0.1:${handle.port}/mcp`);
  };

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  it("initializes a session, lists tools, and tears it down", async () => {
    const url = await start();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(url));

    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.map((t) => t.name)).toContain("ig_get_profile");

    await client.close();
  });

  it("rejects a non-initialize POST without a session id (400)", async () => {
    const url = await start();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
    });
    await res.text();
    expect(res.status).toBe(400);
  });

  it("rejects a POST with an unknown session id (404)", async () => {
    const url = await start();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "mcp-session-id": "does-not-exist",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
    });
    await res.text();
    expect(res.status).toBe(404);
  });

  it("rejects a request body over the 4 MB cap (413)", async () => {
    const url = await start();
    const oversized = "x".repeat(5 * 1024 * 1024);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1, params: { oversized } }),
    });
    await res.text();
    expect(res.status).toBe(413);
  });

  it("returns 405 for unsupported methods and 404 for unknown paths", async () => {
    const url = await start();

    const optionsRes = await fetch(url, { method: "OPTIONS" });
    await optionsRes.text();
    expect(optionsRes.status).toBe(405);

    const pathRes = await fetch(new URL("/nope", url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    await pathRes.text();
    expect(pathRes.status).toBe(404);
  });

  it("rejects an initialize request whose Host is not in the allowlist", async () => {
    const url = await start(["example.com:9999"]);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        id: 1,
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "0" } },
      }),
    });
    await res.text();
    expect(res.status).toBe(403);
  });

  it("close() resolves even with a live session still open", async () => {
    await start();
    const client = new Client({ name: "lingering", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${handle!.port}/mcp`)));

    // Closing the handle must terminate the open SSE stream first, so this resolves.
    await expect(handle!.close()).resolves.toBeUndefined();
    handle = undefined;
    await client.close().catch(() => undefined);
  });

  it("keeps two concurrent sessions isolated", async () => {
    const url = await start();
    const clientA = new Client({ name: "a", version: "0.0.0" });
    const clientB = new Client({ name: "b", version: "0.0.0" });
    const transportA = new StreamableHTTPClientTransport(url);
    const transportB = new StreamableHTTPClientTransport(url);

    await clientA.connect(transportA);
    await clientB.connect(transportB);

    expect(transportA.sessionId).toBeDefined();
    expect(transportB.sessionId).toBeDefined();
    expect(transportA.sessionId).not.toBe(transportB.sessionId);

    const [listA, listB] = await Promise.all([clientA.listTools(), clientB.listTools()]);
    expect(listA.tools.length).toBeGreaterThan(0);
    expect(listB.tools.length).toBe(listA.tools.length);

    await clientA.close();
    await clientB.close();
  });
});
