import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient, FormParams } from "../../services/meta-client.js";
import { formatErrorResponse } from "../../utils/errors.js";
import { formatResponse } from "../../utils/response.js";
import { READ_ONLY_TOOL } from "../annotations.js";

export function registerThreadsMentionsTools(server: McpServer, client: MetaClient): void {
  // ─── threads_get_mentions ────────────────────────────────────
  server.registerTool(
    "threads_get_mentions",
    {
      description: "List Threads posts where the authenticated user has been @mentioned. Requires the threads_manage_mentions permission. Posts from private profiles are excluded by the API. Without advanced access approval, only mentions from designated app testers are returned.",
      inputSchema: {
        limit: z.number().optional().describe("Number of results"),
        since: z.string().optional().describe("Start Unix timestamp (must be >= 1688540400)"),
        until: z.string().optional().describe("End Unix timestamp (must be <= now)"),
        after: z.string().optional().describe("Pagination cursor"),
      },
      annotations: READ_ONLY_TOOL,
    },
    async ({ limit, since, until, after }) => {
      try {
        const params: FormParams = {
          fields: "id,media_product_type,media_type,media_url,text,permalink,timestamp,username,shortcode,is_quote_post,topic_tag,has_replies,is_verified,profile_picture_url",
        };
        if (limit !== undefined) params.limit = limit;
        if (since) params.since = since;
        if (until) params.until = until;
        if (after) params.after = after;
        const { data, rateLimit } = await client.threads("GET", `/${client.threadsUserId}/mentions`, params);
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Get mentions");
      }
    }
  );
}
