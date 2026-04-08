import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { httpsUrl } from "../../schemas.js";
import { waitForThreadsContainer } from "../../utils/container.js";

export function registerThreadsReplyTools(server: McpServer, client: MetaClient): void {
  // ─── threads_get_replies ─────────────────────────────────────
  server.tool(
    "threads_get_replies",
    "Get replies for a specific Threads post. By default returns only top-level replies (mode='top_level', endpoint /{post}/replies). Set mode='full_tree' to get the entire conversation flattened — every reply at every nesting level (endpoint /{post}/conversation). Both modes share the same response shape; full_tree additionally populates root_post, replied_to, is_reply so the caller can reconstruct the tree.",
    {
      post_id: z.string().describe("Threads post ID to get replies for"),
      mode: z.enum(["top_level", "full_tree"]).optional().describe("'top_level' (default) returns only direct replies; 'full_tree' returns the full conversation tree flattened"),
      reverse: z.boolean().optional().describe("Reverse chronological order"),
      limit: z.number().optional().describe("Number of replies"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    async ({ post_id, mode, reverse, limit, after }) => {
      try {
        const params: Record<string, unknown> = {
          fields: "id,text,username,permalink,timestamp,media_type,media_url,has_replies,hide_status,is_verified,profile_picture_url,root_post,replied_to,is_reply,is_quote_post",
        };
        if (reverse !== undefined) params.reverse = reverse;
        if (limit !== undefined) params.limit = limit;
        if (after) params.after = after;
        const edge = mode === "full_tree" ? "conversation" : "replies";
        const { data, rateLimit } = await client.threads("GET", `/${post_id}/${edge}`, params);
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Get replies failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // ─── threads_reply ───────────────────────────────────────────
  server.tool(
    "threads_reply",
    "Reply to a Threads post or another reply. Text-only replies publish in a single API call by default (auto_publish_text=true); media replies always use the two-step create-then-publish flow.",
    {
      reply_to_id: z.string().describe("Post ID to reply to"),
      text: z.string().max(500).describe("Reply text"),
      image_url: httpsUrl.optional().describe("Optional image HTTPS URL to attach"),
      video_url: httpsUrl.optional().describe("Optional video HTTPS URL to attach"),
      auto_publish: z.boolean().optional().default(true).describe("When true (default) and the reply is text-only (no image_url/video_url), combine container creation and publishing into a single API call via auto_publish_text=true — one HTTP request instead of two, and no risk of the 4279009 'container not propagated yet' race. Ignored for media replies. Set to false to force the legacy two-step flow for text replies."),
    },
    async ({ reply_to_id, text, image_url, video_url, auto_publish }) => {
      try {
        const isTextOnly = !image_url && !video_url;
        let mediaType = "TEXT";
        if (image_url) mediaType = "IMAGE";
        if (video_url) mediaType = "VIDEO";
        const params: Record<string, unknown> = {
          media_type: mediaType,
          text,
          reply_to_id,
        };
        if (image_url) params.image_url = image_url;
        if (video_url) params.video_url = video_url;
        if (isTextOnly && auto_publish) params.auto_publish_text = true;
        const { data: first, rateLimit: firstRate } = await client.threads("POST", `/${client.threadsUserId}/threads`, params);
        if (typeof first.id !== "string") throw new Error("Container creation did not return a valid id");
        if (isTextOnly && auto_publish) {
          return { content: [{ type: "text", text: JSON.stringify({ ...first, _rateLimit: firstRate }, null, 2) }] };
        }
        if (video_url) {
          await waitForThreadsContainer(client, first.id);
        }
        const { data, rateLimit } = await client.threads("POST", `/${client.threadsUserId}/threads_publish`, {
          creation_id: first.id,
        });
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Reply failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // ─── threads_hide_reply ──────────────────────────────────────
  server.tool(
    "threads_hide_reply",
    "Hide a reply on your Threads post. Hidden replies are still visible if directly accessed.",
    {
      reply_id: z.string().describe("Reply ID to hide"),
    },
    async ({ reply_id }) => {
      try {
        const { data, rateLimit } = await client.threads("POST", `/${reply_id}/manage_reply`, { hide: true });
        return { content: [{ type: "text", text: JSON.stringify({ success: true, hidden: true, ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Hide reply failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // ─── threads_unhide_reply ────────────────────────────────────
  server.tool(
    "threads_unhide_reply",
    "Unhide a previously hidden reply on your Threads post.",
    {
      reply_id: z.string().describe("Reply ID to unhide"),
    },
    async ({ reply_id }) => {
      try {
        const { data, rateLimit } = await client.threads("POST", `/${reply_id}/manage_reply`, { hide: false });
        return { content: [{ type: "text", text: JSON.stringify({ success: true, hidden: false, ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Unhide reply failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );
}
