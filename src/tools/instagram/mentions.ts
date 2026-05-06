import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";

const MENTIONED_COMMENT_DEFAULT_FIELDS = "id,text,timestamp,username,media{id,media_url,media_type}";
const TAGGED_MEDIA_DEFAULT_FIELDS = "id,caption,media_type,media_url,permalink,timestamp,username";

export function registerIgMentionTools(server: McpServer, client: MetaClient): void {
  // ─── ig_get_mentioned_comment ────────────────────────────────
  server.tool(
    "ig_get_mentioned_comment",
    "Get details of a specific comment where the account was @mentioned. Requires the comment_id from a mention webhook notification. Returns a single comment with its associated media.",
    {
      comment_id: z.string().describe("Comment ID from a mention webhook notification"),
      fields: z.string().optional().default(MENTIONED_COMMENT_DEFAULT_FIELDS).describe(`Comma-separated fields (default: ${MENTIONED_COMMENT_DEFAULT_FIELDS})`),
    },
    async ({ comment_id, fields }) => {
      try {
        const { data, rateLimit } = await client.ig("GET", `/${client.igUserId}/mentioned_comment`, {
          comment_id,
          fields,
        });
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Get mentioned comment failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // ─── ig_get_tagged_media ─────────────────────────────────────
  server.tool(
    "ig_get_tagged_media",
    "Get media where the account is tagged (photo tags, not @mentions).",
    {
      limit: z.number().optional().describe("Number of results"),
      after: z.string().optional().describe("Pagination cursor"),
      fields: z.string().optional().default(TAGGED_MEDIA_DEFAULT_FIELDS).describe(`Comma-separated fields (default: ${TAGGED_MEDIA_DEFAULT_FIELDS})`),
    },
    async ({ limit, after, fields }) => {
      try {
        const params: Record<string, unknown> = { fields };
        if (limit !== undefined) params.limit = limit;
        if (after) params.after = after;
        const { data, rateLimit } = await client.ig("GET", `/${client.igUserId}/tags`, params);
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Get tagged media failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );
}
