import { describe, it, expect } from "vitest";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { MetaClient, MetaConfig } from "../services/meta-client.js";
import { makeMockServer } from "./test-utils.js";

import { registerMetaAuthTools } from "./meta/auth.js";
import { registerIgPublishingTools } from "./instagram/publishing.js";
import { registerIgMediaTools } from "./instagram/media.js";
import { registerIgCommentTools } from "./instagram/comments.js";
import { registerIgProfileTools } from "./instagram/profile.js";
import { registerIgHashtagTools } from "./instagram/hashtags.js";
import { registerIgMentionTools } from "./instagram/mentions.js";
import { registerIgMessagingTools } from "./instagram/messaging.js";
import { registerThreadsPublishingTools } from "./threads/publishing.js";
import { registerThreadsMediaTools } from "./threads/media.js";
import { registerThreadsReplyTools } from "./threads/replies.js";
import { registerThreadsProfileTools } from "./threads/profile.js";
import { registerThreadsInsightTools } from "./threads/insights.js";
import { registerThreadsMentionsTools } from "./threads/mentions.js";

function buildServerWithAllTools() {
  const server = makeMockServer();
  const cfg: MetaConfig = {
    appId: "",
    appSecret: "",
    instagramAccessToken: "",
    instagramUserId: "",
    threadsAccessToken: "",
    threadsUserId: "",
  };
  const client = new MetaClient(cfg);
  registerMetaAuthTools(server as never, client);
  registerIgPublishingTools(server as never, client);
  registerIgMediaTools(server as never, client);
  registerIgCommentTools(server as never, client);
  registerIgProfileTools(server as never, client);
  registerIgHashtagTools(server as never, client);
  registerIgMentionTools(server as never, client);
  registerIgMessagingTools(server as never, client);
  registerThreadsPublishingTools(server as never, client);
  registerThreadsMediaTools(server as never, client);
  registerThreadsReplyTools(server as never, client);
  registerThreadsProfileTools(server as never, client);
  registerThreadsInsightTools(server as never, client);
  registerThreadsMentionsTools(server as never, client);
  return server;
}

function getAnnotations(server: ReturnType<typeof buildServerWithAllTools>, name: string): ToolAnnotations {
  const ann = server.annotations.get(name);
  if (!ann) throw new Error(`Tool ${name} was registered without annotations`);
  return ann;
}

describe("MCP tool annotations", () => {
  const server = buildServerWithAllTools();

  it("every registered tool has annotations", () => {
    for (const name of server.tools.keys()) {
      expect(server.annotations.get(name), `tool ${name}`).toBeDefined();
    }
  });

  it("every tool sets openWorldHint: true (Meta Graph API is external)", () => {
    for (const name of server.tools.keys()) {
      expect(getAnnotations(server, name).openWorldHint, `tool ${name}`).toBe(true);
    }
  });

  describe("read-only tools", () => {
    const readOnlyTools = [
      "meta_debug_token",
      "meta_get_app_info",
      "meta_get_webhook_subscriptions",
      "ig_get_media_list",
      "ig_get_media",
      "ig_get_media_insights",
      "ig_get_container_status",
      "ig_get_comments",
      "ig_get_comment",
      "ig_get_replies",
      "ig_get_profile",
      "ig_get_account_insights",
      "ig_business_discovery",
      "ig_get_collaboration_invites",
      "ig_search_hashtag",
      "ig_get_hashtag",
      "ig_get_hashtag_recent",
      "ig_get_hashtag_top",
      "ig_get_mentioned_comment",
      "ig_get_tagged_media",
      "ig_get_conversations",
      "ig_get_messages",
      "ig_get_message",
      "threads_get_posts",
      "threads_get_post",
      "threads_search_posts",
      "threads_get_replies",
      "threads_get_post_insights",
      "threads_get_user_insights",
      "threads_get_container_status",
      "threads_get_publishing_limit",
      "threads_get_profile",
      "threads_get_mentions",
      "threads_search_locations",
    ];

    it.each(readOnlyTools)("%s has readOnlyHint: true", (name) => {
      expect(getAnnotations(server, name).readOnlyHint).toBe(true);
    });
  });

  describe("destructive tools", () => {
    // Per MCP spec, idempotentHint = "no additional effect on env" — HTTP DELETE
    // satisfies this (second call leaves the resource deleted). This contradicts
    // the literal example in issue #37 but matches the canonical hint semantics.
    const destructiveTools = ["ig_delete_media", "ig_delete_comment", "threads_delete_post"];

    it.each(destructiveTools)("%s is destructive, non-read-only, and idempotent", (name) => {
      const ann = getAnnotations(server, name);
      expect(ann.readOnlyHint).toBe(false);
      expect(ann.destructiveHint).toBe(true);
      expect(ann.idempotentHint).toBe(true);
    });
  });

  describe("write tools (creates content, non-idempotent)", () => {
    const writeTools = [
      "meta_exchange_token",
      "meta_refresh_token",
      "ig_publish_photo",
      "ig_publish_video",
      "ig_publish_carousel",
      "ig_publish_reel",
      "ig_publish_story",
      "ig_post_comment",
      "ig_reply_to_comment",
      "ig_send_message",
      "threads_publish_text",
      "threads_publish_image",
      "threads_publish_video",
      "threads_publish_carousel",
      "threads_reply",
      "threads_repost",
    ];

    it.each(writeTools)("%s is non-read-only, non-destructive, non-idempotent", (name) => {
      const ann = getAnnotations(server, name);
      expect(ann.readOnlyHint).toBe(false);
      expect(ann.destructiveHint).toBe(false);
      expect(ann.idempotentHint).toBe(false);
    });
  });

  describe("write-idempotent tools (state change, same args ⇒ same env)", () => {
    const writeIdempotentTools = [
      "meta_subscribe_webhook",
      "ig_toggle_comments",
      "ig_hide_comment",
      "ig_respond_collaboration_invite",
      "threads_hide_reply",
      "threads_unhide_reply",
    ];

    it.each(writeIdempotentTools)("%s is non-read-only, non-destructive, idempotent", (name) => {
      const ann = getAnnotations(server, name);
      expect(ann.readOnlyHint).toBe(false);
      expect(ann.destructiveHint).toBe(false);
      expect(ann.idempotentHint).toBe(true);
    });
  });

  it("covers all 59 tools across the four categories", () => {
    expect(server.tools.size).toBe(59);
  });
});
