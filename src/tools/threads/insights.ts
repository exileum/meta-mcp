import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient, FormParams } from "../../services/meta-client.js";
import { metaId } from "../../schemas.js";
import { formatErrorResponse } from "../../utils/errors.js";

const POST_INSIGHTS_DEFAULT_METRICS = "views,likes,replies,reposts,quotes,shares";

export function registerThreadsInsightTools(server: McpServer, client: MetaClient): void {
  // ─── threads_get_post_insights ───────────────────────────────
  server.tool(
    "threads_get_post_insights",
    `Get insights/analytics for a specific Threads post (${POST_INSIGHTS_DEFAULT_METRICS.replaceAll(",", ", ")}).`,
    {
      post_id: metaId.describe("Threads post ID"),
      metric: z.string().optional().default(POST_INSIGHTS_DEFAULT_METRICS).describe(`Comma-separated metrics (default: ${POST_INSIGHTS_DEFAULT_METRICS})`),
    },
    async ({ post_id, metric }) => {
      try {
        const { data, rateLimit } = await client.threads("GET", `/${post_id}/insights`, { metric });
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return formatErrorResponse(error, "Get post insights");
      }
    }
  );

  // ─── threads_get_user_insights ───────────────────────────────
  server.tool(
    "threads_get_user_insights",
    "Get account-level Threads insights (views, likes, replies, reposts, quotes, clicks, followers, follower demographics). Requires period parameter.",
    {
      metric: z.string().describe("Comma-separated metrics: views,likes,replies,reposts,quotes,clicks,followers_count,follower_demographics"),
      period: z.enum(["day", "lifetime"]).optional().default("day").describe("Time aggregation period. Use 'day' for time-series metrics (views, likes, replies, reposts, quotes, followers_count). Use 'lifetime' only for follower_demographics."),
      since: z.string().optional().describe("Start date (Unix timestamp). Required when period is 'day'."),
      until: z.string().optional().describe("End date (Unix timestamp). Required when period is 'day'."),
    },
    async ({ metric, period, since, until }) => {
      try {
        const params: FormParams = { metric, period };
        if (since) params.since = since;
        if (until) params.until = until;
        const { data, rateLimit } = await client.threads("GET", `/${client.threadsUserId}/threads_insights`, params);
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return formatErrorResponse(error, "Get user insights");
      }
    }
  );
}
