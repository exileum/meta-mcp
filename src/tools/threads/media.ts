import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient, FormParams } from "../../services/meta-client.js";
import { metaId } from "../../schemas.js";
import { formatErrorResponse } from "../../utils/errors.js";

const THREADS_MEDIA_FIELDS = [
  "id",
  "media_product_type",
  "media_type",
  "media_url",
  "permalink",
  "text",
  "timestamp",
  "shortcode",
  "is_quote_post",
  "has_replies",
  "reply_audience",
  "topic_tag",
  "link_attachment_url",
  "poll_attachment{option_a,option_b,option_c,option_d,option_a_votes_percentage,option_b_votes_percentage,option_c_votes_percentage,option_d_votes_percentage,total_votes,expiration_timestamp}",
  "gif_url",
  "alt_text",
].join(",");

export const authorUsernameSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/^@+/, ""))
  .refine((v) => v.length > 0, { message: "Username cannot be empty, only whitespace, or only '@' characters" })
  .optional()
  .describe(
    "Filter results to posts by exact username (server-side filter via Threads /keyword_search; per Threads API the username must be an exact match without '@'; leading '@' characters and surrounding whitespace are auto-stripped if provided)"
  );

export function registerThreadsMediaTools(server: McpServer, client: MetaClient): void {
  // ─── threads_get_posts ───────────────────────────────────────
  server.tool(
    "threads_get_posts",
    "Get a list of Threads posts published by the authenticated user.",
    {
      limit: z.number().optional().describe("Number of results (default 25)"),
      since: z.string().optional().describe("Start date (ISO 8601 or Unix timestamp)"),
      until: z.string().optional().describe("End date (ISO 8601 or Unix timestamp)"),
      after: z.string().optional().describe("Pagination cursor"),
      before: z.string().optional().describe("Pagination cursor"),
      fields: z.string().optional().default(THREADS_MEDIA_FIELDS).describe(`Comma-separated fields (default: ${THREADS_MEDIA_FIELDS})`),
    },
    async ({ limit, since, until, after, before, fields }) => {
      try {
        const params: FormParams = { fields };
        if (limit !== undefined) params.limit = limit;
        if (since) params.since = since;
        if (until) params.until = until;
        if (after) params.after = after;
        if (before) params.before = before;
        const { data, rateLimit } = await client.threads("GET", `/${client.threadsUserId}/threads`, params);
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return formatErrorResponse(error, "Get posts");
      }
    }
  );

  // ─── threads_get_post ────────────────────────────────────────
  server.tool(
    "threads_get_post",
    "Get details of a specific Threads post.",
    {
      post_id: metaId.describe("Threads post ID"),
      fields: z.string().optional().default(THREADS_MEDIA_FIELDS).describe(`Comma-separated fields (default: ${THREADS_MEDIA_FIELDS})`),
    },
    async ({ post_id, fields }) => {
      try {
        const { data, rateLimit } = await client.threads("GET", `/${post_id}`, { fields });
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return formatErrorResponse(error, "Get post");
      }
    }
  );

  // ─── threads_search_posts ────────────────────────────────────
  server.tool(
    "threads_search_posts",
    "Search for public Threads posts by keyword or topic tag. Requires threads_keyword_search permission.",
    {
      q: z.string().describe("Search keyword or query"),
      search_type: z.enum(["TOP", "RECENT"]).optional().describe("Result ordering: TOP (default) or RECENT"),
      search_mode: z.enum(["KEYWORD", "TAG"]).optional().describe("Search by KEYWORD (default) or TAG"),
      media_type: z.enum(["TEXT", "IMAGE", "VIDEO"]).optional().describe("Filter results by media type"),
      author_username: authorUsernameSchema,
      since: z.string().optional().describe("Start date (Unix timestamp)"),
      until: z.string().optional().describe("End date (Unix timestamp)"),
      limit: z.number().min(1).max(100).optional().describe("Number of results (max 100, default 25)"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    async ({ q, search_type, search_mode, media_type, author_username, since, until, limit, after }) => {
      try {
        const params: FormParams = {
          q,
          fields: "id,text,username,permalink,timestamp,media_type,media_url,topic_tag",
        };
        if (search_type) params.search_type = search_type;
        if (search_mode) params.search_mode = search_mode;
        if (media_type) params.media_type = media_type;
        if (author_username) params.author_username = author_username;
        if (since) params.since = since;
        if (until) params.until = until;
        if (limit !== undefined) params.limit = limit;
        if (after) params.after = after;
        const { data, rateLimit } = await client.threads("GET", `/keyword_search`, params);
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return formatErrorResponse(error, "Search posts");
      }
    }
  );
}
