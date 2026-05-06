import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { formatErrorResponse } from "../../utils/errors.js";

export const igBusinessDiscoveryUsernameSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/^@+/, ""))
  .refine((v) => v.length > 0, {
    message: "Username cannot be empty, only whitespace, or only '@' characters",
  })
  .refine((v) => /^[a-zA-Z0-9._]{1,30}$/.test(v), {
    message:
      "Instagram username must be 1-30 characters and contain only letters, numbers, periods, and underscores",
  })
  .describe(
    "Instagram username to look up (1-30 chars, letters/numbers/periods/underscores only; without @, leading '@' characters and surrounding whitespace are auto-stripped)"
  );

export function registerIgProfileTools(server: McpServer, client: MetaClient): void {
  // ─── ig_get_profile ──────────────────────────────────────────
  server.tool(
    "ig_get_profile",
    "Get Instagram Business/Creator account profile information.",
    {},
    async () => {
      try {
        const { data, rateLimit } = await client.ig("GET", `/${client.igUserId}`, {
          fields: "id,name,username,biography,followers_count,follows_count,media_count,profile_picture_url,website",
        });
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return formatErrorResponse(error, "Get profile");
      }
    }
  );

  // ─── ig_get_account_insights ─────────────────────────────────
  server.tool(
    "ig_get_account_insights",
    "Get Instagram account insights. Use the optional `metric_type` to control whether results come back as a single total per metric or as a daily breakdown. Note: 'impressions', 'email_contacts', 'phone_call_clicks', 'text_message_clicks', 'get_directions_clicks', 'website_clicks', 'profile_views' were deprecated in v22.0. Use 'views', 'reach', 'follower_count', 'reposts' instead.",
    {
      metric: z.string().describe(
        "Comma-separated metrics. Time-series metrics (use period=day/week/days_28): " +
        "views,reach,accounts_engaged,total_interactions,reposts,profile_links_taps. " +
        "Lifetime-only metrics (use period=lifetime): " +
        "follower_count,follower_demographics,engaged_audience_demographics."
      ),
      period: z.enum(["day", "week", "days_28", "lifetime"]).describe(
        "Aggregation period. Use 'day', 'week', or 'days_28' for time-series metrics " +
        "(views,reach,accounts_engaged,total_interactions,reposts,profile_links_taps). " +
        "Use 'lifetime' only for follower_count and demographic metrics " +
        "(follower_demographics,engaged_audience_demographics)."
      ),
      metric_type: z.enum(["total_value", "time_series"]).optional().describe("Aggregation shape: 'total_value' for a single aggregated number per metric, 'time_series' for daily breakdowns. Per the Instagram User Insights docs, only 'reach' supports both; most metrics (views, likes, reposts, accounts_engaged, total_interactions, saves, shares, comments, replies, quotes, profile_links_taps, demographics) support only 'total_value'. Omit to use the API default for each metric."),
      since: z.string().optional().describe("Start date (Unix timestamp or ISO 8601)"),
      until: z.string().optional().describe("End date (Unix timestamp or ISO 8601)"),
    },
    async ({ metric, period, metric_type, since, until }) => {
      try {
        const params: Record<string, unknown> = { metric, period };
        if (metric_type) params.metric_type = metric_type;
        if (since) params.since = since;
        if (until) params.until = until;
        const { data, rateLimit } = await client.ig("GET", `/${client.igUserId}/insights`, params);
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return formatErrorResponse(error, "Get account insights");
      }
    }
  );

  // ─── ig_business_discovery ───────────────────────────────────
  server.tool(
    "ig_business_discovery",
    "Look up another Instagram Business/Creator account's public info by username.",
    {
      username: igBusinessDiscoveryUsernameSchema,
      fields: z.string().optional().describe("Fields to retrieve (default: id,username,name,biography,followers_count,follows_count,media_count)"),
    },
    async ({ username, fields }) => {
      try {
        const f = fields || "id,username,name,biography,followers_count,follows_count,media_count";
        const { data, rateLimit } = await client.ig("GET", `/${client.igUserId}`, {
          fields: `business_discovery.username(${username}){${f}}`,
        });
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return formatErrorResponse(error, "Business discovery");
      }
    }
  );

  // ─── ig_get_collaboration_invites ────────────────────────────
  server.tool(
    "ig_get_collaboration_invites",
    "Get pending collaboration invites for the Instagram account. Added in December 2025.",
    {
      limit: z.number().optional().describe("Number of results"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    async ({ limit, after }) => {
      try {
        const params: Record<string, unknown> = {};
        if (limit !== undefined) params.limit = limit;
        if (after) params.after = after;
        const { data, rateLimit } = await client.ig("GET", `/${client.igUserId}/collaboration_invites`, params);
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return formatErrorResponse(error, "Get collaboration invites");
      }
    }
  );

  // ─── ig_respond_collaboration_invite ─────────────────────────
  server.tool(
    "ig_respond_collaboration_invite",
    "Accept or decline a collaboration invite. Added in December 2025.",
    {
      invite_id: z.string().describe("Collaboration invite ID"),
      action: z.enum(["accept", "decline"]).describe("Accept or decline the invite"),
    },
    async ({ invite_id, action }) => {
      try {
        const { data, rateLimit } = await client.ig("POST", `/${client.igUserId}/collaboration_invites`, {
          invite_id,
          action,
        });
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return formatErrorResponse(error, "Respond to collaboration invite");
      }
    }
  );
}
