import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { metaId } from "../../schemas.js";
import { formatErrorResponse } from "../../utils/errors.js";
import { formatResponse } from "../../utils/response.js";
import { buildParams } from "../../utils/params.js";
import { READ_ONLY_TOOL, DESTRUCTIVE_TOOL, WRITE_TOOL, WRITE_IDEMPOTENT_TOOL } from "../annotations.js";

const GET_COMMENTS_DEFAULT_FIELDS = "id,text,username,timestamp,like_count,replies{id,text,username,timestamp}";
const GET_COMMENT_DEFAULT_FIELDS = "id,text,username,timestamp,like_count,parent_id,media";
const GET_REPLIES_DEFAULT_FIELDS = "id,text,username,timestamp,like_count";

export function registerIgCommentTools(server: McpServer, client: MetaClient): void {
  // ─── ig_get_comments ─────────────────────────────────────────
  server.registerTool(
    "ig_get_comments",
    {
      description: "Get comments on a specific Instagram media post.",
      inputSchema: {
        media_id: metaId.describe("Media ID"),
        limit: z.number().optional().describe("Number of comments to return"),
        after: z.string().optional().describe("Pagination cursor for next page"),
        before: z.string().optional().describe("Pagination cursor for previous page"),
        fields: z.string().optional().default(GET_COMMENTS_DEFAULT_FIELDS).describe(`Comma-separated fields (default: ${GET_COMMENTS_DEFAULT_FIELDS})`),
      },
      annotations: READ_ONLY_TOOL,
    },
    async ({ media_id, limit, after, before, fields }) => {
      try {
        const params = buildParams({ fields }, { limit, after, before });
        const { data, rateLimit } = await client.ig("GET", `/${media_id}/comments`, params);
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Get comments");
      }
    }
  );

  // ─── ig_get_comment ──────────────────────────────────────────
  server.registerTool(
    "ig_get_comment",
    {
      description: "Get details of a specific comment.",
      inputSchema: {
        comment_id: metaId.describe("Comment ID"),
        fields: z.string().optional().default(GET_COMMENT_DEFAULT_FIELDS).describe(`Comma-separated fields (default: ${GET_COMMENT_DEFAULT_FIELDS})`),
      },
      annotations: READ_ONLY_TOOL,
    },
    async ({ comment_id, fields }) => {
      try {
        const { data, rateLimit } = await client.ig("GET", `/${comment_id}`, { fields });
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Get comment");
      }
    }
  );

  // ─── ig_post_comment ─────────────────────────────────────────
  server.registerTool(
    "ig_post_comment",
    {
      description: "Post a top-level comment on a media post.",
      inputSchema: {
        media_id: metaId.describe("Media ID to comment on"),
        message: z.string().describe("Comment text"),
      },
      annotations: WRITE_TOOL,
    },
    async ({ media_id, message }) => {
      try {
        const { data, rateLimit } = await client.ig("POST", `/${media_id}/comments`, { message });
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Post comment");
      }
    }
  );

  // ─── ig_get_replies ──────────────────────────────────────────
  server.registerTool(
    "ig_get_replies",
    {
      description: "Get replies to a specific comment.",
      inputSchema: {
        comment_id: metaId.describe("Comment ID to get replies for"),
        limit: z.number().optional().describe("Number of replies to return"),
        after: z.string().optional().describe("Pagination cursor for next page"),
        before: z.string().optional().describe("Pagination cursor for previous page"),
        fields: z.string().optional().default(GET_REPLIES_DEFAULT_FIELDS).describe(`Comma-separated fields (default: ${GET_REPLIES_DEFAULT_FIELDS})`),
      },
      annotations: READ_ONLY_TOOL,
    },
    async ({ comment_id, limit, after, before, fields }) => {
      try {
        const params = buildParams({ fields }, { limit, after, before });
        const { data, rateLimit } = await client.ig("GET", `/${comment_id}/replies`, params);
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Get replies");
      }
    }
  );

  // ─── ig_reply_to_comment ─────────────────────────────────────
  server.registerTool(
    "ig_reply_to_comment",
    {
      description: "Reply to a specific comment.",
      inputSchema: {
        comment_id: metaId.describe("Comment ID to reply to"),
        message: z.string().describe("Reply text"),
      },
      annotations: WRITE_TOOL,
    },
    async ({ comment_id, message }) => {
      try {
        const { data, rateLimit } = await client.ig("POST", `/${comment_id}/replies`, { message });
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Reply");
      }
    }
  );

  // ─── ig_hide_comment ─────────────────────────────────────────
  server.registerTool(
    "ig_hide_comment",
    {
      description: "Hide or unhide a comment on your post.",
      inputSchema: {
        comment_id: metaId.describe("Comment ID"),
        hide: z.boolean().describe("true to hide, false to unhide"),
      },
      annotations: WRITE_IDEMPOTENT_TOOL,
    },
    async ({ comment_id, hide }) => {
      try {
        const { data, rateLimit } = await client.ig("POST", `/${comment_id}`, { hide });
        return formatResponse({ success: true, hidden: hide, ...data }, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Hide comment");
      }
    }
  );

  // ─── ig_delete_comment ───────────────────────────────────────
  server.registerTool(
    "ig_delete_comment",
    {
      description: "Delete a comment from your media post. This action is irreversible.",
      inputSchema: {
        comment_id: metaId.describe("Comment ID to delete"),
      },
      annotations: DESTRUCTIVE_TOOL,
    },
    async ({ comment_id }) => {
      try {
        const { data, rateLimit } = await client.ig("DELETE", `/${comment_id}`);
        return formatResponse({ success: true, ...data }, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Delete comment");
      }
    }
  );
}
