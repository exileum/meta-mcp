import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient, FormParams } from "../../services/meta-client.js";
import { httpsUrl, metaId } from "../../schemas.js";
import { waitForIgContainer, IMAGE_PROCESSING_TIMEOUT, VIDEO_PROCESSING_TIMEOUT } from "../../utils/container.js";
import { formatErrorResponse } from "../../utils/errors.js";

const collaboratorUsername = z
  .string()
  .trim()
  .transform((v) => v.replace(/^@+/, ""))
  .refine((v) => v.length > 0, {
    message: "Collaborator username cannot be empty, only whitespace, or only '@' characters",
  });

export const collaboratorsSchema = z
  .array(collaboratorUsername)
  .min(1, "Collaborators array must have at least 1 entry when provided")
  .max(3, "Maximum 3 collaborators per post (Instagram API limit)")
  .refine((arr) => new Set(arr).size === arr.length, {
    message: "Collaborator usernames must be unique",
  })
  .optional()
  .describe(
    "Optional. Up to 3 unique Instagram usernames to invite as collaborators. Per Instagram Graph API: supported for Feed image, Reels, and Carousels — not supported for Stories. Leading '@' characters and surrounding whitespace are auto-stripped before the uniqueness check."
  );

export function registerIgPublishingTools(server: McpServer, client: MetaClient): void {
  // ─── ig_publish_photo ────────────────────────────────────────
  server.tool(
    "ig_publish_photo",
    "Publish a photo to Instagram. Two-step process: creates container then publishes. Requires image_url (publicly accessible HTTPS URL).",
    {
      image_url: httpsUrl.describe("Public HTTPS URL of the image (JPEG only)"),
      caption: z.string().optional().describe("Post caption (max 2200 chars)"),
      location_id: z.string().optional().describe("Facebook Page location ID"),
      user_tags: z.string().optional().describe("JSON array of user tags: [{username, x, y}]"),
      alt_text: z.string().optional().describe("Alt text for accessibility"),
      collaborators: collaboratorsSchema,
    },
    async ({ image_url, caption, location_id, user_tags, alt_text, collaborators }) => {
      try {
        const params: FormParams = { image_url };
        if (caption) params.caption = caption;
        if (location_id) params.location_id = location_id;
        if (user_tags) params.user_tags = user_tags;
        if (alt_text) params.alt_text = alt_text;
        if (collaborators?.length) params.collaborators = JSON.stringify(collaborators);
        // Step 1: Create container
        const { data: container } = await client.ig("POST", `/${client.igUserId}/media`, params);
        if (typeof container.id !== "string") throw new Error("Container creation did not return a valid id");
        const containerId = container.id;
        // Step 2: Wait for container to be ready
        await waitForIgContainer(client, containerId);
        // Step 3: Publish
        const { data, rateLimit } = await client.ig("POST", `/${client.igUserId}/media_publish`, {
          creation_id: containerId,
        });
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return formatErrorResponse(error, "Publish photo");
      }
    }
  );

  // ─── ig_publish_video ────────────────────────────────────────
  server.tool(
    "ig_publish_video",
    "[DEPRECATED] Use ig_publish_reel instead. Publishes via media_type=REELS under the hood; the legacy VIDEO media_type was deprecated by Meta on Nov 9, 2023. Kept for backward compatibility — new integrations should use ig_publish_reel which exposes Reels-specific options (cover_url, share_to_feed, alt_text).",
    {
      video_url: httpsUrl.describe("Public HTTPS URL of the video"),
      caption: z.string().optional().describe("Post caption"),
      thumb_offset: z.number().optional().describe("Thumbnail offset in ms"),
      location_id: z.string().optional().describe("Facebook Page location ID"),
      collaborators: collaboratorsSchema,
    },
    async ({ video_url, caption, thumb_offset, location_id, collaborators }) => {
      try {
        // share_to_feed: true preserves the legacy feed placement of the deprecated
        // VIDEO media_type — without it, REELS containers default to the Reels tab only.
        const params: FormParams = { video_url, media_type: "REELS", share_to_feed: true };
        if (caption) params.caption = caption;
        if (thumb_offset !== undefined) params.thumb_offset = thumb_offset;
        if (location_id) params.location_id = location_id;
        if (collaborators?.length) params.collaborators = JSON.stringify(collaborators);
        const { data: container } = await client.ig("POST", `/${client.igUserId}/media`, params);
        if (typeof container.id !== "string") throw new Error("Container creation did not return a valid id");
        const containerId = container.id;
        await waitForIgContainer(client, containerId, VIDEO_PROCESSING_TIMEOUT);
        const { data, rateLimit } = await client.ig("POST", `/${client.igUserId}/media_publish`, {
          creation_id: containerId,
        });
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return formatErrorResponse(error, "Publish video");
      }
    }
  );

  // ─── ig_publish_carousel ─────────────────────────────────────
  server.tool(
    "ig_publish_carousel",
    "Publish a carousel (album) post with 2-10 images/videos. Each item needs a `url` (JPEG image or MP4 video) and a `type` (IMAGE or VIDEO).",
    {
      items: z.array(z.discriminatedUnion("type", [
        z.object({
          type: z.literal("IMAGE"),
          url: httpsUrl.describe("Public HTTPS URL of the image (JPEG only)"),
          alt_text: z.string().optional().describe("Alt text for accessibility (IMAGE items only)"),
        }),
        z.object({
          type: z.literal("VIDEO"),
          url: httpsUrl.describe("Public HTTPS URL of the video"),
        }),
      ])).min(2).max(10).describe("Array of media items"),
      caption: z.string().optional().describe("Post caption"),
      location_id: z.string().optional().describe("Facebook Page location ID"),
      collaborators: collaboratorsSchema,
    },
    async ({ items, caption, location_id, collaborators }) => {
      try {
        // Children are independent — create them in parallel. Errors propagate
        // unwrapped so formatErrorResponse keeps MetaApiError categorization.
        const childIds = await Promise.all(items.map(async (item) => {
          const params: FormParams = { is_carousel_item: true };
          if (item.type === "IMAGE") {
            params.image_url = item.url;
            if (item.alt_text) params.alt_text = item.alt_text;
          } else {
            params.video_url = item.url;
            params.media_type = "VIDEO";
          }
          const { data: child } = await client.ig("POST", `/${client.igUserId}/media`, params);
          if (typeof child.id !== "string") throw new Error("Container creation did not return a valid id");
          const childId = child.id;
          await waitForIgContainer(client, childId, item.type === "VIDEO" ? VIDEO_PROCESSING_TIMEOUT : IMAGE_PROCESSING_TIMEOUT);
          return childId;
        }));
        // Step 2: Create carousel container
        const carouselParams: FormParams = {
          media_type: "CAROUSEL",
          children: childIds.join(","),
        };
        if (caption) carouselParams.caption = caption;
        if (location_id) carouselParams.location_id = location_id;
        if (collaborators?.length) carouselParams.collaborators = JSON.stringify(collaborators);
        const { data: carousel } = await client.ig("POST", `/${client.igUserId}/media`, carouselParams);
        if (typeof carousel.id !== "string") throw new Error("Container creation did not return a valid id");
        const carouselId = carousel.id;
        // Step 3: Wait for carousel container to be ready
        await waitForIgContainer(client, carouselId);
        // Step 4: Publish
        const { data, rateLimit } = await client.ig("POST", `/${client.igUserId}/media_publish`, {
          creation_id: carouselId,
        });
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return formatErrorResponse(error, "Publish carousel");
      }
    }
  );

  // ─── ig_publish_reel ─────────────────────────────────────────
  server.tool(
    "ig_publish_reel",
    "Publish a Reel (short video). Waits for video processing.",
    {
      video_url: httpsUrl.describe("Public HTTPS URL of the video"),
      caption: z.string().optional().describe("Reel caption"),
      cover_url: httpsUrl.optional().describe("Custom cover image HTTPS URL"),
      share_to_feed: z.boolean().optional().describe("Also share to feed (default true)"),
      thumb_offset: z.number().optional().describe("Thumbnail offset in ms"),
      collaborators: collaboratorsSchema,
    },
    async ({ video_url, caption, cover_url, share_to_feed, thumb_offset, collaborators }) => {
      try {
        const params: FormParams = { video_url, media_type: "REELS" };
        if (caption) params.caption = caption;
        if (cover_url) params.cover_url = cover_url;
        if (share_to_feed !== undefined) params.share_to_feed = share_to_feed;
        if (thumb_offset !== undefined) params.thumb_offset = thumb_offset;
        if (collaborators?.length) params.collaborators = JSON.stringify(collaborators);
        const { data: container } = await client.ig("POST", `/${client.igUserId}/media`, params);
        if (typeof container.id !== "string") throw new Error("Container creation did not return a valid id");
        const containerId = container.id;
        await waitForIgContainer(client, containerId, VIDEO_PROCESSING_TIMEOUT);
        const { data, rateLimit } = await client.ig("POST", `/${client.igUserId}/media_publish`, {
          creation_id: containerId,
        });
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return formatErrorResponse(error, "Publish reel");
      }
    }
  );

  // ─── ig_publish_story ────────────────────────────────────────
  server.tool(
    "ig_publish_story",
    "Publish a Story (image or video). Stories disappear after 24 hours.",
    {
      media_type: z.enum(["IMAGE", "VIDEO"]).describe("Story media type"),
      media_url: httpsUrl.describe("Public HTTPS URL of the media"),
    },
    async ({ media_type, media_url }) => {
      try {
        const params: FormParams = { media_type: "STORIES" };
        if (media_type === "IMAGE") {
          params.image_url = media_url;
        } else {
          params.video_url = media_url;
        }
        const { data: container } = await client.ig("POST", `/${client.igUserId}/media`, params);
        if (typeof container.id !== "string") throw new Error("Container creation did not return a valid id");
        const containerId = container.id;
        await waitForIgContainer(client, containerId, media_type === "VIDEO" ? VIDEO_PROCESSING_TIMEOUT : IMAGE_PROCESSING_TIMEOUT);
        const { data, rateLimit } = await client.ig("POST", `/${client.igUserId}/media_publish`, {
          creation_id: containerId,
        });
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return formatErrorResponse(error, "Publish story");
      }
    }
  );

  // ─── ig_get_container_status ─────────────────────────────────
  server.tool(
    "ig_get_container_status",
    "Check the processing status of a media container (useful for videos).",
    {
      container_id: metaId.describe("Container ID to check"),
    },
    async ({ container_id }) => {
      try {
        const { data, rateLimit } = await client.ig("GET", `/${container_id}`, {
          fields: "id,status,status_code",
        });
        return { content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }] };
      } catch (error) {
        return formatErrorResponse(error, "Get container status");
      }
    }
  );
}
