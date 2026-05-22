import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { httpsUrl, metaId } from "../../schemas.js";
import { waitForThreadsContainer, IMAGE_PROCESSING_TIMEOUT, VIDEO_PROCESSING_TIMEOUT } from "../../utils/container.js";
import { formatErrorResponse, validationError } from "../../utils/errors.js";
import { formatResponse } from "../../utils/response.js";
import { buildParams } from "../../utils/params.js";
import { READ_ONLY_TOOL, WRITE_TOOL, WRITE_IDEMPOTENT_TOOL } from "../annotations.js";

const REPLIES_BASE_FIELDS = "id,text,username,permalink,timestamp,media_type,media_url,has_replies,hide_status,root_post,replied_to,is_reply,is_quote_post";

// is_verified / profile_picture_url are documented as "Only available on direct
// replies." Populated for /{post}/replies (top_level), but undefined for nested
// entries returned by /{post}/conversation (full_tree) — keep them in the
// top_level default and drop from full_tree to avoid misleading sparse payloads.
export const REPLIES_TOP_LEVEL_DEFAULT_FIELDS = `${REPLIES_BASE_FIELDS},is_verified,profile_picture_url`;
export const REPLIES_FULL_TREE_DEFAULT_FIELDS = REPLIES_BASE_FIELDS;

export function registerThreadsReplyTools(server: McpServer, client: MetaClient): void {
  // ─── threads_get_replies ─────────────────────────────────────
  server.registerTool(
    "threads_get_replies",
    {
      description: "Get replies for a specific Threads post. By default returns only top-level replies (mode='top_level', endpoint /{post}/replies). Set mode='full_tree' to get the entire conversation flattened — every reply at every nesting level (endpoint /{post}/conversation). Both modes share the same response shape; full_tree additionally populates root_post, replied_to, is_reply so the caller can reconstruct the tree. The default fields differ by mode: top_level requests is_verified and profile_picture_url (always populated for direct replies); full_tree drops them since they are 'Only available on direct replies' per the Threads Replies/Conversations docs and would be undefined for every nested entry. Pass an explicit fields override to re-request them in full_tree if needed.",
      inputSchema: {
        post_id: metaId.describe("Threads post ID to get replies for"),
        mode: z.enum(["top_level", "full_tree"]).optional().describe("'top_level' (default) returns only direct replies; 'full_tree' returns the full conversation tree flattened"),
        reverse: z.boolean().optional().describe("Reverse chronological order"),
        limit: z.number().optional().describe("Number of replies"),
        after: z.string().optional().describe("Pagination cursor"),
        fields: z.string().min(1).optional().describe("Comma-separated fields override. Default depends on mode: top_level adds is_verified,profile_picture_url, full_tree omits them because they are 'Only available on direct replies' per the Threads Replies/Conversations docs."),
      },
      annotations: READ_ONLY_TOOL,
    },
    async ({ post_id, mode, reverse, limit, after, fields }) => {
      try {
        const defaultFields = mode === "full_tree"
          ? REPLIES_FULL_TREE_DEFAULT_FIELDS
          : REPLIES_TOP_LEVEL_DEFAULT_FIELDS;
        const params = buildParams(
          { fields: fields || defaultFields },
          { reverse, limit, after }
        );
        const edge = mode === "full_tree" ? "conversation" : "replies";
        const { data, rateLimit } = await client.threads("GET", `/${post_id}/${edge}`, params);
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Get replies");
      }
    }
  );

  // ─── threads_reply ───────────────────────────────────────────
  server.registerTool(
    "threads_reply",
    {
      description: "Reply to a Threads post or another reply. Text-only replies publish in a single API call by default (auto_publish_text=true); media replies always use the two-step create-then-publish flow. image_url and video_url are mutually exclusive — provide at most one.",
      inputSchema: {
        reply_to_id: z.string().describe("Post ID to reply to"),
        text: z.string().max(500).describe("Reply text"),
        image_url: httpsUrl.optional().describe("Optional image HTTPS URL to attach. Mutually exclusive with video_url."),
        video_url: httpsUrl.optional().describe("Optional video HTTPS URL to attach. Mutually exclusive with image_url."),
        auto_publish: z.boolean().optional().default(true).describe("When true (default) and the reply is text-only (no image_url/video_url), combine container creation and publishing into a single API call via auto_publish_text=true — one HTTP request instead of two, and no risk of the 4279009 'container not propagated yet' race. Ignored for media replies. Set to false to force the legacy two-step flow for text replies."),
      },
      annotations: WRITE_TOOL,
    },
    async ({ reply_to_id, text, image_url, video_url, auto_publish }) => {
      let step = "container creation";
      let containerId: string | undefined;
      try {
        if (image_url && video_url) {
          return validationError("image_url and video_url cannot be combined on a single reply");
        }
        let mediaType = "TEXT";
        if (image_url) mediaType = "IMAGE";
        if (video_url) mediaType = "VIDEO";
        const isTextOnly = mediaType === "TEXT";
        // Treat `undefined` as the default (true) so the behavior is stable even
        // if a caller bypasses Zod's schema-level default. Only an explicit `false`
        // forces the legacy two-step flow for text replies.
        const useAutoPublish = isTextOnly && auto_publish !== false;
        const params = buildParams(
          { media_type: mediaType, text, reply_to_id },
          {
            image_url,
            video_url,
            auto_publish_text: useAutoPublish ? true : undefined,
          }
        );
        // `createResponse.id` is the published post id when useAutoPublish is true,
        // and the unpublished container id otherwise.
        const { data: createResponse, rateLimit: createRateLimit } = await client.threads("POST", `/${client.threadsUserId}/threads`, params);
        if (typeof createResponse.id !== "string") throw new Error("Container creation did not return a valid id");
        if (useAutoPublish) {
          return formatResponse(createResponse, createRateLimit);
        }
        containerId = createResponse.id;
        if (image_url || video_url) {
          step = "processing";
          await waitForThreadsContainer(
            client,
            containerId,
            video_url ? VIDEO_PROCESSING_TIMEOUT : IMAGE_PROCESSING_TIMEOUT
          );
        }
        step = "publishing";
        const { data, rateLimit } = await client.threads("POST", `/${client.threadsUserId}/threads_publish`, {
          creation_id: containerId,
        });
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Reply", { step, containerId });
      }
    }
  );

  // ─── threads_hide_reply ──────────────────────────────────────
  server.registerTool(
    "threads_hide_reply",
    {
      description: "Hide a reply on your Threads post. Hidden replies are still visible if directly accessed.",
      inputSchema: {
        reply_id: metaId.describe("Reply ID to hide"),
      },
      annotations: WRITE_IDEMPOTENT_TOOL,
    },
    async ({ reply_id }) => {
      try {
        const { data, rateLimit } = await client.threads("POST", `/${reply_id}/manage_reply`, { hide: true });
        return formatResponse({ success: true, hidden: true, ...data }, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Hide reply");
      }
    }
  );

  // ─── threads_unhide_reply ────────────────────────────────────
  server.registerTool(
    "threads_unhide_reply",
    {
      description: "Unhide a previously hidden reply on your Threads post.",
      inputSchema: {
        reply_id: metaId.describe("Reply ID to unhide"),
      },
      annotations: WRITE_IDEMPOTENT_TOOL,
    },
    async ({ reply_id }) => {
      try {
        const { data, rateLimit } = await client.threads("POST", `/${reply_id}/manage_reply`, { hide: false });
        return formatResponse({ success: true, hidden: false, ...data }, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Unhide reply");
      }
    }
  );
}
