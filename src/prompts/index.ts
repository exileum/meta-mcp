import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerPrompts(server: McpServer) {
  server.prompt(
    "content_publish",
    "Cross-post content to Instagram and Threads simultaneously",
    {},
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "Help me publish content across Instagram and Threads.",
              "",
              "Please follow these steps:",
              "1. Ask me what content I want to post (text, image URL, video URL)",
              "2. Use ig_publish_photo or ig_publish_video to post on Instagram",
              "3. Use threads_publish_text, threads_publish_image, or threads_publish_video to post on Threads",
              "4. Report back the permalink for each platform",
              "",
              "Tips:",
              "- Instagram captions can be up to 2200 characters",
              "- Threads posts are limited to 500 characters",
              "- Both platforms require publicly accessible HTTPS URLs for media",
              "- Video uploads may take time to process",
              "- You can add alt_text for accessibility on both platforms",
              "- On Threads, you can add a topic_tag, poll, or GIF attachment",
              "- On Threads, you can set reply_control (everyone, accounts_you_follow, mentioned_only, parent_post_author_only, followers_only)",
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.prompt(
    "analytics_report",
    "Generate a combined analytics report for Instagram and Threads",
    {},
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "Generate a comprehensive analytics report for my Instagram and Threads accounts.",
              "",
              "Please use the following tools:",
              "1. ig_get_profile — Get Instagram profile stats (followers, media count)",
              "2. ig_get_account_insights — Get Instagram insights for the last 7 days (metric: views,reach,follower_count, period: day)",
              "3. ig_get_media_list — Get recent 10 posts to analyze engagement",
              "4. threads_get_profile — Get Threads profile info",
              "5. threads_get_user_insights — Get Threads insights (metric: views,likes,replies,reposts,quotes,clicks)",
              "6. threads_get_posts — Get recent 10 Threads posts",
              "",
              "Then compile a report covering:",
              "- Follower count and growth trends",
              "- Top performing content on each platform",
              "- Engagement rate comparison (likes, comments, shares)",
              "- Recommendations for content strategy",
              "",
              "Note: 'impressions' and 'video_views' metrics were deprecated in Graph API v22.0.",
              "Use 'views' and 'reach' instead.",
            ].join("\n"),
          },
        },
      ],
    })
  );
}
