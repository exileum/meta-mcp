import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient, FormParams } from "../../services/meta-client.js";
import { httpsUrl, metaId } from "../../schemas.js";
import { waitForThreadsContainer, IMAGE_PROCESSING_TIMEOUT, VIDEO_PROCESSING_TIMEOUT } from "../../utils/container.js";
import { formatErrorResponse, validationError } from "../../utils/errors.js";

export const topicTagSchema = z.string().min(1).max(50).regex(/^[^.&]+$/, "Topic tags cannot contain periods or ampersands").optional().describe("Topic tag for the post (1-50 chars, no periods or ampersands)");

export const shareToIgStorySchema = z.enum(["light", "dark"]).optional().describe("Cross-share this post to linked Instagram as a Story. 'light' = normal, 'dark' = dark mode. Requires threads_share_to_instagram permission and a linked Instagram account. The Threads post still publishes even if cross-share fails.");

export const pollOptionsSchema = z.array(z.string().min(1).max(25)).min(2).max(4).optional().describe("Poll options (2-4 choices, each 1-25 chars). Creates a poll attachment. Cannot be combined with text_attachment, link_attachment, or gif_id+gif_provider.");

export const textStylingEnum = z.enum(["bold", "italic", "highlight", "underline", "strikethrough"]);

export const textAttachmentStylingSchema = z.array(z.object({
  offset: z.number().int().min(0).describe("Starting character position (0-based, automatically converted to UTF-8 byte offsets for the API)"),
  length: z.number().int().min(1).describe("Number of characters to style (automatically converted to UTF-8 byte length for the API)"),
  styles: z.array(textStylingEnum).min(1).describe("Styles to apply (bold, italic, highlight, underline, strikethrough)"),
})).optional().describe("Text formatting for the text attachment. Ranges must not overlap.");

export const allowlistedCountryCodesSchema = z.array(
  z.string().regex(/^[A-Za-z]{2}$/, "Must be an ISO 3166-1 alpha-2 country code (2 letters)")
).min(1).optional().describe("ISO 3166-1 alpha-2 country codes (e.g., ['US','CA','GB']) restricting post visibility to those countries (geo-gating). Requires the account to be eligible — check `is_eligible_for_geo_gating` via `threads_get_profile`. The creator can always see their own posts regardless. Codes are normalized to uppercase and sent comma-joined (e.g., 'US,CA') as required by the API.");

export const replyControlSchema = z.enum([
  "everyone",
  "accounts_you_follow",
  "mentioned_only",
  "parent_post_author_only",
  "followers_only",
]).optional().describe("Who can reply to this post. One of: 'everyone' (default — anyone can reply), 'accounts_you_follow' (only profiles the author follows), 'mentioned_only' (only profiles @-mentioned in the post), 'parent_post_author_only' (only the author of the post being replied to — applies when this post is itself a reply, not a quote), or 'followers_only' (only the author's followers). See https://developers.facebook.com/docs/threads/reply-management/ for the authoritative list.");

const POLL_OPTION_KEYS = ["option_a", "option_b", "option_c", "option_d"] as const;

function applyShareToIgStory(params: FormParams, share_to_ig_story?: "light" | "dark"): void {
  if (share_to_ig_story) {
    params.crossreshare_to_ig = true;
    if (share_to_ig_story === "dark") params.crossreshare_to_ig_dark_mode = true;
  }
}

function applyAllowlistedCountryCodes(params: FormParams, codes?: string[]): void {
  if (codes?.length) {
    params.allowlisted_country_codes = codes.map(c => c.toUpperCase()).join(",");
  }
}

