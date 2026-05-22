import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { metaId } from "../../schemas.js";
import { IG_MEDIA_FIELDS } from "../../constants/fields.js";
import { formatErrorResponse } from "../../utils/errors.js";
import { formatResponse } from "../../utils/response.js";
import { buildParams } from "../../utils/params.js";
import { READ_ONLY_TOOL, DESTRUCTIVE_TOOL, WRITE_IDEMPOTENT_TOOL } from "../annotations.js";

const GET_MEDIA_INSIGHTS_DEFAULT_METRIC = "views,reach";

export function registerIgMediaTools(server: McpServer, client: MetaClient): void {
  // ─── ig_get_media_list ───────────────────────────────────────
  server.registerTool(
    "ig_get_media_list",
    {
      description: "Get list of media published on the Instagram account.",
      inputSchema: {
        limit: z.number().optional().describe("Number of results (max 100, default 25)"),
        after: z.string().optional().describe("Pagination cursor for next page"),
        before: z.string().optional().describe("Pagination cursor for previous page"),
      },
      annotations: READ_ONLY_TOOL,
    },
    async ({ limit, after, before }) => {
      try {
        const params = buildParams(
          {
            fields: IG_MEDIA_FIELDS,
          },
          { limit, after, before }
        );
        const { data, rateLimit } = await client.ig("GET", `/${client.igUserId}/media`, params);
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Get media list");
      }
    }
  );

  // ─── ig_get_media ────────────────────────────────────────────
  server.registerTool(
    "ig_get_media",
    {
      description: "Get details of a specific Instagram media post.",
      inputSchema: {
        media_id: metaId.describe("Media ID"),
        fields: z.string().optional().default(IG_MEDIA_FIELDS).describe(`Comma-separated fields (default: ${IG_MEDIA_FIELDS})`),
      },
      annotations: READ_ONLY_TOOL,
    },
    async ({ media_id, fields }) => {
      try {
        const { data, rateLimit } = await client.ig("GET", `/${media_id}`, { fields });
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Get media");
      }
    }
  );

  // ─── ig_delete_media ─────────────────────────────────────────
  server.registerTool(
    "ig_delete_media",
    {
      description: "Delete an Instagram media post (posts, carousels, reels, stories). This action is irreversible. Requires instagram_manage_contents permission (Facebook Login only — not available with Instagram Login).",
      inputSchema: {
        media_id: metaId.describe("Media ID to delete"),
      },
      annotations: DESTRUCTIVE_TOOL,
    },
    async ({ media_id }) => {
      try {
        const { data, rateLimit } = await client.ig("DELETE", `/${media_id}`);
        return formatResponse({ success: true, ...data }, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Delete media");
      }
    }
  );

  // ─── ig_get_media_insights ───────────────────────────────────
  server.registerTool(
    "ig_get_media_insights",
    {
      description: "Get insights/analytics for a specific media post. Default metrics 'views,reach' are safe for every media type. Metric availability differs by media type — request more selectively to avoid (#100) errors:\n" +
        "- IMAGE / VIDEO / CAROUSEL: views, reach, saved, total_interactions, likes, comments (note: 'shares' may return (#100) on IMAGE — test before relying on it)\n" +
        "- REEL: views, reach, saved, total_interactions, likes, comments, shares, reposts, reels_skip_rate\n" +
        "- STORY: views, reach, total_interactions, navigation, replies, profile_activity, profile_visits, follows\n" +
        "Note: 'impressions' and 'video_views' were deprecated in v22.0 — use 'views' instead. See https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/ for the authoritative per-type matrix.",
      inputSchema: {
        media_id: metaId.describe("Media ID"),
        metric: z.string().optional().default(GET_MEDIA_INSIGHTS_DEFAULT_METRIC).describe(`Comma-separated metrics. Default '${GET_MEDIA_INSIGHTS_DEFAULT_METRIC}' is universally supported; override per media type per the tool description.`),
      },
      annotations: READ_ONLY_TOOL,
    },
    async ({ media_id, metric }) => {
      try {
        const { data, rateLimit } = await client.ig("GET", `/${media_id}/insights`, { metric });
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Get media insights");
      }
    }
  );

  // ─── ig_toggle_comments ──────────────────────────────────────
  server.registerTool(
    "ig_toggle_comments",
    {
      description: "Enable or disable comments on an Instagram media post.",
      inputSchema: {
        media_id: metaId.describe("Media ID"),
        enabled: z.boolean().describe("true to enable comments, false to disable"),
      },
      annotations: WRITE_IDEMPOTENT_TOOL,
    },
    async ({ media_id, enabled }) => {
      try {
        const { data, rateLimit } = await client.ig("POST", `/${media_id}`, {
          comment_enabled: enabled,
        });
        return formatResponse({ success: true, comment_enabled: enabled, ...data }, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Toggle comments");
      }
    }
  );
}
