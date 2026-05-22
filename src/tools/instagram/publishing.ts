import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { httpsUrl, metaId } from "../../schemas.js";
import { waitForIgContainer, IMAGE_PROCESSING_TIMEOUT, VIDEO_PROCESSING_TIMEOUT } from "../../utils/container.js";
import { formatErrorResponse } from "../../utils/errors.js";
import { formatResponse } from "../../utils/response.js";
import { buildParams } from "../../utils/params.js";
import { READ_ONLY_TOOL, WRITE_TOOL } from "../annotations.js";

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
  server.registerTool(
    "ig_publish_photo",
    {
      description: "Publish a photo to Instagram. Two-step process: creates container then publishes. Requires image_url (publicly accessible HTTPS URL).",
      inputSchema: {
        image_url: httpsUrl.describe("Public HTTPS URL of the image (JPEG only)"),
        caption: z.string().optional().describe("Post caption (max 2200 chars)"),
        location_id: z.string().optional().describe("Facebook Page location ID"),
        user_tags: z.string().optional().describe("JSON array of user tags: [{username, x, y}]"),
        alt_text: z.string().optional().describe("Alt text for accessibility"),
        collaborators: collaboratorsSchema,
      },
      annotations: WRITE_TOOL,
    },
    async ({ image_url, caption, location_id, user_tags, alt_text, collaborators }) => {
      try {
        const params = buildParams(
          { image_url },
          {
            caption,
            location_id,
            user_tags,
            alt_text,
            collaborators: collaborators?.length ? JSON.stringify(collaborators) : undefined,
          }
        );
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
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Publish photo");
      }
    }
  );

  // ─── ig_publish_video ────────────────────────────────────────
  server.registerTool(
    "ig_publish_video",
    {
      description: "[DEPRECATED] Use ig_publish_reel instead. Publishes via media_type=REELS under the hood; the legacy VIDEO media_type was deprecated by Meta on Nov 9, 2023. Kept for backward compatibility — new integrations should use ig_publish_reel which exposes Reels-specific options (cover_url, share_to_feed, alt_text).",
      inputSchema: {
        video_url: httpsUrl.describe("Public HTTPS URL of the video"),
        caption: z.string().optional().describe("Post caption"),
        thumb_offset: z.number().optional().describe("Thumbnail offset in ms"),
        location_id: z.string().optional().describe("Facebook Page location ID"),
        collaborators: collaboratorsSchema,
      },
      annotations: WRITE_TOOL,
    },
    async ({ video_url, caption, thumb_offset, location_id, collaborators }) => {
      try {
        // share_to_feed: true preserves the legacy feed placement of the deprecated
        // VIDEO media_type — without it, REELS containers default to the Reels tab only.
        const params = buildParams(
          { video_url, media_type: "REELS", share_to_feed: true },
          {
            caption,
            thumb_offset,
            location_id,
            collaborators: collaborators?.length ? JSON.stringify(collaborators) : undefined,
          }
        );
        const { data: container } = await client.ig("POST", `/${client.igUserId}/media`, params);
        if (typeof container.id !== "string") throw new Error("Container creation did not return a valid id");
        const containerId = container.id;
        await waitForIgContainer(client, containerId, VIDEO_PROCESSING_TIMEOUT);
        const { data, rateLimit } = await client.ig("POST", `/${client.igUserId}/media_publish`, {
          creation_id: containerId,
        });
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Publish video");
      }
    }
  );

  // ─── ig_publish_carousel ─────────────────────────────────────
  server.registerTool(
    "ig_publish_carousel",
    {
      description: "Publish a carousel (album) post with 2-10 images/videos. Each item needs a `url` (JPEG image or MP4 video) and a `type` (IMAGE or VIDEO).",
      inputSchema: {
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
      annotations: WRITE_TOOL,
    },
    async ({ items, caption, location_id, collaborators }) => {
      try {
        // Children are independent — create them in parallel. Errors propagate
        // unwrapped so formatErrorResponse keeps MetaApiError categorization.
        const childIds = await Promise.all(items.map(async (item) => {
          const params = buildParams(
            { is_carousel_item: true },
            {
              image_url: item.type === "IMAGE" ? item.url : undefined,
              video_url: item.type === "VIDEO" ? item.url : undefined,
              media_type: item.type === "VIDEO" ? "VIDEO" : undefined,
              alt_text: item.type === "IMAGE" ? item.alt_text : undefined,
            }
          );
          const { data: child } = await client.ig("POST", `/${client.igUserId}/media`, params);
          if (typeof child.id !== "string") throw new Error("Container creation did not return a valid id");
          const childId = child.id;
          await waitForIgContainer(client, childId, item.type === "VIDEO" ? VIDEO_PROCESSING_TIMEOUT : IMAGE_PROCESSING_TIMEOUT);
          return childId;
        }));
        // Step 2: Create carousel container
        const carouselParams = buildParams(
          { media_type: "CAROUSEL", children: childIds.join(",") },
          {
            caption,
            location_id,
            collaborators: collaborators?.length ? JSON.stringify(collaborators) : undefined,
          }
        );
        const { data: carousel } = await client.ig("POST", `/${client.igUserId}/media`, carouselParams);
        if (typeof carousel.id !== "string") throw new Error("Container creation did not return a valid id");
        const carouselId = carousel.id;
        // Step 3: Wait for carousel container to be ready
        await waitForIgContainer(client, carouselId);
        // Step 4: Publish
        const { data, rateLimit } = await client.ig("POST", `/${client.igUserId}/media_publish`, {
          creation_id: carouselId,
        });
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Publish carousel");
      }
    }
  );

  // ─── ig_publish_reel ─────────────────────────────────────────
  server.registerTool(
    "ig_publish_reel",
    {
      description: "Publish a Reel (short video). Waits for video processing.",
      inputSchema: {
        video_url: httpsUrl.describe("Public HTTPS URL of the video"),
        caption: z.string().optional().describe("Reel caption"),
        cover_url: httpsUrl.optional().describe("Custom cover image HTTPS URL"),
        share_to_feed: z.boolean().optional().describe("Also share to feed (default true)"),
        thumb_offset: z.number().optional().describe("Thumbnail offset in ms"),
        collaborators: collaboratorsSchema,
      },
      annotations: WRITE_TOOL,
    },
    async ({ video_url, caption, cover_url, share_to_feed, thumb_offset, collaborators }) => {
      try {
        const params = buildParams(
          { video_url, media_type: "REELS" },
          {
            caption,
            cover_url,
            share_to_feed,
            thumb_offset,
            collaborators: collaborators?.length ? JSON.stringify(collaborators) : undefined,
          }
        );
        const { data: container } = await client.ig("POST", `/${client.igUserId}/media`, params);
        if (typeof container.id !== "string") throw new Error("Container creation did not return a valid id");
        const containerId = container.id;
        await waitForIgContainer(client, containerId, VIDEO_PROCESSING_TIMEOUT);
        const { data, rateLimit } = await client.ig("POST", `/${client.igUserId}/media_publish`, {
          creation_id: containerId,
        });
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Publish reel");
      }
    }
  );

  // ─── ig_publish_story ────────────────────────────────────────
  server.registerTool(
    "ig_publish_story",
    {
      description: "Publish a Story (image or video). Stories disappear after 24 hours.",
      inputSchema: {
        media_type: z.enum(["IMAGE", "VIDEO"]).describe("Story media type"),
        media_url: httpsUrl.describe("Public HTTPS URL of the media"),
      },
      annotations: WRITE_TOOL,
    },
    async ({ media_type, media_url }) => {
      try {
        const params = buildParams(
          { media_type: "STORIES" },
          {
            image_url: media_type === "IMAGE" ? media_url : undefined,
            video_url: media_type === "VIDEO" ? media_url : undefined,
          }
        );
        const { data: container } = await client.ig("POST", `/${client.igUserId}/media`, params);
        if (typeof container.id !== "string") throw new Error("Container creation did not return a valid id");
        const containerId = container.id;
        await waitForIgContainer(client, containerId, media_type === "VIDEO" ? VIDEO_PROCESSING_TIMEOUT : IMAGE_PROCESSING_TIMEOUT);
        const { data, rateLimit } = await client.ig("POST", `/${client.igUserId}/media_publish`, {
          creation_id: containerId,
        });
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Publish story");
      }
    }
  );

  // ─── ig_get_container_status ─────────────────────────────────
  server.registerTool(
    "ig_get_container_status",
    {
      description: "Check the processing status of a media container (useful for videos).",
      inputSchema: {
        container_id: metaId.describe("Container ID to check"),
      },
      annotations: READ_ONLY_TOOL,
    },
    async ({ container_id }) => {
      try {
        const { data, rateLimit } = await client.ig("GET", `/${container_id}`, {
          fields: "id,status,status_code",
        });
        return formatResponse(data, rateLimit);
      } catch (error) {
        return formatErrorResponse(error, "Get container status");
      }
    }
  );
}