export function registerThreadsPublishingTools(server: McpServer, client: MetaClient): void {
  // ─── threads_publish_text ────────────────────────────────────
  server.tool(
    "threads_publish_text",
    "Publish a text-only post on Threads. By default publishes in a single API call via auto_publish_text=true (faster and avoids the 4279009 'container not propagated' race condition). Supports optional link attachment, poll, GIF, topic tag, quote post, cross-share to Instagram Stories, geo-gating via allowlisted_country_codes, and text_attachment for long-form content (up to 10,000 chars with optional styling and link). Only one attachment type per post — text_attachment, poll_options, link_attachment, and gif_id+gif_provider are mutually exclusive. Set auto_publish=false to fall back to the legacy two-step create-then-publish flow.",
    {
      text: z.string().max(500).describe("Post text (max 500 chars)"),
      reply_control: replyControlSchema,
      link_attachment: z.string().url().optional().describe("URL to attach as a link preview card (max 5 links per post). Cannot be combined with text_attachment, poll_options, or gif_id+gif_provider."),
      topic_tag: topicTagSchema,
      quote_post_id: z.string().optional().describe("ID of a post to quote"),
      poll_options: pollOptionsSchema,
      gif_id: z.string().min(1).optional().describe("GIPHY GIF ID. Must be provided together with gif_provider — providing only one returns an error."),
      gif_provider: z.enum(["GIPHY"]).optional().describe("GIF provider. Only GIPHY is currently supported. Must be provided together with gif_id — providing only one returns an error."),
      is_spoiler: z.boolean().optional().describe("Mark content as spoiler"),
      share_to_ig_story: shareToIgStorySchema,
      allowlisted_country_codes: allowlistedCountryCodesSchema,
      text_attachment: z.string().min(1).max(10000).optional().describe("Long-form text attachment (max 10,000 chars). Renders as expandable 'Read more' block beneath the primary text. Cannot be combined with poll_options, link_attachment, or gif_id+gif_provider."),
      text_attachment_link: z.string().url().optional().describe("URL to include inside the text attachment card. Requires text_attachment."),
      text_attachment_styling: textAttachmentStylingSchema,
      auto_publish: z.boolean().optional().default(true).describe("When true (default), combine container creation and publishing into a single API call via auto_publish_text=true — one HTTP request instead of two, and no risk of the 4279009 'container not propagated yet' race. Set to false to fall back to the legacy two-step flow (POST /threads, then POST /threads_publish)."),
      alt_text: z.never("alt_text is not supported on text-only Threads posts (media_type=TEXT). Use threads_publish_image, threads_publish_video, or threads_publish_carousel for accessibility labels — those tools accept alt_text on IMAGE/VIDEO/CAROUSEL containers.").optional().describe("Reserved — must be omitted. alt_text is only supported on image, video, and carousel posts; passing it here raises a Zod schema error."),
    },
    async ({ text, reply_control, link_attachment, topic_tag, quote_post_id, poll_options, gif_id, gif_provider, is_spoiler, share_to_ig_story, allowlisted_country_codes, text_attachment, text_attachment_link, text_attachment_styling, auto_publish }) => {
      try {
        // Validate mutual exclusions
        if (text_attachment && poll_options) {
          return validationError("text_attachment cannot be combined with poll_options");
        }
        if (text_attachment && link_attachment) {
          return validationError("text_attachment cannot be combined with link_attachment. Use text_attachment_link instead to include a link inside the text attachment.");
        }
        if (poll_options && link_attachment) {
          return validationError("poll_options cannot be combined with link_attachment");
        }
        if (text_attachment_link && !text_attachment) {
          return validationError("text_attachment_link requires text_attachment");
        }
        if (text_attachment_styling && !text_attachment) {
          return validationError("text_attachment_styling requires text_attachment");
        }
        if (text_attachment_styling) {
          for (const range of text_attachment_styling) {
            if (range.offset + range.length > text_attachment!.length) {
              return validationError(`text_attachment_styling range at offset ${range.offset} with length ${range.length} exceeds text_attachment length (${text_attachment!.length})`);
            }
          }
          if (text_attachment_styling.length > 1) {
            const sorted = [...text_attachment_styling].sort((a, b) => a.offset - b.offset);
            for (let i = 1; i < sorted.length; i++) {
              const prev = sorted[i - 1];
              if (sorted[i].offset < prev.offset + prev.length) {
                return validationError(`text_attachment_styling ranges must not overlap: range at offset ${sorted[i].offset} overlaps with range at offset ${prev.offset}`);
              }
            }
          }
        }
        if ((gif_id && !gif_provider) || (!gif_id && gif_provider)) {
          return validationError("gif_id and gif_provider must be provided together (both or neither). Per the Threads Posts API, gif_attachment requires both the GIF ID and provider.");
        }
        if (gif_id && (text_attachment || poll_options || link_attachment)) {
          return validationError("GIF attachment cannot be combined with text_attachment, poll_options, or link_attachment");
        }

        const params: FormParams = { media_type: "TEXT", text };
        if (reply_control) params.reply_control = reply_control;
        if (link_attachment) params.link_attachment = link_attachment;
        if (topic_tag) params.topic_tag = topic_tag;
        if (quote_post_id) params.quote_post_id = quote_post_id;
        if (poll_options) {
          const pollObj: Record<string, string> = {};
          poll_options.forEach((opt, i) => {
            const key = POLL_OPTION_KEYS[i];
            if (key) pollObj[key] = opt;
          });
          params.poll_attachment = JSON.stringify(pollObj);
        }
        if (gif_id && gif_provider) {
          params.gif_attachment = JSON.stringify({ gif_id, provider: gif_provider });
        }
        if (is_spoiler) params.is_spoiler_media = true;
        if (text_attachment) {
          const obj: Record<string, unknown> = { plaintext: text_attachment };
          if (text_attachment_link) obj.link_attachment_url = text_attachment_link;
          if (text_attachment_styling) {
            // Convert character offsets to UTF-8 byte offsets (API requirement)
            const encoder = new TextEncoder();
            obj.text_with_styling_info = text_attachment_styling.map(s => ({
              offset: encoder.encode(text_attachment.substring(0, s.offset)).length,
              length: encoder.encode(text_attachment.substring(s.offset, s.offset + s.length)).length,
              styling_info: s.styles,
            }));
          }
          params.text_attachment = JSON.stringify(obj);
        }
        applyShareToIgStory(params, share_to_ig_story);
        applyAllowlistedCountryCodes(params, allowlisted_country_codes);
        // Treat `undefined` as the default (true) so the behavior is stable even
        // if a caller bypasses Zod's schema-level default (e.g., direct handler
        // invocation in tests). Only an explicit `false` takes the legacy path.
        const useAutoPublish = auto_publish !== false;
        if (useAutoPublish) params.auto_publish_text = true;
        // `createResponse.id` is the published post id when useAutoPublish is true,
        // and the unpublished container id otherwise.
        const { data: createResponse, rateLimit: createRateLimit } = await client.threads("POST", `/${client.threadsUserId}/threads`, params);
        if (typeof createResponse.id !== "string") throw new Error("Container creation did not return a valid id");
        if (useAutoPublish) {
          return { content: [{ type: "text", text: JSON.stringify({ ...createResponse, _rateLimit: createRateLimit }, null, 2) }] };
        }
        const { data, rateLimit } = await client.threads("POST", `/${client.threadsUserId}/threads_publish`, {
          creation_id: createResponse.id,
        });
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return formatErrorResponse(error, "Publish text");
      }
    }
  );

  // ─── threads_publish_image ───────────────────────────────────
  server.tool(
    "threads_publish_image",
    "Publish an image post on Threads. Supports topic tag, quote post, alt text, spoiler flag, cross-share to Instagram Stories, and geo-gating via allowlisted_country_codes.",
    {
      image_url: httpsUrl.describe("Public HTTPS URL of the image (JPEG/PNG, max 8MB)"),
      text: z.string().max(500).optional().describe("Caption text"),
      reply_control: replyControlSchema,
      topic_tag: topicTagSchema,
      quote_post_id: z.string().optional().describe("ID of a post to quote"),
      alt_text: z.string().max(1000).optional().describe("Alt text for accessibility (max 1000 chars)"),
      is_spoiler: z.boolean().optional().describe("Mark content as spoiler"),
      share_to_ig_story: shareToIgStorySchema,
      allowlisted_country_codes: allowlistedCountryCodesSchema,
    },
    async ({ image_url, text, reply_control, topic_tag, quote_post_id, alt_text, is_spoiler, share_to_ig_story, allowlisted_country_codes }) => {
      try {
        const params: FormParams = { media_type: "IMAGE", image_url };
        if (text) params.text = text;
        if (reply_control) params.reply_control = reply_control;
        if (topic_tag) params.topic_tag = topic_tag;
        if (quote_post_id) params.quote_post_id = quote_post_id;
        if (alt_text) params.alt_text = alt_text;
        if (is_spoiler) params.is_spoiler_media = true;
        applyShareToIgStory(params, share_to_ig_story);
        applyAllowlistedCountryCodes(params, allowlisted_country_codes);
        const { data: container } = await client.threads("POST", `/${client.threadsUserId}/threads`, params);
        if (typeof container.id !== "string") throw new Error("Container creation did not return a valid id");
        const containerId = container.id;
        await waitForThreadsContainer(client, containerId);
        const { data, rateLimit } = await client.threads("POST", `/${client.threadsUserId}/threads_publish`, {
          creation_id: containerId,
        });
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return formatErrorResponse(error, "Publish image");
      }
    }
  );

  // ─── threads_publish_video ───────────────────────────────────
  server.tool(
    "threads_publish_video",
    "Publish a video post on Threads. Waits for video processing. Supports topic tag, quote post, alt text, spoiler flag, cross-share to Instagram Stories, and geo-gating via allowlisted_country_codes. Note: cross-share to IG Stories may silently fail for video posts (the Threads post still publishes).",
    {
      video_url: httpsUrl.describe("Public HTTPS URL of the video (MP4/MOV, max 1GB, up to 5 min)"),
      text: z.string().max(500).optional().describe("Caption text"),
      reply_control: replyControlSchema,
      topic_tag: topicTagSchema,
      quote_post_id: z.string().optional().describe("ID of a post to quote"),
      alt_text: z.string().max(1000).optional().describe("Alt text for accessibility (max 1000 chars)"),
      is_spoiler: z.boolean().optional().describe("Mark content as spoiler"),
      share_to_ig_story: shareToIgStorySchema,
      allowlisted_country_codes: allowlistedCountryCodesSchema,
    },
    async ({ video_url, text, reply_control, topic_tag, quote_post_id, alt_text, is_spoiler, share_to_ig_story, allowlisted_country_codes }) => {
      try {
        const params: FormParams = { media_type: "VIDEO", video_url };
        if (text) params.text = text;
        if (reply_control) params.reply_control = reply_control;
        if (topic_tag) params.topic_tag = topic_tag;
        if (quote_post_id) params.quote_post_id = quote_post_id;
        if (alt_text) params.alt_text = alt_text;
        if (is_spoiler) params.is_spoiler_media = true;
        applyShareToIgStory(params, share_to_ig_story);
        applyAllowlistedCountryCodes(params, allowlisted_country_codes);
        const { data: container } = await client.threads("POST", `/${client.threadsUserId}/threads`, params);
        if (typeof container.id !== "string") throw new Error("Container creation did not return a valid id");
        const containerId = container.id;
        await waitForThreadsContainer(client, containerId, VIDEO_PROCESSING_TIMEOUT);
        const { data, rateLimit } = await client.threads("POST", `/${client.threadsUserId}/threads_publish`, {
          creation_id: containerId,
        });
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return formatErrorResponse(error, "Publish video");
      }
    }
  );

  // ─── threads_publish_carousel ────────────────────────────────
  server.tool(
    "threads_publish_carousel",
    "Publish a carousel post on Threads with 2-20 images/videos. Supports cross-share to Instagram Stories and geo-gating via allowlisted_country_codes (parent container only).",
    {
      items: z.array(z.object({
        type: z.enum(["IMAGE", "VIDEO"]).describe("Media type"),
        url: httpsUrl.describe("Public HTTPS URL"),
        alt_text: z.string().max(1000).optional().describe("Alt text for this item"),
      })).min(2).max(20).describe("Array of media items"),
      text: z.string().max(500).optional().describe("Caption text"),
      reply_control: replyControlSchema,
      topic_tag: topicTagSchema,
      quote_post_id: z.string().optional().describe("ID of a post to quote"),
      share_to_ig_story: shareToIgStorySchema,
      allowlisted_country_codes: allowlistedCountryCodesSchema,
    },
    async ({ items, text, reply_control, topic_tag, quote_post_id, share_to_ig_story, allowlisted_country_codes }) => {
      try {
        const childIds: string[] = [];
        for (const item of items) {
          const params: FormParams = { media_type: item.type, is_carousel_item: true };
          if (item.type === "IMAGE") {
            params.image_url = item.url;
          } else {
            params.video_url = item.url;
          }
          if (item.alt_text) params.alt_text = item.alt_text;
          const { data: child } = await client.threads("POST", `/${client.threadsUserId}/threads`, params);
          if (typeof child.id !== "string") throw new Error("Container creation did not return a valid id");
          const childId = child.id;
          await waitForThreadsContainer(client, childId, item.type === "VIDEO" ? VIDEO_PROCESSING_TIMEOUT : IMAGE_PROCESSING_TIMEOUT);
          childIds.push(childId);
        }
        const carouselParams: FormParams = {
          media_type: "CAROUSEL",
          children: childIds.join(","),
        };
        if (text) carouselParams.text = text;
        if (reply_control) carouselParams.reply_control = reply_control;
        if (topic_tag) carouselParams.topic_tag = topic_tag;
        if (quote_post_id) carouselParams.quote_post_id = quote_post_id;
        applyShareToIgStory(carouselParams, share_to_ig_story);
        applyAllowlistedCountryCodes(carouselParams, allowlisted_country_codes);
        const { data: carousel } = await client.threads("POST", `/${client.threadsUserId}/threads`, carouselParams);
        if (typeof carousel.id !== "string") throw new Error("Container creation did not return a valid id");
        const carouselId = carousel.id;
        await waitForThreadsContainer(client, carouselId);
        const { data, rateLimit } = await client.threads("POST", `/${client.threadsUserId}/threads_publish`, {
          creation_id: carouselId,
        });
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return formatErrorResponse(error, "Publish carousel");
      }
    }
  );

  // ─── threads_delete_post ──────────────────────────────────────
  server.tool(
    "threads_delete_post",
    "Delete a Threads post. This action is irreversible. Rate limited to 100 deletions per 24 hours.",
    {
      post_id: metaId.describe("Threads post ID to delete"),
    },
    async ({ post_id }) => {
      try {
        const { data, rateLimit } = await client.threads("DELETE", `/${post_id}`);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return formatErrorResponse(error, "Delete post");
      }
    }
  );

  // ─── threads_get_container_status ────────────────────────────
  server.tool(
    "threads_get_container_status",
    "Check the processing status of a Threads media container. Only works with unpublished container IDs (returned from container creation endpoints) — not with published post IDs.",
    {
      container_id: metaId.describe("Unpublished container ID to check (from container creation, not a published post ID)"),
    },
    async ({ container_id }) => {
      try {
        const { data, rateLimit } = await client.threads("GET", `/${container_id}`, {
          fields: "id,status,error_message",
        });
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("nonexisting field")) {
          return validationError("This ID appears to be a published post, not an unpublished container. The status and error_message fields are only available on unpublished media containers (returned from container creation endpoints before calling threads_publish).");
        }
        return formatErrorResponse(error, "Get container status");
      }
    }
  );

  // ─── threads_get_publishing_limit ────────────────────────────
  server.tool(
    "threads_get_publishing_limit",
    "Check how many posts you can still publish within the current 24-hour window (max 250 posts/day).",
    {},
    async () => {
      try {
        const { data, rateLimit } = await client.threads("GET", `/${client.threadsUserId}/threads_publishing_limit`, {
          fields: "quota_usage,config",
        });
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return formatErrorResponse(error, "Get publishing limit");
      }
    }
  );

  // ─── threads_repost ──────────────────────────────────────────
  server.tool(
    "threads_repost",
    "Repost an existing Threads post to your own profile. Reposts appear under the Reposts tab on your profile. Requires the threads_content_publish permission. Note: this is a simple repost — for quote-reposts use threads_publish_text with quote_post_id.",
    {
      post_id: metaId.describe("Threads post ID to repost"),
    },
    async ({ post_id }) => {
      try {
        const { data, rateLimit } = await client.threads("POST", `/${post_id}/repost`, {});
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return formatErrorResponse(error, "Repost");
      }
    }
  );
}
