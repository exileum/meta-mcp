import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAll } from "../register-all.js";
import type { MetaClient } from "../services/meta-client.js";
import {
  PROMPT_TOOL_NAMES,
  analyticsReportArgsSchema,
  contentPublishArgsSchema,
  registerPrompts,
} from "./index.js";

type PromptCall = {
  name: string;
  config: {
    description?: string;
    argsSchema?: Record<string, z.ZodTypeAny>;
  };
  handler: (args: Record<string, unknown>) => {
    messages: Array<{
      role: "user";
      content: { type: "text"; text: string };
    }>;
  };
};

function makeMockServer() {
  const prompts: PromptCall[] = [];
  return {
    prompts,
    registerPrompt: vi.fn(
      (
        name: string,
        config: PromptCall["config"],
        handler: PromptCall["handler"],
      ) => {
        prompts.push({ name, config, handler });
      },
    ),
  };
}

function captureRegistrations() {
  const server = makeMockServer();
  registerPrompts(server as unknown as McpServer);
  const byName = new Map(server.prompts.map((p) => [p.name, p]));
  return { server, byName };
}

function renderPrompt(
  call: PromptCall | undefined,
  args: Record<string, unknown>,
): string {
  if (!call) throw new Error("prompt not registered");
  return call.handler(args).messages[0].content.text;
}

describe("PROMPT_TOOL_NAMES", () => {
  it("references only tool names that registerAll() actually registers", () => {
    const tools: string[] = [];
    const server = {
      registerTool: vi.fn((name: string) => tools.push(name)),
      registerResource: vi.fn(),
      registerPrompt: vi.fn(),
    };

    registerAll(server as unknown as McpServer, {} as unknown as MetaClient);

    const registered = new Set(tools);
    for (const [key, name] of Object.entries(PROMPT_TOOL_NAMES)) {
      expect(
        registered.has(name),
        `PROMPT_TOOL_NAMES.${key} = "${name}" is not a registered tool`,
      ).toBe(true);
    }
  });
});

