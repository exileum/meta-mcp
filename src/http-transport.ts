import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

export const DEFAULT_HTTP_HOST = "127.0.0.1";
export const DEFAULT_HTTP_PORT = 3000;
export const MCP_ENDPOINT = "/mcp";

// Node's http server imposes no body limit; cap reads to avoid memory exhaustion.
const MAX_BODY_BYTES = 4 * 1024 * 1024;

// A Streamable HTTP session only self-evicts on an explicit DELETE / transport
// close — a client that initializes then drops its connection never fires
// onclose, so without a reaper the sessions map grows without bound. The reaper
// closes sessions with no POST/GET for longer than the TTL; a still-connected
// but silent client is recycled too and reconnects on its next request.
export const DEFAULT_SESSION_IDLE_TTL_MS = 30 * 60 * 1000;
export const DEFAULT_REAPER_INTERVAL_MS = 60 * 1000;

export interface HttpTransportConfig {
  host: string;
  port: number;
  // undefined → derive a localhost allowlist after binding; a list is used verbatim.
  allowedHosts: string[] | undefined;
}

export interface StartHttpTransportOptions extends HttpTransportConfig {
  // A fresh McpServer per session keeps each client's state isolated.
  createServer: () => McpServer;
  log?: (msg: string) => void;
  sessionIdleTtlMs?: number;
  reaperIntervalMs?: number;
}

export interface HttpTransportHandle {
  port: number;
  close(): Promise<void>;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  lastActivity: number;
}

export function parseHttpTransportConfig(env: NodeJS.ProcessEnv): HttpTransportConfig {
  const host = env.MCP_HTTP_HOST?.trim() || DEFAULT_HTTP_HOST;

  let port = DEFAULT_HTTP_PORT;
  const rawPort = env.MCP_HTTP_PORT?.trim();
  if (rawPort) {
    // Number() (unlike parseInt) rejects "3000abc" as NaN.
    const parsed = Number(rawPort);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      throw new Error(
        `MCP_HTTP_PORT must be an integer between 1 and 65535 (got "${rawPort}")`
      );
    }
    port = parsed;
  }

  const rawAllowed = env.MCP_HTTP_ALLOWED_HOSTS?.trim();
  const allowedHosts = rawAllowed
    ? rawAllowed.split(",").map((h) => h.trim()).filter(Boolean)
    : undefined;

  return { host, port, allowedHosts };
}

