import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient, FormParams } from "../../services/meta-client.js";
import { httpsUrl, metaId } from "../../schemas.js";
import { waitForThreadsContainer, IMAGE_PROCESSING_TIMEOUT, VIDEO_PROCESSING_TIMEOUT } from "../../utils/container.js";
import { formatErrorResponse, validationError } from "../../utils/errors.js";
import { formatResponse } from "../../utils/response.js";
import { buildParams } from "../../utils/params.js";
import { makeProgressNotifier, ProgressExtra } from "../../utils/progress.js";
import { READ_ONLY_TOOL, DESTRUCTIVE_TOOL, WRITE_TOOL } from "../annotations.js";
import { THREADS_PROFILE_CACHE_PREFIX } from "./profile.js";

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
  server.registerTool(
    "threads_publish_text",
    {
      description: "Publish a text-only post on Threads. By default publishes in a single API call via auto_publish_text=true (faster and avoids the 4279009 'container not propagated' race condition). Supports optional link attachment, poll, GIF, topic tag, quote post, cross-share to Instagram Stories, geo-gating via allowlisted_country_codes, location tagging via location_id, and text_attachment for long-form content (up to 10,000 chars with optional styling and link). Only one attachment type per post — text_attachment, poll_options, link_attachment, and gif_id+gif_provider are mutually exclusive. Set auto_publish=false to fall back to the legacy two-step create-then-publish flow.",
      inputSchema: {
        text: z.string().max(500).describe("Post text (max 500 chars)"),
        reply_control: replyControlSchema,
        link_attachment: z.string().url().optional().describe("URL to attach as a link preview card (max 5 links per post). Cannot be combined with text_attachment, poll_options, or gif_id+gif_provider."),
        topic_tag: topicTagSchema,
        quote_post_id: z.string().optional().describe("ID of a post to quote"),
        poll_options: pollOptionsSchema,
        gif_id: z.string().min(1).optional().describe("GIPHY GIF ID. Must be provided together with gif_provider — providing only one returns an error."),
        gif_provider: z.enum(["GIPHY"]).optional().describe("GIF provider. Only GIPHY is currently supported. Must be provided together with gif_id — providing only one returns an error."),
        is_spoiler: z.never("is_spoiler is not supported on text-only Threads posts (media_type=TEXT). Per Meta's docs, media spoilers only apply to IMAGE, VIDEO, or CAROUSEL posts (https://developers.facebook.com/docs/threads/create-posts/spoilers/); text-only spoilers use the text_entities API, which this tool does not expose. Use threads_publish_image or threads_publish_video to mark media as a spoiler.").optional().describe("Reserved — must be omitted. Spoilers only apply to image and video posts; passing it here raises a Zod schema error."),
        share_to_ig_story: shareToIgStorySchema,
        allowlisted_country_codes: allowlistedCountryCodesSchema,
        location_id: z.string().optional().describe("Location ID for tagging the post. Use threads_search_locations to find IDs. Requires the threads_location_tagging permission on the access token."),
        text_attachment: z.string().min(1).max(10000).optional().describe("Long-form text attachment (max 10,000 chars). Renders as expandable 'Read more' block beneath the primary text. Cannot be combined with poll_options, link_attachment, or gif_id+gif_provider."),
        text_attachment_link: z.string().url().optional().describe("URL to include inside the text attachment card. Requires text_attachment."),
        text_attachment_styling: textAttachmentStylingSchema,
        auto_publish: z.boolean().optional().default(true).describe("When true (default), combine container creation and publishing into a single API call via auto_publish_text=true — one HTTP request instead of two, and no risk of the 4279009 'container not propagated yet' race. Set to false to fall back to the legacy two-step flow (POST /threads, then POST /threads_publish)."),
        alt_text: z.never("alt_text is not supported on text-only Threads posts (media_type=TEXT). Use threads_publish_image, threads_publish_video, or threads_publish_carousel for accessibility labels — those tools accept alt_text on IMAGE/VIDEO/CAROUSEL containers.").optional().describe("Reserved — must be omitted. alt_text is only supported on image, video, and carousel posts; passing it here raises a Zod schema error."),
      },
      annotations: WRITE_TOOL,
    },
    async ({ text, reply_control, link_attachment, topic_tag, quote_post_id, poll_options, gif_id, gif_provider, share_to_ig_story, allowlisted_country_codes, location_id, text_attachment, text_attachment_link, text_attachment_styling, auto_publish }) => {
      let step = "container creation";
      let containerId: string | undefined;
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
              const prev = sorted[i - 1]!;
              const curr = sorted[i]!;
              if (curr.offset < prev.offset + prev.length) {
                return validationError(`text_attachment_styling ranges must not overlap: range at offset ${curr.offset} overlaps with range at offset ${prev.offset}`);
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

        let pollAttachment: string | undefined;
        if (poll_options) {
          const pollObj: Record<string, string> = {};
          poll_options.forEach((opt, i) => {
            const key = POLL_OPTION_KEYS[i];
            if (key) pollObj[key] = opt;
          });
          pollAttachment = JSON.stringify(pollObj);
        }
        const gifAttachment = gif_id && gif_provider
          ? JSON.stringify({ gif_id, provider: gif_provider })
          : undefined;
        let textAttachmentJson: string | undefined;
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
          textAttachmentJson = JSON.stringify(obj);
        }
        // Treat `undefined` as the default (true) so the behavior is stable even
        // if a caller bypasses Zod's schema-level default (e.g., direct handler
        // invocation in tests). Only an explicit `false` takes the legacy path.
        const useAutoPublish = auto_publish !== false;
        const params = buildParams(
          { media_type: "TEXT", text },
          {
            reply_control,
            link_attachment,
            topic_tag,
            quote_post_id,
            poll_attachment: pollAttachment,
            gif_attachment: gifAttachment,
            text_attachment: textAttachmentJson,
            location_id,
            auto_publish_text: useAutoPublish ? true : undefined,
          }
        );
        applyShareToIgStory(params, share_to_ig_story);
        applyAllowlistedCountryCodes(params, allowlisted_country_codes);
        // `createResponse.id` is the published post id when useAutoPublish is true,
        // and the unpublished container id otherwise.
        const { data: createResponse, rateLimit: createRateLimit } = await client.threads("POST", `/${client.threadsUserId}/threads`, params);
        if (typeof createResponse.id !== "string") throw new Error("Container creation did not return a valid id");
        if (useAutoPublish) {
          client.invalidateCache(THREADS_PROFILE_CACHE_PREFIX);
          return formatResponse(createResponse, createRateLimit);
        }
        containerId = createResponse.id;
        step = "publishing";
        const { data, rateLimit } = await client.threads("POST", `/${client.threadsUserId}/threads_publish`, {
          creation_id: containerId,
        });
        client.invalidateCache(THREADS_PROFILE_CACHE_PREFIX);
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Publish text", { step, containerId });
      }
    }
  );

  // ─── threads_publish_image ───────────────────────────────────
  server.registerTool(
    "threads_publish_image",
    {
      description: "Publish an image post on Threads. Supports topic tag, quote post, alt text, spoiler flag, cross-share to Instagram Stories, geo-gating via allowlisted_country_codes, and location tagging via location_id.",
      inputSchema: {
        image_url: httpsUrl.describe("Public HTTPS URL of the image (JPEG/PNG, max 8MB)"),
        text: z.string().max(500).optional().describe("Caption text"),
        reply_control: replyControlSchema,
        topic_tag: topicTagSchema,
        quote_post_id: z.string().optional().describe("ID of a post to quote"),
        alt_text: z.string().max(1000).optional().describe("Alt text for accessibility (max 1000 chars)"),
        is_spoiler: z.boolean().optional().describe("Mark content as spoiler"),
        share_to_ig_story: shareToIgStorySchema,
        allowlisted_country_codes: allowlistedCountryCodesSchema,
        location_id: z.string().optional().describe("Location ID for tagging the post. Use threads_search_locations to find IDs. Requires the threads_location_tagging permission on the access token."),
      },
      annotations: WRITE_TOOL,
    },
    async ({ image_url, text, reply_control, topic_tag, quote_post_id, alt_text, is_spoiler, share_to_ig_story, allowlisted_country_codes, location_id }, extra?: ProgressExtra) => {
      let step = "container creation";
      let containerId: string | undefined;
      try {
        const params = buildParams(
          { media_type: "IMAGE", image_url },
          {
            text,
            reply_control,
            topic_tag,
            quote_post_id,
            alt_text,
            is_spoiler_media: is_spoiler ? true : undefined,
            location_id,
          }
        );
        applyShareToIgStory(params, share_to_ig_story);
        applyAllowlistedCountryCodes(params, allowlisted_country_codes);
        const { data: container } = await client.threads("POST", `/${client.threadsUserId}/threads`, params);
        if (typeof container.id !== "string") throw new Error("Container creation did not return a valid id");
        containerId = container.id;
        step = "processing";
        await waitForThreadsContainer(client, containerId, IMAGE_PROCESSING_TIMEOUT, { onProgress: makeProgressNotifier(extra) });
        step = "publishing";
        const { data, rateLimit } = await client.threads("POST", `/${client.threadsUserId}/threads_publish`, {
          creation_id: containerId,
        });
        client.invalidateCache(THREADS_PROFILE_CACHE_PREFIX);
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Publish image", { step, containerId });
      }
    }
  );

  // ─── threads_publish_video ───────────────────────────────────
  server.registerTool(
    "threads_publish_video",
    {
      description: "Publish a video post on Threads. Waits for video processing. Supports topic tag, quote post, alt text, spoiler flag, cross-share to Instagram Stories, geo-gating via allowlisted_country_codes, and location tagging via location_id. Note: cross-share to IG Stories may silently fail for video posts (the Threads post still publishes).",
      inputSchema: {
        video_url: httpsUrl.describe("Public HTTPS URL of the video (MP4/MOV, max 1GB, up to 5 min)"),
        text: z.string().max(500).optional().describe("Caption text"),
        reply_control: replyControlSchema,
        topic_tag: topicTagSchema,
        quote_post_id: z.string().optional().describe("ID of a post to quote"),
        alt_text: z.string().max(1000).optional().describe("Alt text for accessibility (max 1000 chars)"),
        is_spoiler: z.boolean().optional().describe("Mark content as spoiler"),
        share_to_ig_story: shareToIgStorySchema,
        allowlisted_country_codes: allowlistedCountryCodesSchema,
        location_id: z.string().optional().describe("Location ID for tagging the post. Use threads_search_locations to find IDs. Requires the threads_location_tagging permission on the access token."),
      },
      annotations: WRITE_TOOL,
    },
    async ({ video_url, text, reply_control, topic_tag, quote_post_id, alt_text, is_spoiler, share_to_ig_story, allowlisted_country_codes, location_id }, extra?: ProgressExtra) => {
      let step = "container creation";
      let containerId: string | undefined;
      try {
        const params = buildParams(
          { media_type: "VIDEO", video_url },
          {
            text,
            reply_control,
            topic_tag,
            quote_post_id,
            alt_text,
            is_spoiler_media: is_spoiler ? true : undefined,
            location_id,
          }
        );
        applyShareToIgStory(params, share_to_ig_story);
        applyAllowlistedCountryCodes(params, allowlisted_country_codes);
        const { data: container } = await client.threads("POST", `/${client.threadsUserId}/threads`, params);
        if (typeof container.id !== "string") throw new Error("Container creation did not return a valid id");
        containerId = container.id;
        step = "processing";
        await waitForThreadsContainer(client, containerId, VIDEO_PROCESSING_TIMEOUT, { onProgress: makeProgressNotifier(extra) });
        step = "publishing";
        const { data, rateLimit } = await client.threads("POST", `/${client.threadsUserId}/threads_publish`, {
          creation_id: containerId,
        });
        client.invalidateCache(THREADS_PROFILE_CACHE_PREFIX);
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Publish video", { step, containerId });
      }
    }
  );

  // ─── threads_publish_carousel ────────────────────────────────
  server.registerTool(
    "threads_publish_carousel",
    {
      description: "Publish a carousel post on Threads with 2-20 images/videos. Supports cross-share to Instagram Stories, geo-gating via allowlisted_country_codes, and location tagging via location_id (parent container only).",
      inputSchema: {
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
        location_id: z.string().optional().describe("Location ID for tagging the post. Use threads_search_locations to find IDs. Requires the threads_location_tagging permission on the access token."),
      },
      annotations: WRITE_TOOL,
    },
    async ({ items, text, reply_control, topic_tag, quote_post_id, share_to_ig_story, allowlisted_country_codes, location_id }, extra?: ProgressExtra) => {
      // See ig_publish_carousel — shared notifier keeps progress monotonic
      // across parallel child polls.
      const onProgress = makeProgressNotifier(extra, "shared");
      let step = "child container creation";
      let containerId: string | undefined;
      // Promise.all rejects with the first child to throw; JS is single-threaded,
      // so the first catch wins the `=== undefined` race here.
      let firstFailingChildStep: string | undefined;
      let firstFailingChildId: string | undefined;
      try {
        // Children are independent — create them in parallel. Errors propagate
        // unwrapped so formatErrorResponse keeps MetaApiError categorization.
        const childIds = await Promise.all(items.map(async (item) => {
          let myStep = "child container creation";
          let myContainerId: string | undefined;
          try {
            const params = buildParams(
              { media_type: item.type, is_carousel_item: true },
              {
                image_url: item.type === "IMAGE" ? item.url : undefined,
                video_url: item.type === "VIDEO" ? item.url : undefined,
                alt_text: item.alt_text,
              }
            );
            const { data: child } = await client.threads("POST", `/${client.threadsUserId}/threads`, params);
            if (typeof child.id !== "string") throw new Error("Container creation did not return a valid id");
            myContainerId = child.id;
            myStep = "child processing";
            await waitForThreadsContainer(client, myContainerId, item.type === "VIDEO" ? VIDEO_PROCESSING_TIMEOUT : IMAGE_PROCESSING_TIMEOUT, { onProgress });
            return myContainerId;
          } catch (e) {
            if (firstFailingChildStep === undefined) {
              firstFailingChildStep = myStep;
              firstFailingChildId = myContainerId;
            }
            throw e;
          }
        }));
        step = "parent container creation";
        const carouselParams = buildParams(
          { media_type: "CAROUSEL", children: childIds.join(",") },
          { text, reply_control, topic_tag, quote_post_id, location_id }
        );
        applyShareToIgStory(carouselParams, share_to_ig_story);
        applyAllowlistedCountryCodes(carouselParams, allowlisted_country_codes);
        const { data: carousel } = await client.threads("POST", `/${client.threadsUserId}/threads`, carouselParams);
        if (typeof carousel.id !== "string") throw new Error("Container creation did not return a valid id");
        containerId = carousel.id;
        step = "parent processing";
        await waitForThreadsContainer(client, containerId, IMAGE_PROCESSING_TIMEOUT, { onProgress });
        step = "publishing";
        const { data, rateLimit } = await client.threads("POST", `/${client.threadsUserId}/threads_publish`, {
          creation_id: containerId,
        });
        client.invalidateCache(THREADS_PROFILE_CACHE_PREFIX);
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Publish carousel", {
          step: firstFailingChildStep ?? step,
          containerId: firstFailingChildId ?? containerId,
        });
      } finally {
        // Sibling polls still in-flight after a Promise.all rejection must
        // not keep emitting progress for the now-completed request.
        onProgress?.stop();
      }
    }
  );

  // ─── threads_delete_post ──────────────────────────────────────
  server.registerTool(
    "threads_delete_post",
    {
      description: "Delete a Threads post. This action is irreversible. Rate limited to 100 deletions per 24 hours.",
      inputSchema: {
        post_id: metaId.describe("Threads post ID to delete"),
      },
      annotations: DESTRUCTIVE_TOOL,
    },
    async ({ post_id }) => {
      try {
        const { data, rateLimit } = await client.threads("DELETE", `/${post_id}`);
        client.invalidateCache(THREADS_PROFILE_CACHE_PREFIX);
        return formatResponse({ success: true, ...data }, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Delete post");
      }
    }
  );

  // ─── threads_get_container_status ────────────────────────────
  server.registerTool(
    "threads_get_container_status",
    {
      description: "Check the processing status of a Threads media container. Only works with unpublished container IDs (returned from container creation endpoints) — not with published post IDs.",
      inputSchema: {
        container_id: metaId.describe("Unpublished container ID to check (from container creation, not a published post ID)"),
      },
      annotations: READ_ONLY_TOOL,
    },
    async ({ container_id }) => {
      try {
        const { data, rateLimit } = await client.threads("GET", `/${container_id}`, {
          fields: "id,status,error_message",
        });
        return formatResponse(data, rateLimit);
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
  server.registerTool(
    "threads_get_publishing_limit",
    {
      description: "Check how many posts you can still publish within the current 24-hour window (max 250 posts/day).",
      inputSchema: {},
      annotations: READ_ONLY_TOOL,
    },
    async () => {
      try {
        const { data, rateLimit } = await client.threads("GET", `/${client.threadsUserId}/threads_publishing_limit`, {
          fields: "quota_usage,config",
        });
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Get publishing limit");
      }
    }
  );

  // ─── threads_repost ──────────────────────────────────────────
  server.registerTool(
    "threads_repost",
    {
      description: "Repost an existing Threads post to your own profile. Reposts appear under the Reposts tab on your profile. Requires the threads_content_publish permission. Note: this is a simple repost — for quote-reposts use threads_publish_text with quote_post_id.",
      inputSchema: {
        post_id: metaId.describe("Threads post ID to repost"),
      },
      annotations: WRITE_TOOL,
    },
    async ({ post_id }) => {
      try {
        const { data, rateLimit } = await client.threads("POST", `/${post_id}/repost`, {});
        client.invalidateCache(THREADS_PROFILE_CACHE_PREFIX);
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Repost");
      }
    }
  );

  // ─── threads_search_locations ────────────────────────────────
  server.registerTool(
    "threads_search_locations",
    {
      description: "Search Threads-supported locations by keyword or coordinates. Returns a list of location objects (id, name, address, city, country, latitude, longitude, postal_code) whose id can be passed as location_id to the four threads_publish_* tools to tag a post. Either q or both latitude+longitude must be provided. Requires the threads_location_tagging permission; without app approval, the endpoint restricts results to the literal query 'Menlo Park' for testing.",
      inputSchema: {
        q: z.string().min(1).optional().describe("Search query (e.g., 'Menlo Park'). Either q or both latitude+longitude must be provided. If your app does not yet have the threads_location_tagging permission, the API restricts results to the literal query 'Menlo Park' for testing."),
        latitude: z.number().min(-90).max(90).optional().describe("Latitude in decimal degrees (-90..90). Must be provided together with longitude."),
        longitude: z.number().min(-180).max(180).optional().describe("Longitude in decimal degrees (-180..180). Must be provided together with latitude."),
      },
      annotations: READ_ONLY_TOOL,
    },
    async ({ q, latitude, longitude }) => {
      try {
        const hasLat = latitude !== undefined;
        const hasLng = longitude !== undefined;
        const hasCoords = hasLat || hasLng;
        if (q === undefined && !hasCoords) {
          return validationError("threads_search_locations requires either q or both latitude and longitude.");
        }
        if (q !== undefined && hasCoords) {
          return validationError("threads_search_locations accepts either q or latitude+longitude, not both.");
        }
        if (hasCoords && !(hasLat && hasLng)) {
          return validationError("threads_search_locations requires both latitude and longitude when searching by coordinates.");
        }
        const params = buildParams({}, { q, latitude, longitude });
        const { data, rateLimit } = await client.threads("GET", "/location_search", params);
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Search locations");
      }
    }
  );
}