describe("registerPrompts", () => {
  it("registers content_publish and analytics_report with documented argsSchema", () => {
    const { byName } = captureRegistrations();

    const contentPublish = byName.get("content_publish");
    expect(contentPublish?.config.argsSchema).toBe(contentPublishArgsSchema);
    expect(Object.keys(contentPublish!.config.argsSchema!).sort()).toEqual([
      "caption",
      "content_type",
      "media_url",
      "platform",
    ]);

    const analyticsReport = byName.get("analytics_report");
    expect(analyticsReport?.config.argsSchema).toBe(analyticsReportArgsSchema);
    expect(Object.keys(analyticsReport!.config.argsSchema!).sort()).toEqual([
      "focus",
      "platform",
      "time_range",
    ]);
  });

  it("marks every arg as optional so calls with {} stay valid", () => {
    const contentPublishParse = z
      .object(contentPublishArgsSchema)
      .safeParse({});
    const analyticsReportParse = z
      .object(analyticsReportArgsSchema)
      .safeParse({});

    expect(contentPublishParse.success).toBe(true);
    expect(analyticsReportParse.success).toBe(true);
  });

  describe("content_publish handler", () => {
    it("defaults to cross-posting on both platforms with all publish tools", () => {
      const { byName } = captureRegistrations();
      const text = renderPrompt(byName.get("content_publish"), {});

      expect(text).toContain("Instagram and Threads");
      expect(text).toContain(PROMPT_TOOL_NAMES.IG_PUBLISH_PHOTO);
      expect(text).toContain(PROMPT_TOOL_NAMES.IG_PUBLISH_REEL);
      expect(text).toContain(PROMPT_TOOL_NAMES.IG_PUBLISH_CAROUSEL);
      expect(text).toContain(PROMPT_TOOL_NAMES.THREADS_PUBLISH_TEXT);
      expect(text).toContain(PROMPT_TOOL_NAMES.THREADS_PUBLISH_IMAGE);
      expect(text).toContain(PROMPT_TOOL_NAMES.THREADS_PUBLISH_VIDEO);
      expect(text).toContain(PROMPT_TOOL_NAMES.THREADS_PUBLISH_CAROUSEL);
      expect(text).not.toContain("ig_publish_video");
    });

    it("when platform=instagram, omits Threads tools and tips", () => {
      const { byName } = captureRegistrations();
      const text = renderPrompt(byName.get("content_publish"), {
        platform: "instagram",
      });

      expect(text).toContain("on Instagram");
      expect(text).not.toContain("Threads");
      expect(text).toContain(PROMPT_TOOL_NAMES.IG_PUBLISH_PHOTO);
      expect(text).not.toContain(PROMPT_TOOL_NAMES.THREADS_PUBLISH_TEXT);
      expect(text).not.toContain("500 characters");
      expect(text).toContain("2200 characters");
    });

    it("when platform=threads, omits Instagram tools and tips", () => {
      const { byName } = captureRegistrations();
      const text = renderPrompt(byName.get("content_publish"), {
        platform: "threads",
      });

      expect(text).toContain("on Threads");
      expect(text).not.toContain("Instagram");
      expect(text).toContain(PROMPT_TOOL_NAMES.THREADS_PUBLISH_TEXT);
      expect(text).not.toContain(PROMPT_TOOL_NAMES.IG_PUBLISH_PHOTO);
      expect(text).toContain("500 characters");
      expect(text).not.toContain("2200 characters");
    });

    it("when content_type=text, narrows to threads_publish_text only", () => {
      const { byName } = captureRegistrations();
      const text = renderPrompt(byName.get("content_publish"), {
        content_type: "text",
      });

      expect(text).toContain(PROMPT_TOOL_NAMES.THREADS_PUBLISH_TEXT);
      expect(text).not.toContain(PROMPT_TOOL_NAMES.IG_PUBLISH_PHOTO);
      expect(text).not.toContain(PROMPT_TOOL_NAMES.IG_PUBLISH_REEL);
      expect(text).not.toContain(PROMPT_TOOL_NAMES.IG_PUBLISH_CAROUSEL);
      expect(text).not.toContain(PROMPT_TOOL_NAMES.THREADS_PUBLISH_IMAGE);
      expect(text).not.toContain(PROMPT_TOOL_NAMES.THREADS_PUBLISH_VIDEO);
      expect(text).toContain("text-only");
      expect(text).toContain("only Threads will receive this content");
    });

    it("when content_type=video, narrows to ig_publish_reel and threads_publish_video", () => {
      const { byName } = captureRegistrations();
      const text = renderPrompt(byName.get("content_publish"), {
        content_type: "video",
      });

      expect(text).toContain(PROMPT_TOOL_NAMES.IG_PUBLISH_REEL);
      expect(text).toContain(PROMPT_TOOL_NAMES.THREADS_PUBLISH_VIDEO);
      expect(text).not.toContain(PROMPT_TOOL_NAMES.IG_PUBLISH_PHOTO);
      expect(text).not.toContain(PROMPT_TOOL_NAMES.IG_PUBLISH_CAROUSEL);
      expect(text).not.toContain(PROMPT_TOOL_NAMES.THREADS_PUBLISH_IMAGE);
    });

    it("interpolates media_url and caption when provided", () => {
      const { byName } = captureRegistrations();
      const text = renderPrompt(byName.get("content_publish"), {
        media_url: "https://example.com/photo.jpg",
        caption: "Hello world!",
      });

      expect(text).toContain("https://example.com/photo.jpg");
      expect(text).toContain("Hello world!");
      expect(text).not.toContain(
        "Ask me what content I want to post",
      );
    });

    it("when platform=instagram and content_type=text, returns an error-only message", () => {
      const { byName } = captureRegistrations();
      const text = renderPrompt(byName.get("content_publish"), {
        platform: "instagram",
        content_type: "text",
      });

      expect(text).toContain("Instagram cannot publish text-only posts");
      expect(text).not.toContain("Please follow these steps");
      expect(text).not.toContain("Tips:");
    });

    it("when caption is provided alone, skips the 'ask for text' step", () => {
      const { byName } = captureRegistrations();
      const text = renderPrompt(byName.get("content_publish"), {
        content_type: "text",
        caption: "Hi from Threads!",
      });

      expect(text).toContain("Hi from Threads!");
      expect(text).not.toContain("Ask me what text I want to post");
    });

    it("when caption is provided with media content, narrows the ask to URL only", () => {
      const { byName } = captureRegistrations();
      const text = renderPrompt(byName.get("content_publish"), {
        caption: "look at this",
      });

      expect(text).toContain("image or video URL");
      expect(text).not.toContain("text, image URL, or video URL");
    });

    it("singularizes 'Report back the permalink' when only one platform is targeted", () => {
      const { byName } = captureRegistrations();
      const igText = renderPrompt(byName.get("content_publish"), {
        platform: "instagram",
      });
      const threadsText = renderPrompt(byName.get("content_publish"), {
        platform: "threads",
      });

      expect(igText).toContain("Report back the permalink on Instagram");
      expect(threadsText).toContain("Report back the permalink on Threads");
    });

    it("rejects platform='facebook' via Zod", () => {
      const parse = z
        .object(contentPublishArgsSchema)
        .safeParse({ platform: "facebook" });
      expect(parse.success).toBe(false);
    });

    it("rejects content_type='reel' via Zod", () => {
      const parse = z
        .object(contentPublishArgsSchema)
        .safeParse({ content_type: "reel" });
      expect(parse.success).toBe(false);
    });
  });

  describe("analytics_report handler", () => {
    it("defaults: time_range=7d, both platforms, all read tools", () => {
      const { byName } = captureRegistrations();
      const text = renderPrompt(byName.get("analytics_report"), {});

      expect(text).toContain("Instagram and Threads");
      expect(text).toContain(PROMPT_TOOL_NAMES.IG_GET_PROFILE);
      expect(text).toContain(PROMPT_TOOL_NAMES.IG_GET_ACCOUNT_INSIGHTS);
      expect(text).toContain(PROMPT_TOOL_NAMES.IG_GET_MEDIA_LIST);
      expect(text).toContain(PROMPT_TOOL_NAMES.THREADS_GET_PROFILE);
      expect(text).toContain(PROMPT_TOOL_NAMES.THREADS_GET_USER_INSIGHTS);
      expect(text).toContain(PROMPT_TOOL_NAMES.THREADS_GET_POSTS);
      expect(text).toContain("the last 7 days");
    });

    it("when platform=instagram, omits Threads tools and keeps the v22 metric note", () => {
      const { byName } = captureRegistrations();
      const text = renderPrompt(byName.get("analytics_report"), {
        platform: "instagram",
      });

      expect(text).toContain(PROMPT_TOOL_NAMES.IG_GET_PROFILE);
      expect(text).toContain(PROMPT_TOOL_NAMES.IG_GET_ACCOUNT_INSIGHTS);
      expect(text).not.toContain(PROMPT_TOOL_NAMES.THREADS_GET_PROFILE);
      expect(text).not.toContain(PROMPT_TOOL_NAMES.THREADS_GET_USER_INSIGHTS);
      expect(text).toContain("Graph API v22.0");
    });

    it("when platform=threads, omits Instagram tools and the v22 metric note", () => {
      const { byName } = captureRegistrations();
      const text = renderPrompt(byName.get("analytics_report"), {
        platform: "threads",
      });

      expect(text).toContain("Threads");
      expect(text).not.toContain("Instagram");
      expect(text).toContain(PROMPT_TOOL_NAMES.THREADS_GET_PROFILE);
      expect(text).not.toContain(PROMPT_TOOL_NAMES.IG_GET_PROFILE);
      expect(text).not.toContain("Graph API v22.0");
    });

    it("substitutes time_range=30d into the insights description", () => {
      const { byName } = captureRegistrations();
      const text = renderPrompt(byName.get("analytics_report"), {
        time_range: "30d",
      });

      expect(text).toContain("the last 30 days");
      expect(text).not.toContain("the last 7 days");
    });

    it("substitutes time_range=90d into the insights description", () => {
      const { byName } = captureRegistrations();
      const text = renderPrompt(byName.get("analytics_report"), {
        time_range: "90d",
      });

      expect(text).toContain("the last 90 days");
      expect(text).not.toContain("the last 7 days");
    });

    it("when focus=engagement, prepends a focus directive", () => {
      const { byName } = captureRegistrations();
      const text = renderPrompt(byName.get("analytics_report"), {
        focus: "engagement",
      });

      expect(text).toContain(
        "Pay particular attention to engagement metrics",
      );
    });

    it("rejects time_range='1y' via Zod", () => {
      const parse = z
        .object(analyticsReportArgsSchema)
        .safeParse({ time_range: "1y" });
      expect(parse.success).toBe(false);
    });

    it("rejects focus='followers' via Zod", () => {
      const parse = z
        .object(analyticsReportArgsSchema)
        .safeParse({ focus: "followers" });
      expect(parse.success).toBe(false);
    });
  });
});
