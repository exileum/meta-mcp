import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";

const GET_MEDIA_DEFAULT_FIELDS = "id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,like_count,comments_count";
const GET_MEDIA_INSIGHTS_DEFAULT_METRIC = "views,reach";

export function registerIgMediaTools(server: McpServer, client: MetaClient): void {
  // ─── ig_get_media_list ───────────────────────────────────────
  server.tool(
    "ig_get_media_list",
    "Get list of media published on the Instagram account.",
    {
      limit: z.number().optional().describe("Number of results (max 100, default 25)"),
      after: z.string().optional().describe("Pagination cursor for next page"),
      before: z.string().optional().describe("Pagination cursor for previous page"),
    },
    async ({ limit, after, before }) => {
      try {
        const params: Record<string, unknown> = {
          fields: "id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,like_count,comments_count",
        };
        if (limit !== undefined) params.limit = limit;
        if (after) params.after = after;
        if (before) params.before = before;
        const { data, rateLimit } = await client.ig("GET", `/${client.igUserId}/media`, params);
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Get media list failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // ─── ig_get_media ────────────────────────────────────────────
  server.tool(
    "ig_get_media",
    "Get details of a specific Instagram media post.",
    {
      media_id: z.string().describe("Media ID"),
      fields: z.string().optional().default(GET_MEDIA_DEFAULT_FIELDS).describe(`Comma-separated fields (default: ${GET_MEDIA_DEFAULT_FIELDS})`),
    },
    async ({ media_id, fields }) => {
      try {
        const { data, rateLimit } = await client.ig("GET", `/${media_id}`, { fields });
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Get media failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // ─── ig_delete_media ─────────────────────────────────────────
  server.tool(
    "ig_delete_media",
    "Delete an Instagram media post (posts, carousels, reels, stories). This action is irreversible. Requires instagram_manage_contents permission (Facebook Login only — not available with Instagram Login).",
    {
      media_id: z.string().describe("Media ID to delete"),
    },
    async ({ media_id }) => {
      try {
        const { data, rateLimit } = await client.ig("DELETE", `/${media_id}`);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Delete media failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // ─── ig_get_media_insights ───────────────────────────────────
  server.tool(
    "ig_get_media_insights",
    "Get insights/analytics for a specific media post. Default metrics 'views,reach' are safe for every media type. Metric availability differs by media type — request more selectively to avoid (#100) errors:\n" +
      "- IMAGE / VIDEO / CAROUSEL: views, reach, saved, total_interactions, likes, comments (note: 'shares' may return (#100) on IMAGE — test before relying on it)\n" +
      "- REEL: views, reach, saved, total_interactions, likes, comments, shares, reposts, reels_skip_rate\n" +
      "- STORY: views, reach, total_interactions, navigation, replies, profile_activity, profile_visits, follows\n" +
      "Note: 'impressions' and 'video_views' were deprecated in v22.0 — use 'views' instead. See https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/ for the authoritative per-type matrix.",
    {
      media_id: z.string().describe("Media ID"),
      metric: z.string().optional().default(GET_MEDIA_INSIGHTS_DEFAULT_METRIC).describe(`Comma-separated metrics. Default '${GET_MEDIA_INSIGHTS_DEFAULT_METRIC}' is universally supported; override per media type per the tool description.`),
    },
    async ({ media_id, metric }) => {
      try {
        const { data, rateLimit } = await client.ig("GET", `/${media_id}/insights`, { metric });
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Get media insights failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // ─── ig_toggle_comments ──────────────────────────────────────
  server.tool(
    "ig_toggle_comments",
    "Enable or disable comments on an Instagram media post.",
    {
      media_id: z.string().describe("Media ID"),
      enabled: z.boolean().describe("true to enable comments, false to disable"),
    },
    async ({ media_id, enabled }) => {
      try {
        const { data, rateLimit } = await client.ig("POST", `/${media_id}`, {
          comment_enabled: enabled,
        });
        return { content: [{ type: "text", text: JSON.stringify({ success: true, comment_enabled: enabled, ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Toggle comments failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );
}
