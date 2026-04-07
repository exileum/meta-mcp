import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";

export function registerThreadsMentionsTools(server: McpServer, client: MetaClient): void {
  // ─── threads_get_mentions ────────────────────────────────────
  server.tool(
    "threads_get_mentions",
    "List Threads posts where the authenticated user has been @mentioned. Requires the threads_manage_mentions permission. Posts from private profiles are excluded by the API. Without advanced access approval, only mentions from designated app testers are returned.",
    {
      limit: z.number().optional().describe("Number of results"),
      since: z.string().optional().describe("Start Unix timestamp (must be >= 1688540400)"),
      until: z.string().optional().describe("End Unix timestamp (must be <= now)"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    async ({ limit, since, until, after }) => {
      try {
        const params: Record<string, unknown> = {
          fields: "id,media_product_type,media_type,media_url,text,permalink,timestamp,username,shortcode,is_quote_post,topic_tag,has_replies,is_verified,profile_picture_url",
        };
        if (limit !== undefined) params.limit = limit;
        if (since) params.since = since;
        if (until) params.until = until;
        if (after) params.after = after;
        const { data, rateLimit } = await client.threads("GET", `/${client.threadsUserId}/mentions`, params);
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Get mentions failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );
}
