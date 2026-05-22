import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Tool names referenced by prompts. Cross-checked against the registered tool
 * list in `src/prompts/index.test.ts` — if any tool is renamed/removed/split,
 * the test fails and forces both the registration site and the prompt to
 * update together. `ig_publish_video` is deliberately omitted: it's deprecated
 * (CHANGELOG v4.0.0 / #118) and the prompt steers callers to
 * `ig_publish_reel` for video content instead.
 */
export const PROMPT_TOOL_NAMES = {
  IG_PUBLISH_PHOTO: "ig_publish_photo",
  IG_PUBLISH_REEL: "ig_publish_reel",
  IG_PUBLISH_CAROUSEL: "ig_publish_carousel",
  THREADS_PUBLISH_TEXT: "threads_publish_text",
  THREADS_PUBLISH_IMAGE: "threads_publish_image",
  THREADS_PUBLISH_VIDEO: "threads_publish_video",
  THREADS_PUBLISH_CAROUSEL: "threads_publish_carousel",
  IG_GET_PROFILE: "ig_get_profile",
  IG_GET_ACCOUNT_INSIGHTS: "ig_get_account_insights",
  IG_GET_MEDIA_LIST: "ig_get_media_list",
  THREADS_GET_PROFILE: "threads_get_profile",
  THREADS_GET_USER_INSIGHTS: "threads_get_user_insights",
  THREADS_GET_POSTS: "threads_get_posts",
} as const;

export const contentPublishArgsSchema = {
  platform: z
    .enum(["instagram", "threads", "both"])
    .optional()
    .describe("Target platform — instagram, threads, or both (default: both)"),
  content_type: z
    .enum(["text", "image", "video", "carousel"])
    .optional()
    .describe(
      "Content type — text is Threads-only; image/video/carousel work on both platforms",
    ),
  media_url: z
    .string()
    .optional()
    .describe(
      "Pre-filled media URL — Instagram and Threads both require publicly accessible HTTPS",
    ),
  caption: z.string().optional().describe("Pre-filled caption / post text"),
};

export const analyticsReportArgsSchema = {
  platform: z
    .enum(["instagram", "threads", "both"])
    .optional()
    .describe("Target platform — instagram, threads, or both (default: both)"),
  time_range: z
    .enum(["7d", "30d", "90d"])
    .optional()
    .describe("Time window for insights — 7d, 30d, or 90d (default: 7d)"),
  focus: z
    .enum(["engagement", "growth", "content"])
    .optional()
    .describe(
      "Report focus — engagement, growth, or content (default: balanced overview)",
    ),
};

type Platform = "instagram" | "threads" | "both";
type ContentType = "text" | "image" | "video" | "carousel";
type TimeRange = "7d" | "30d" | "90d";
type Focus = "engagement" | "growth" | "content";

const TIME_RANGE_DESCRIPTIONS: Record<TimeRange, string> = {
  "7d": "the last 7 days",
  "30d": "the last 30 days",
  "90d": "the last 90 days",
};

function includesInstagram(platform: Platform): boolean {
  return platform === "instagram" || platform === "both";
}

function includesThreads(platform: Platform): boolean {
  return platform === "threads" || platform === "both";
}

function pickIgPublishTools(contentType: ContentType | undefined): string[] {
  if (contentType === "text") return [];
  if (contentType === "image") return [PROMPT_TOOL_NAMES.IG_PUBLISH_PHOTO];
  if (contentType === "video") return [PROMPT_TOOL_NAMES.IG_PUBLISH_REEL];
  if (contentType === "carousel") return [PROMPT_TOOL_NAMES.IG_PUBLISH_CAROUSEL];
  return [
    PROMPT_TOOL_NAMES.IG_PUBLISH_PHOTO,
    PROMPT_TOOL_NAMES.IG_PUBLISH_REEL,
    PROMPT_TOOL_NAMES.IG_PUBLISH_CAROUSEL,
  ];
}

function pickThreadsPublishTools(contentType: ContentType | undefined): string[] {
  if (contentType === "text") return [PROMPT_TOOL_NAMES.THREADS_PUBLISH_TEXT];
  if (contentType === "image") return [PROMPT_TOOL_NAMES.THREADS_PUBLISH_IMAGE];
  if (contentType === "video") return [PROMPT_TOOL_NAMES.THREADS_PUBLISH_VIDEO];
  if (contentType === "carousel")
    return [PROMPT_TOOL_NAMES.THREADS_PUBLISH_CAROUSEL];
  return [
    PROMPT_TOOL_NAMES.THREADS_PUBLISH_TEXT,
    PROMPT_TOOL_NAMES.THREADS_PUBLISH_IMAGE,
    PROMPT_TOOL_NAMES.THREADS_PUBLISH_VIDEO,
    PROMPT_TOOL_NAMES.THREADS_PUBLISH_CAROUSEL,
  ];
}

function buildContentPublishText(args: {
  platform?: Platform;
  content_type?: ContentType;
  media_url?: string;
  caption?: string;
}): string {
  const platform = args.platform ?? "both";
  const contentType = args.content_type;
  const wantIg = includesInstagram(platform) && contentType !== "text";
  const wantThreads = includesThreads(platform);

  const lines: string[] = [];

  if (wantIg && wantThreads) {
    lines.push("Help me publish content across Instagram and Threads.");
  } else if (wantIg) {
    lines.push("Help me publish content on Instagram.");
  } else if (wantThreads) {
    lines.push("Help me publish content on Threads.");
  } else {
    lines.push(
      "Instagram cannot publish text-only posts — pick platform=threads or a non-text content_type.",
    );
    return lines.join("\n");
  }

  if (contentType === "text" && includesInstagram(platform)) {
    lines.push("");
    lines.push(
      "Note: Instagram cannot publish text-only posts, so only Threads will receive this content.",
    );
  }

  lines.push("");
  lines.push("Please follow these steps:");

  let step = 1;
  if (args.media_url) {
    lines.push(`${step}. Use the provided media URL: ${args.media_url}`);
    step++;
  } else if (contentType === "text") {
    lines.push(`${step}. Ask me what text I want to post`);
    step++;
  } else {
    lines.push(
      `${step}. Ask me what content I want to post (text, image URL, video URL)`,
    );
    step++;
  }

  if (args.caption) {
    lines.push(`${step}. Use the provided caption: ${args.caption}`);
    step++;
  }

  if (wantIg) {
    const tools = pickIgPublishTools(contentType);
    if (tools.length > 0) {
      lines.push(`${step}. Use ${joinTools(tools)} to post on Instagram`);
      step++;
    }
  }
  if (wantThreads) {
    const tools = pickThreadsPublishTools(contentType);
    if (tools.length > 0) {
      lines.push(`${step}. Use ${joinTools(tools)} to post on Threads`);
      step++;
    }
  }
  lines.push(`${step}. Report back the permalink for each platform`);

  lines.push("");
  lines.push("Tips:");
  if (wantIg) {
    lines.push("- Instagram captions can be up to 2200 characters");
  }
  if (wantThreads) {
    lines.push("- Threads posts are limited to 500 characters");
  }
  if (contentType !== "text") {
    lines.push(
      "- Both platforms require publicly accessible HTTPS URLs for media",
    );
    lines.push("- Video uploads may take time to process");
    if (wantIg && wantThreads) {
      lines.push(
        "- You can add alt_text for accessibility on Instagram photo posts and Threads media; Reels, Stories, and IG videos do not support it",
      );
    } else if (wantIg) {
      lines.push(
        "- You can add alt_text for accessibility on Instagram photo posts; Reels, Stories, and IG videos do not support it",
      );
    } else if (wantThreads) {
      lines.push("- You can add alt_text for accessibility on Threads media");
    }
  }
  if (wantIg) {
    const collabTools = pickIgPublishTools(contentType);
    const collabVerb = collabTools.length > 1 ? "accept" : "accepts";
    lines.push(
      `- On Instagram, ${joinTools(collabTools)} ${collabVerb} an optional \`collaborators\` array of up to 3 usernames; Stories do not support collaborators`,
    );
  }
  if (wantThreads) {
    lines.push(
      "- On Threads, you can add a topic_tag, poll, or GIF attachment",
    );
    lines.push(
      "- On Threads, you can set reply_control (everyone, accounts_you_follow, mentioned_only, parent_post_author_only, followers_only)",
    );
  }

  return lines.join("\n");
}

function joinTools(tools: string[]): string {
  if (tools.length === 1) return tools[0];
  if (tools.length === 2) return `${tools[0]} or ${tools[1]}`;
  return `${tools.slice(0, -1).join(", ")}, or ${tools[tools.length - 1]}`;
}

function buildAnalyticsReportText(args: {
  platform?: Platform;
  time_range?: TimeRange;
  focus?: Focus;
}): string {
  const platform = args.platform ?? "both";
  const timeRange = args.time_range ?? "7d";
  const wantIg = includesInstagram(platform);
  const wantThreads = includesThreads(platform);
  const timeRangeText = TIME_RANGE_DESCRIPTIONS[timeRange];

  const lines: string[] = [];

  if (wantIg && wantThreads) {
    lines.push(
      "Generate a comprehensive analytics report for my Instagram and Threads accounts.",
    );
  } else if (wantIg) {
    lines.push(
      "Generate a comprehensive analytics report for my Instagram account.",
    );
  } else {
    lines.push(
      "Generate a comprehensive analytics report for my Threads account.",
    );
  }

  if (args.focus) {
    lines.push("");
    lines.push(
      `Pay particular attention to ${args.focus} metrics in this report.`,
    );
  }

  lines.push("");
  lines.push("Please use the following tools:");

  let step = 1;
  if (wantIg) {
    lines.push(
      `${step}. ${PROMPT_TOOL_NAMES.IG_GET_PROFILE} — Get Instagram profile stats (followers, media count)`,
    );
    step++;
    lines.push(
      `${step}. ${PROMPT_TOOL_NAMES.IG_GET_ACCOUNT_INSIGHTS} — Get Instagram insights for ${timeRangeText} (metric: views,reach,follower_count, period: day)`,
    );
    step++;
    lines.push(
      `${step}. ${PROMPT_TOOL_NAMES.IG_GET_MEDIA_LIST} — Get recent 10 posts to analyze engagement`,
    );
    step++;
  }
  if (wantThreads) {
    lines.push(
      `${step}. ${PROMPT_TOOL_NAMES.THREADS_GET_PROFILE} — Get Threads profile info`,
    );
    step++;
    lines.push(
      `${step}. ${PROMPT_TOOL_NAMES.THREADS_GET_USER_INSIGHTS} — Get Threads insights for ${timeRangeText} (metric: views,likes,replies,reposts,quotes,clicks, period: day)`,
    );
    step++;
    lines.push(
      `${step}. ${PROMPT_TOOL_NAMES.THREADS_GET_POSTS} — Get recent 10 Threads posts`,
    );
  }

  lines.push("");
  lines.push("Then compile a report covering:");
  lines.push("- Follower count and growth trends");
  if (wantIg && wantThreads) {
    lines.push("- Top performing content on each platform");
    lines.push("- Engagement rate comparison (likes, comments, shares)");
  } else {
    lines.push("- Top performing content");
    lines.push("- Engagement rate (likes, comments, shares)");
  }
  lines.push("- Recommendations for content strategy");

  if (wantIg) {
    lines.push("");
    lines.push(
      "Note: 'impressions' and 'video_views' metrics were deprecated in Graph API v22.0.",
    );
    lines.push("Use 'views' and 'reach' instead.");
  }

  return lines.join("\n");
}

export function registerPrompts(server: McpServer) {
  server.registerPrompt(
    "content_publish",
    {
      description:
        "Cross-post content to Instagram and Threads simultaneously",
      argsSchema: contentPublishArgsSchema,
    },
    (args) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: buildContentPublishText(args),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "analytics_report",
    {
      description:
        "Generate a combined analytics report for Instagram and Threads",
      argsSchema: analyticsReportArgsSchema,
    },
    (args) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: buildAnalyticsReportText(args),
          },
        },
      ],
    }),
  );
}