export async function startHttpTransport(
  options: StartHttpTransportOptions
): Promise<HttpTransportHandle> {
  const { host, createServer: createMcpServer } = options;
  const log = options.log ?? ((msg: string) => console.error(msg));
  const sessionIdleTtlMs = options.sessionIdleTtlMs ?? DEFAULT_SESSION_IDLE_TTL_MS;
  const reaperIntervalMs = options.reaperIntervalMs ?? DEFAULT_REAPER_INTERVAL_MS;

  const sessions = new Map<string, Session>();

  const reaper = setInterval(() => {
    const now = Date.now();
    for (const [sid, session] of sessions) {
      if (now - session.lastActivity > sessionIdleTtlMs) {
        sessions.delete(sid);
        void session.transport.close().catch((err: unknown) =>
          log(`[meta-mcp] reaper failed to close idle session ${sid} — ${errMessage(err)}`)
        );
      }
    }
  }, reaperIntervalMs);
  reaper.unref();

  // Resolved after listen() so DNS-rebinding allowlists can include the actual
  // bound port (matters when port is 0, e.g. in tests).
  let allowedHosts: string[] = [];
  let dnsRebindingProtection = false;

  const httpServer = createServer((req, res) => {
    void handleRequest(req, res).catch((err: unknown) => {
      log(`[meta-mcp] HTTP handler error — ${errMessage(err)}`);
      sendJsonRpcError(res, 500, -32603, "Internal server error");
    });
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);
    if (url.pathname !== MCP_ENDPOINT) {
      sendJsonRpcError(res, 404, -32601, `Not found: ${url.pathname}`);
      return;
    }

    const method = req.method ?? "GET";
    const sessionId = headerValue(req.headers["mcp-session-id"]);

    if (method === "POST") {
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        // Fixed messages only — never echo exception text back to a remote client.
        if (err instanceof PayloadTooLargeError) {
          sendJsonRpcError(res, 413, -32600, "Request body too large");
        } else {
          sendJsonRpcError(res, 400, -32700, "Invalid JSON in request body");
        }
        return;
      }

      if (sessionId) {
        const session = sessions.get(sessionId);
        if (!session) {
          sendJsonRpcError(res, 404, -32001, "Session not found");
          return;
        }
        session.lastActivity = Date.now();
        await session.transport.handleRequest(req, res, body);
        return;
      }

      if (isInitializeRequest(body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableDnsRebindingProtection: dnsRebindingProtection,
          allowedHosts,
          onsessioninitialized: (sid) => {
            sessions.set(sid, { transport, lastActivity: Date.now() });
          },
        });
        // Evict on transport close (DELETE or explicit teardown). A bare client
        // disconnect never fires onclose — the idle reaper handles those.
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) sessions.delete(sid);
        };
        try {
          await createMcpServer().connect(transport);
          await transport.handleRequest(req, res, body);
        } catch (err) {
          // Close so onclose evicts a half-initialized session from the map.
          await transport.close().catch(() => undefined);
          throw err;
        }
        return;
      }

      sendJsonRpcError(res, 400, -32000, "Bad Request: missing or invalid session ID");
      return;
    }

    if (method === "GET" || method === "DELETE") {
      if (!sessionId) {
        sendJsonRpcError(res, 400, -32000, "Bad Request: missing session ID");
        return;
      }
      const session = sessions.get(sessionId);
      if (!session) {
        sendJsonRpcError(res, 404, -32001, "Session not found");
        return;
      }
      session.lastActivity = Date.now();
      await session.transport.handleRequest(req, res);
      return;
    }

    sendJsonRpcError(res, 405, -32601, `Method not allowed: ${method}`);
  }

  await new Promise<void>((resolve, reject) => {
    const onListenError = (err: Error): void => reject(err);
    httpServer.once("error", onListenError);
    httpServer.listen(options.port, host, () => {
      httpServer.removeListener("error", onListenError);
      resolve();
    });
  });

  const actualPort = (httpServer.address() as AddressInfo).port;

  if (options.allowedHosts && options.allowedHosts.length > 0) {
    allowedHosts = options.allowedHosts;
    dnsRebindingProtection = true;
  } else if (isLoopbackHost(host)) {
    allowedHosts = loopbackHosts(actualPort);
    dnsRebindingProtection = true;
  } else {
    // Bound to a routable interface (e.g. 0.0.0.0 in Docker) with no allowlist —
    // a Host allowlist can't be derived, so leave protection off and tell the
    // operator to front it with a proxy or set MCP_HTTP_ALLOWED_HOSTS.
    log(
      `[meta-mcp] Warning: HTTP transport bound to non-loopback host ${host} without ` +
        `MCP_HTTP_ALLOWED_HOSTS — DNS-rebinding protection is disabled. Run behind a ` +
        `reverse proxy and/or set MCP_HTTP_ALLOWED_HOSTS.`
    );
  }

  log(`[meta-mcp] HTTP transport listening on http://${host}:${actualPort}${MCP_ENDPOINT}`);

  return {
    port: actualPort,
    close: () => {
      clearInterval(reaper);
      return closeHttpTransport(httpServer, sessions);
    },
  };
}

async function closeHttpTransport(
  httpServer: Server,
  sessions: Map<string, Session>
): Promise<void> {
  // Close transports first: each open SSE stream holds a socket that
  // httpServer.close() would otherwise wait on forever.
  for (const { transport } of sessions.values()) {
    try {
      await transport.close();
    } catch {
      // best-effort — keep tearing down the rest
    }
  }
  sessions.clear();
  httpServer.closeIdleConnections();
  await new Promise<void>((resolve, reject) => {
    httpServer.close((err) => (err ? reject(err) : resolve()));
  });
}

class PayloadTooLargeError extends Error {}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Reject and stop buffering, but keep draining the socket so the 413
        // response writes cleanly — destroying req here would kill res too.
        settle(() =>
          reject(new PayloadTooLargeError(`Request body exceeds ${MAX_BODY_BYTES} bytes`))
        );
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      settle(() => {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw) {
          resolve(undefined);
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new SyntaxError("Invalid JSON in request body"));
        }
      });
    });
    req.on("error", (err) => settle(() => reject(err)));
  });
}

function sendJsonRpcError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string
): void {
  if (res.headersSent || res.writableEnded || res.destroyed) return;
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function isLoopbackHost(host: string): boolean {
  // The whole 127.0.0.0/8 range is loopback, plus localhost and IPv6 ::1.
  return host === "localhost" || host === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

function loopbackHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
