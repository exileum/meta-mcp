import { describe, it, expect, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAll } from "./register-all.js";
import type { MetaClient } from "./services/meta-client.js";

function makeMockServer() {
  const tools: string[] = [];
  const resources: { name: string; uri: string }[] = [];
  const prompts: string[] = [];
  return {
    tools,
    resources,
    prompts,
    registerTool: vi.fn((name: string) => tools.push(name)),
    registerResource: vi.fn((name: string, uri: string) => resources.push({ name, uri })),
    registerPrompt: vi.fn((name: string) => prompts.push(name)),
  };
}

describe("registerAll", () => {
  it("registers every tool, resource, and prompt in the expected order", () => {
    const server = makeMockServer();
    const client = {} as unknown as MetaClient;

    registerAll(server as unknown as McpServer, client);

    expect(server.tools).toEqual([
      "meta_exchange_token",
      "meta_refresh_token",
      "meta_debug_token",
      "meta_get_app_info",
      "meta_subscribe_webhook",
      "meta_get_webhook_subscriptions",
      "ig_publish_photo",
      "ig_publish_video",
      "ig_publish_carousel",
      "ig_publish_reel",
      "ig_publish_story",
      "ig_get_container_status",
      "ig_get_media_list",
      "ig_get_media",
      "ig_delete_media",
      "ig_get_media_insights",
      "ig_toggle_comments",
      "ig_get_comments",
      "ig_get_comment",
      "ig_post_comment",
      "ig_get_replies",
      "ig_reply_to_comment",
      "ig_hide_comment",
      "ig_delete_comment",
      "ig_get_profile",
      "ig_get_account_insights",
      "ig_business_discovery",
      "ig_get_collaboration_invites",
      "ig_respond_collaboration_invite",
      "ig_search_hashtag",
      "ig_get_hashtag",
      "ig_get_hashtag_recent",
      "ig_get_hashtag_top",
      "ig_get_mentioned_comment",
      "ig_get_tagged_media",
      "ig_get_conversations",
      "ig_get_messages",
      "ig_send_message",
      "ig_get_message",
      "threads_publish_text",
      "threads_publish_image",
      "threads_publish_video",
      "threads_publish_carousel",
      "threads_delete_post",
      "threads_get_container_status",
      "threads_get_publishing_limit",
      "threads_repost",
      "threads_search_locations",
      "threads_get_posts",
      "threads_get_post",
      "threads_search_posts",
      "threads_get_replies",
      "threads_reply",
      "threads_hide_reply",
      "threads_unhide_reply",
      "threads_get_profile",
      "threads_get_post_insights",
      "threads_get_user_insights",
      "threads_get_mentions",
    ]);

    expect(server.resources).toEqual([
      { name: "instagram-profile", uri: "meta-mcp://instagram/profile" },
      { name: "threads-profile", uri: "meta-mcp://threads/profile" },
    ]);

    expect(server.prompts).toEqual(["content_publish", "analytics_report"]);
  });
});
