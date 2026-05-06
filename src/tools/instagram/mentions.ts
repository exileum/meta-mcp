import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { formatErrorResponse } from "../../utils/errors.js";

export function registerIgMentionTools(server: McpServer, client: MetaClient): void {
  // ─── ig_get_mentioned_comment ────────────────────────────────
  server.tool(
    "ig_get_mentioned_comment",
    "Get details of a specific comment where the account was @mentioned. Requires the comment_id from a mention webhook notification. Returns a single comment with its associated media.",
    {
      comment_id: z.string().describe("Comment ID from a mention webhook notification"),
      fields: z.string().optional().describe("Comma-separated fields (default: id,text,timestamp,username,media{id,media_url,media_type})"),
    },
    async ({ comment_id, fields }) => {
      try {
        const f = fields || "id,text,timestamp,username,media{id,media_url,media_type}";
        const { data, rateLimit } = await client.ig("GET", `/${client.igUserId}/mentioned_comment`, {
          comment_id,
          fields: f,
        });
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return formatErrorResponse(error, "Get mentioned comment");
      }
    }
  );

  // ─── ig_get_tagged_media ─────────────────────────────────────
  server.tool(
    "ig_get_tagged_media",
    "Get media where the account is tagged (photo tags, not @mentions).",
    {
      limit: z.number().optional().describe("Number of results"),
      after: z.string().optional().describe("Pagination cursor for next page"),
      before: z.string().optional().describe("Pagination cursor for previous page"),
      fields: z.string().optional().describe("Comma-separated fields (default: id,caption,media_type,media_url,permalink,timestamp,username)"),
    },
    async ({ limit, after, before, fields }) => {
      try {
        const params: Record<string, unknown> = {
          fields: fields || "id,caption,media_type,media_url,permalink,timestamp,username",
        };
        if (limit !== undefined) params.limit = limit;
        if (after) params.after = after;
        if (before) params.before = before;
        const { data, rateLimit } = await client.ig("GET", `/${client.igUserId}/tags`, params);
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return formatErrorResponse(error, "Get tagged media");
      }
    }
  );
}
