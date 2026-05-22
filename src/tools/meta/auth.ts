import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { httpsUrl } from "../../schemas.js";
import { formatErrorResponse } from "../../utils/errors.js";
import { formatResponse } from "../../utils/response.js";
import { READ_ONLY_TOOL, WRITE_TOOL, WRITE_IDEMPOTENT_TOOL } from "../annotations.js";

export function registerMetaAuthTools(server: McpServer, client: MetaClient): void {
  // ─── meta_exchange_token ─────────────────────────────────────
  server.registerTool(
    "meta_exchange_token",
    {
      description: "Exchange a short-lived token for a long-lived token (valid ~60 days). Uses platform-specific endpoints: Instagram (graph.instagram.com) or Threads (graph.threads.net). Requires META_APP_SECRET.",
      inputSchema: {
        short_lived_token: z.string().describe("Short-lived access token to exchange"),
        platform: z.enum(["instagram", "threads"]).describe("Target platform: 'instagram' or 'threads'"),
      },
      annotations: WRITE_TOOL,
    },
    async ({ short_lived_token, platform }) => {
      try {
        const { data, rateLimit } = platform === "threads"
          ? await client.threadsExchangeToken(short_lived_token)
          : await client.igExchangeToken(short_lived_token);
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Token exchange");
      }
    }
  );

  // ─── meta_refresh_token ──────────────────────────────────────
  server.registerTool(
    "meta_refresh_token",
    {
      description: "Refresh a long-lived token before it expires (must be at least 24h old). Uses platform-specific endpoints: Instagram (graph.instagram.com) or Threads (graph.threads.net). Returns a new long-lived token valid for 60 days.",
      inputSchema: {
        long_lived_token: z.string().describe("Current long-lived access token to refresh"),
        platform: z.enum(["instagram", "threads"]).describe("Target platform: 'instagram' or 'threads'"),
      },
      annotations: WRITE_TOOL,
    },
    async ({ long_lived_token, platform }) => {
      try {
        const { data, rateLimit } = platform === "threads"
          ? await client.threadsRefreshToken(long_lived_token)
          : await client.igRefreshToken(long_lived_token);
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Token refresh");
      }
    }
  );

  // ─── meta_debug_token ────────────────────────────────────────
  server.registerTool(
    "meta_debug_token",
    {
      description: "Debug/inspect an access token to check validity, expiration, scopes and associated user.",
      inputSchema: {
        input_token: z.string().describe("Access token to inspect"),
      },
      annotations: READ_ONLY_TOOL,
    },
    async ({ input_token }) => {
      try {
        const { data, rateLimit } = await client.debugToken(input_token);
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Token debug");
      }
    }
  );

  // ─── meta_get_app_info ───────────────────────────────────────
  server.registerTool(
    "meta_get_app_info",
    {
      description: "Get Meta App basic information (name, category, namespace, etc.).",
      inputSchema: {},
      annotations: READ_ONLY_TOOL,
    },
    async () => {
      try {
        const { data, rateLimit } = await client.meta("GET", `/app`, {
          fields: "id,name,category,namespace,link,company,description",
        });
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Get app info");
      }
    }
  );

  // ─── meta_subscribe_webhook ──────────────────────────────────
  server.registerTool(
    "meta_subscribe_webhook",
    {
      description: "Subscribe to webhook notifications for an object (e.g., 'instagram', 'page'). Requires META_APP_ID and META_APP_SECRET.",
      inputSchema: {
        object: z.enum(["instagram", "page", "user", "permissions"]).describe("Object type to subscribe to"),
        callback_url: httpsUrl.describe("HTTPS webhook endpoint URL"),
        verify_token: z.string().describe("Verification token for the webhook"),
        fields: z.string().describe("Comma-separated list of fields to subscribe (e.g., 'messages,feed')"),
      },
      annotations: WRITE_IDEMPOTENT_TOOL,
    },
    async ({ object, callback_url, verify_token, fields }) => {
      try {
        const { data, rateLimit } = await client.meta("POST", `/app/subscriptions`, {
          object,
          callback_url,
          verify_token,
          fields,
        });
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Webhook subscribe");
      }
    }
  );

  // ─── meta_get_webhook_subscriptions ──────────────────────────
  server.registerTool(
    "meta_get_webhook_subscriptions",
    {
      description: "List current webhook subscriptions for the Meta App.",
      inputSchema: {},
      annotations: READ_ONLY_TOOL,
    },
    async () => {
      try {
        const { data, rateLimit } = await client.meta("GET", `/app/subscriptions`);
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Get webhooks");
      }
    }
  );
}
