import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { registerThreadsPublishingTools, topicTagSchema, shareToIgStorySchema, pollOptionsSchema, textAttachmentStylingSchema } from "./publishing.js";
import { MetaClient } from "../../services/meta-client.js";

// Mirror the gif_provider schema used in threads_publish_text
const gifProviderSchema = z.enum(["GIPHY"]).optional();

describe("gif_provider schema", () => {
  it("accepts GIPHY", () => {
    expect(gifProviderSchema.parse("GIPHY")).toBe("GIPHY");
  });

  it("rejects TENOR (sunset March 31, 2026)", () => {
    expect(() => gifProviderSchema.parse("TENOR")).toThrow();
  });

  it("accepts undefined (optional)", () => {
    expect(gifProviderSchema.parse(undefined)).toBeUndefined();
  });
});

// ─── topic_tag parameter forwarding tests ───────────────────────

/** Lightweight mock server for param-forwarding tests */
function makeMockServer() {
  const tools = new Map<string, (...args: unknown[]) => unknown>();
  return {
    tools,
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (...args: unknown[]) => unknown) => {
      tools.set(name, handler);
    }),
  };
}

function makeParamMockClient(): MetaClient {
  return {
    threadsUserId: "threads-123",
    threads: vi.fn(async () => ({
      data: { id: "container-1", status: "FINISHED" },
      rateLimit: undefined,
    })),
  } as unknown as MetaClient;
}

describe("threads_publish_text topic_tag", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerThreadsPublishingTools(server as never, client);
  });

  it("includes topic_tag in container creation params", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    await handler({ text: "Hello", topic_tag: "Pets" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[0]).toBe("POST");
    expect(createCall[2]).toHaveProperty("topic_tag", "Pets");
  });

  it("excludes topic_tag when not provided", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    await handler({ text: "Hello" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).not.toHaveProperty("topic_tag");
  });
});

describe("threads_publish_image topic_tag", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerThreadsPublishingTools(server as never, client);
  });

  it("includes topic_tag in container creation params", async () => {
    const handler = server.tools.get("threads_publish_image")!;
    await handler({ image_url: "https://example.com/photo.jpg", topic_tag: "Photography" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[0]).toBe("POST");
    expect(createCall[2]).toHaveProperty("topic_tag", "Photography");
  });

  it("excludes topic_tag when not provided", async () => {
    const handler = server.tools.get("threads_publish_image")!;
    await handler({ image_url: "https://example.com/photo.jpg" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).not.toHaveProperty("topic_tag");
  });
});

describe("threads_publish_video topic_tag", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerThreadsPublishingTools(server as never, client);
  });

  it("includes topic_tag in container creation params", async () => {
    const handler = server.tools.get("threads_publish_video")!;
    await handler({ video_url: "https://example.com/video.mp4", topic_tag: "Travel" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[0]).toBe("POST");
    expect(createCall[2]).toHaveProperty("topic_tag", "Travel");
  });

  it("excludes topic_tag when not provided", async () => {
    const handler = server.tools.get("threads_publish_video")!;
    await handler({ video_url: "https://example.com/video.mp4" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).not.toHaveProperty("topic_tag");
  });
});

describe("threads_publish_carousel topic_tag", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerThreadsPublishingTools(server as never, client);
  });

  it("includes topic_tag in carousel container creation params", async () => {
    const handler = server.tools.get("threads_publish_carousel")!;
    await handler({
      items: [
        { type: "IMAGE", url: "https://example.com/1.jpg" },
        { type: "IMAGE", url: "https://example.com/2.jpg" },
      ],
      topic_tag: "Travel",
    });

    const calls = (client.threads as ReturnType<typeof vi.fn>).mock.calls;
    const carouselCreateCall = calls.find(
      (c: unknown[]) => (c[2] as Record<string, unknown>)?.media_type === "CAROUSEL"
    );
    expect(carouselCreateCall).toBeDefined();
    expect(carouselCreateCall![2]).toHaveProperty("topic_tag", "Travel");
  });

  it("excludes topic_tag from carousel container when not provided", async () => {
    const handler = server.tools.get("threads_publish_carousel")!;
    await handler({
      items: [
        { type: "IMAGE", url: "https://example.com/1.jpg" },
        { type: "IMAGE", url: "https://example.com/2.jpg" },
      ],
    });

    const calls = (client.threads as ReturnType<typeof vi.fn>).mock.calls;
    const carouselCreateCall = calls.find(
      (c: unknown[]) => (c[2] as Record<string, unknown>)?.media_type === "CAROUSEL"
    );
    expect(carouselCreateCall).toBeDefined();
    expect(carouselCreateCall![2]).not.toHaveProperty("topic_tag");
  });
});

describe("threads_publish_carousel waits for carousel container", () => {
  let server: ReturnType<typeof makeMockServer>;

  it("calls waitForThreadsContainer on the carousel container before publishing", async () => {
    server = makeMockServer();
    const calls: Array<[string, string, Record<string, unknown>?]> = [];
    const client = {
      threadsUserId: "threads-123",
      threads: vi.fn(async (method: string, path: string, params?: Record<string, unknown>) => {
        calls.push([method, path, params]);
        // Child container creation or carousel container creation → return id
        if (method === "POST" && path.includes("/threads") && !path.includes("threads_publish")) {
          return { data: { id: `container-${calls.length}` }, rateLimit: undefined };
        }
        // GET status poll → FINISHED
        if (method === "GET") {
          return { data: { status: "FINISHED" }, rateLimit: undefined };
        }
        // Publish
        return { data: { id: "published-1" }, rateLimit: undefined };
      }),
    } as unknown as MetaClient;

    registerThreadsPublishingTools(server as never, client);
    const handler = server.tools.get("threads_publish_carousel")!;
    await handler({
      items: [
        { type: "IMAGE", url: "https://example.com/1.jpg" },
        { type: "IMAGE", url: "https://example.com/2.jpg" },
      ],
    });

    // Calls should be:
    // 1. POST child 1 container
    // 2. GET child 1 status (wait)
    // 3. POST child 2 container
    // 4. GET child 2 status (wait)
    // 5. POST carousel container
    // 6. GET carousel status (wait) ← THIS IS THE FIX
    // 7. POST publish
    expect(calls).toHaveLength(7);
    expect(calls[4][2]).toHaveProperty("media_type", "CAROUSEL");
    // The GET after carousel creation is the wait poll
    expect(calls[5][0]).toBe("GET");
    expect(calls[5][1]).toContain("container-5");
    // Final call is the publish
    expect(calls[6][0]).toBe("POST");
    expect(calls[6][1]).toContain("threads_publish");
  });
});

describe("threads_get_container_status error handling", () => {
  let server: ReturnType<typeof makeMockServer>;

  it("returns helpful message when called with a published post ID", async () => {
    server = makeMockServer();
    const client = {
      threadsUserId: "threads-123",
      threads: vi.fn(async () => {
        throw new Error("Tried accessing nonexisting field (status)");
      }),
    } as unknown as MetaClient;

    registerThreadsPublishingTools(server as never, client);
    const handler = server.tools.get("threads_get_container_status")!;
    const result = await handler({ container_id: "published-post-123" }) as { content: Array<{ text: string }>; isError: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("published post");
    expect(result.content[0].text).toContain("unpublished container");
  });

  it("returns generic error for other failures", async () => {
    server = makeMockServer();
    const client = {
      threadsUserId: "threads-123",
      threads: vi.fn(async () => {
        throw new Error("Some other API error");
      }),
    } as unknown as MetaClient;

    registerThreadsPublishingTools(server as never, client);
    const handler = server.tools.get("threads_get_container_status")!;
    const result = await handler({ container_id: "bad-id" }) as { content: Array<{ text: string }>; isError: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Get container status failed");
    expect(result.content[0].text).toContain("Some other API error");
  });
});

describe("topic_tag schema validation", () => {
  // Uses the exported topicTagSchema from publishing.ts (with .optional() unwrapped)
  const schema = topicTagSchema.unwrap();

  it("accepts valid simple tag", () => {
    expect(schema.parse("Pets")).toBe("Pets");
  });

  it("accepts valid tag with spaces", () => {
    expect(schema.parse("Dogs of Threads")).toBe("Dogs of Threads");
  });

  it("accepts single character tag", () => {
    expect(schema.parse("A")).toBe("A");
  });

  it("rejects tags with periods", () => {
    expect(() => schema.parse("test.tag")).toThrow();
  });

  it("rejects tags with ampersands", () => {
    expect(() => schema.parse("Arts & Crafts")).toThrow();
  });

  it("rejects empty string", () => {
    expect(() => schema.parse("")).toThrow();
  });

  it("rejects strings exceeding 50 chars", () => {
    expect(() => schema.parse("a".repeat(51))).toThrow();
  });
});

// ─── share_to_ig_story schema validation ──────────────────────────

describe("shareToIgStorySchema validation", () => {
  const schema = shareToIgStorySchema;

  it("accepts 'light'", () => {
    expect(schema.parse("light")).toBe("light");
  });

  it("accepts 'dark'", () => {
    expect(schema.parse("dark")).toBe("dark");
  });

  it("accepts undefined (optional)", () => {
    expect(schema.parse(undefined)).toBeUndefined();
  });

  it("rejects invalid values", () => {
    expect(() => schema.parse("auto")).toThrow();
  });
});

// ─── share_to_ig_story parameter forwarding tests ─────────────────

describe("threads_publish_text share_to_ig_story", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerThreadsPublishingTools(server as never, client);
  });

  it("includes crossreshare_to_ig when share_to_ig_story is 'light'", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    await handler({ text: "Hello", share_to_ig_story: "light" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).toHaveProperty("crossreshare_to_ig", true);
    expect(createCall[2]).not.toHaveProperty("crossreshare_to_ig_dark_mode");
  });

  it("includes both crossreshare params when share_to_ig_story is 'dark'", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    await handler({ text: "Hello", share_to_ig_story: "dark" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).toHaveProperty("crossreshare_to_ig", true);
    expect(createCall[2]).toHaveProperty("crossreshare_to_ig_dark_mode", true);
  });

  it("excludes cross-share params when share_to_ig_story not provided", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    await handler({ text: "Hello" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).not.toHaveProperty("crossreshare_to_ig");
    expect(createCall[2]).not.toHaveProperty("crossreshare_to_ig_dark_mode");
  });
});

describe("threads_publish_image share_to_ig_story", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerThreadsPublishingTools(server as never, client);
  });

  it("includes crossreshare_to_ig when share_to_ig_story is 'light'", async () => {
    const handler = server.tools.get("threads_publish_image")!;
    await handler({ image_url: "https://example.com/photo.jpg", share_to_ig_story: "light" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).toHaveProperty("crossreshare_to_ig", true);
    expect(createCall[2]).not.toHaveProperty("crossreshare_to_ig_dark_mode");
  });

  it("includes both crossreshare params when share_to_ig_story is 'dark'", async () => {
    const handler = server.tools.get("threads_publish_image")!;
    await handler({ image_url: "https://example.com/photo.jpg", share_to_ig_story: "dark" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).toHaveProperty("crossreshare_to_ig", true);
    expect(createCall[2]).toHaveProperty("crossreshare_to_ig_dark_mode", true);
  });

  it("excludes cross-share params when not provided", async () => {
    const handler = server.tools.get("threads_publish_image")!;
    await handler({ image_url: "https://example.com/photo.jpg" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).not.toHaveProperty("crossreshare_to_ig");
    expect(createCall[2]).not.toHaveProperty("crossreshare_to_ig_dark_mode");
  });
});

describe("threads_publish_video share_to_ig_story", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerThreadsPublishingTools(server as never, client);
  });

  it("includes crossreshare_to_ig when share_to_ig_story is 'light'", async () => {
    const handler = server.tools.get("threads_publish_video")!;
    await handler({ video_url: "https://example.com/video.mp4", share_to_ig_story: "light" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).toHaveProperty("crossreshare_to_ig", true);
    expect(createCall[2]).not.toHaveProperty("crossreshare_to_ig_dark_mode");
  });

  it("includes both crossreshare params when share_to_ig_story is 'dark'", async () => {
    const handler = server.tools.get("threads_publish_video")!;
    await handler({ video_url: "https://example.com/video.mp4", share_to_ig_story: "dark" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).toHaveProperty("crossreshare_to_ig", true);
    expect(createCall[2]).toHaveProperty("crossreshare_to_ig_dark_mode", true);
  });

  it("excludes cross-share params when not provided", async () => {
    const handler = server.tools.get("threads_publish_video")!;
    await handler({ video_url: "https://example.com/video.mp4" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).not.toHaveProperty("crossreshare_to_ig");
    expect(createCall[2]).not.toHaveProperty("crossreshare_to_ig_dark_mode");
  });
});

describe("threads_publish_carousel share_to_ig_story", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerThreadsPublishingTools(server as never, client);
  });

  const twoItems = [
    { type: "IMAGE", url: "https://example.com/1.jpg" },
    { type: "IMAGE", url: "https://example.com/2.jpg" },
  ];

  it("includes crossreshare_to_ig on carousel container when share_to_ig_story is 'light'", async () => {
    const handler = server.tools.get("threads_publish_carousel")!;
    await handler({ items: twoItems, share_to_ig_story: "light" });

    const calls = (client.threads as ReturnType<typeof vi.fn>).mock.calls;
    const carouselCreateCall = calls.find(
      (c: unknown[]) => (c[2] as Record<string, unknown>)?.media_type === "CAROUSEL"
    );
    expect(carouselCreateCall).toBeDefined();
    expect(carouselCreateCall![2]).toHaveProperty("crossreshare_to_ig", true);
    expect(carouselCreateCall![2]).not.toHaveProperty("crossreshare_to_ig_dark_mode");
  });

  it("includes both crossreshare params on carousel container when share_to_ig_story is 'dark'", async () => {
    const handler = server.tools.get("threads_publish_carousel")!;
    await handler({ items: twoItems, share_to_ig_story: "dark" });

    const calls = (client.threads as ReturnType<typeof vi.fn>).mock.calls;
    const carouselCreateCall = calls.find(
      (c: unknown[]) => (c[2] as Record<string, unknown>)?.media_type === "CAROUSEL"
    );
    expect(carouselCreateCall).toBeDefined();
    expect(carouselCreateCall![2]).toHaveProperty("crossreshare_to_ig", true);
    expect(carouselCreateCall![2]).toHaveProperty("crossreshare_to_ig_dark_mode", true);
  });

  it("excludes cross-share params from carousel container when not provided", async () => {
    const handler = server.tools.get("threads_publish_carousel")!;
    await handler({ items: twoItems });

    const calls = (client.threads as ReturnType<typeof vi.fn>).mock.calls;
    const carouselCreateCall = calls.find(
      (c: unknown[]) => (c[2] as Record<string, unknown>)?.media_type === "CAROUSEL"
    );
    expect(carouselCreateCall).toBeDefined();
    expect(carouselCreateCall![2]).not.toHaveProperty("crossreshare_to_ig");
    expect(carouselCreateCall![2]).not.toHaveProperty("crossreshare_to_ig_dark_mode");
  });

  it("does not add cross-share params to child containers", async () => {
    const handler = server.tools.get("threads_publish_carousel")!;
    await handler({ items: twoItems, share_to_ig_story: "dark" });

    const calls = (client.threads as ReturnType<typeof vi.fn>).mock.calls;
    const childCalls = calls.filter(
      (c: unknown[]) => (c[2] as Record<string, unknown>)?.is_carousel_item === true
    );
    expect(childCalls).toHaveLength(2);
    for (const call of childCalls) {
      expect(call[2]).not.toHaveProperty("crossreshare_to_ig");
      expect(call[2]).not.toHaveProperty("crossreshare_to_ig_dark_mode");
    }
  });
});

// ─── poll_attachment format tests ─────────────────────────────────

describe("threads_publish_text poll_attachment format", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerThreadsPublishingTools(server as never, client);
  });

  it("sends option_a/option_b keys for 2 options", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    await handler({ text: "Vote!", poll_options: ["Yes", "No"] });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2].poll_attachment).toBe(JSON.stringify({ option_a: "Yes", option_b: "No" }));
  });

  it("sends option_a through option_c for 3 options", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    await handler({ text: "Pick", poll_options: ["A", "B", "C"] });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    const parsed = JSON.parse(createCall[2].poll_attachment as string);
    expect(parsed).toEqual({ option_a: "A", option_b: "B", option_c: "C" });
    expect(parsed).not.toHaveProperty("option_d");
  });

  it("sends option_a through option_d for 4 options", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    await handler({ text: "Pick", poll_options: ["A", "B", "C", "D"] });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2].poll_attachment).toBe(
      JSON.stringify({ option_a: "A", option_b: "B", option_c: "C", option_d: "D" })
    );
  });

  it("excludes poll_attachment when poll_options not provided", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    await handler({ text: "Hello" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).not.toHaveProperty("poll_attachment");
  });
});

// ─── pollOptionsSchema validation tests ───────────────────────────

describe("pollOptionsSchema validation", () => {
  const schema = pollOptionsSchema;

  it("accepts 2 valid options", () => {
    expect(schema.parse(["Yes", "No"])).toEqual(["Yes", "No"]);
  });

  it("accepts 4 valid options", () => {
    expect(schema.parse(["A", "B", "C", "D"])).toEqual(["A", "B", "C", "D"]);
  });

  it("accepts undefined (optional)", () => {
    expect(schema.parse(undefined)).toBeUndefined();
  });

  it("accepts option with exactly 25 chars", () => {
    expect(schema.parse(["Valid", "a".repeat(25)])).toEqual(["Valid", "a".repeat(25)]);
  });

  it("rejects option longer than 25 chars", () => {
    expect(() => schema.parse(["Valid", "a".repeat(26)])).toThrow();
  });

  it("rejects empty option string", () => {
    expect(() => schema.parse(["Valid", ""])).toThrow();
  });

  it("rejects fewer than 2 options", () => {
    expect(() => schema.parse(["Only one"])).toThrow();
  });

  it("rejects more than 4 options", () => {
    expect(() => schema.parse(["A", "B", "C", "D", "E"])).toThrow();
  });
});

// ─── text_attachment tests ──────────────────────────────────────────

describe("threads_publish_text text_attachment serialization", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerThreadsPublishingTools(server as never, client);
  });

  it("serializes plaintext-only text_attachment as JSON", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    await handler({ text: "Hello", text_attachment: "Long form content here" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2].text_attachment).toBe(JSON.stringify({ plaintext: "Long form content here" }));
  });

  it("serializes text_attachment with link_attachment_url", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    await handler({ text: "Hello", text_attachment: "Read more", text_attachment_link: "https://example.com/article" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    const parsed = JSON.parse(createCall[2].text_attachment as string);
    expect(parsed).toEqual({
      plaintext: "Read more",
      link_attachment_url: "https://example.com/article",
    });
  });

  it("serializes text_attachment with styling info", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    await handler({
      text: "Hello",
      text_attachment: "Bold and italic text",
      text_attachment_styling: [
        { offset: 0, length: 4, styles: ["bold"] },
        { offset: 9, length: 6, styles: ["italic"] },
      ],
    });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    const parsed = JSON.parse(createCall[2].text_attachment as string);
    expect(parsed).toEqual({
      plaintext: "Bold and italic text",
      text_with_styling_info: [
        { offset: 0, length: 4, styling_info: ["bold"] },
        { offset: 9, length: 6, styling_info: ["italic"] },
      ],
    });
  });

  it("serializes text_attachment with all sub-fields", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    await handler({
      text: "Hello",
      text_attachment: "Full featured text",
      text_attachment_link: "https://example.com",
      text_attachment_styling: [{ offset: 0, length: 4, styles: ["bold", "underline"] }],
    });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    const parsed = JSON.parse(createCall[2].text_attachment as string);
    expect(parsed).toEqual({
      plaintext: "Full featured text",
      link_attachment_url: "https://example.com",
      text_with_styling_info: [{ offset: 0, length: 4, styling_info: ["bold", "underline"] }],
    });
  });

  it("excludes text_attachment when not provided", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    await handler({ text: "Hello" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).not.toHaveProperty("text_attachment");
  });
});

describe("threads_publish_text text_attachment mutual exclusion", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerThreadsPublishingTools(server as never, client);
  });

  it("rejects text_attachment + poll_options", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    const result = await handler({ text: "Hello", text_attachment: "Long text", poll_options: ["Yes", "No"] }) as { content: Array<{ text: string }>; isError: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("text_attachment cannot be combined with poll_options");
    expect(client.threads).not.toHaveBeenCalled();
  });

  it("rejects text_attachment + link_attachment", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    const result = await handler({ text: "Hello", text_attachment: "Long text", link_attachment: "https://example.com" }) as { content: Array<{ text: string }>; isError: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("text_attachment cannot be combined with link_attachment");
    expect(client.threads).not.toHaveBeenCalled();
  });

  it("rejects text_attachment_link without text_attachment", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    const result = await handler({ text: "Hello", text_attachment_link: "https://example.com" }) as { content: Array<{ text: string }>; isError: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("text_attachment_link requires text_attachment");
    expect(client.threads).not.toHaveBeenCalled();
  });

  it("rejects text_attachment_styling without text_attachment", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    const result = await handler({ text: "Hello", text_attachment_styling: [{ offset: 0, length: 5, styles: ["bold"] }] }) as { content: Array<{ text: string }>; isError: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("text_attachment_styling requires text_attachment");
    expect(client.threads).not.toHaveBeenCalled();
  });

  it("rejects overlapping styling ranges", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    const result = await handler({
      text: "Hello",
      text_attachment: "Overlapping styles",
      text_attachment_styling: [
        { offset: 0, length: 10, styles: ["bold"] },
        { offset: 5, length: 8, styles: ["italic"] },
      ],
    }) as { content: Array<{ text: string }>; isError: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("must not overlap");
    expect(client.threads).not.toHaveBeenCalled();
  });

  it("accepts non-overlapping adjacent styling ranges", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    await handler({
      text: "Hello",
      text_attachment: "Adjacent styles here",
      text_attachment_styling: [
        { offset: 0, length: 8, styles: ["bold"] },
        { offset: 8, length: 6, styles: ["italic"] },
      ],
    });

    expect(client.threads).toHaveBeenCalled();
  });

  it("rejects styling range exceeding text_attachment length", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    const result = await handler({
      text: "Hello",
      text_attachment: "Short",
      text_attachment_styling: [{ offset: 0, length: 50, styles: ["bold"] }],
    }) as { content: Array<{ text: string }>; isError: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("exceeds text_attachment length");
    expect(client.threads).not.toHaveBeenCalled();
  });

  it("rejects styling range where offset is beyond text_attachment end", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    const result = await handler({
      text: "Hello",
      text_attachment: "Short",
      text_attachment_styling: [{ offset: 10, length: 2, styles: ["bold"] }],
    }) as { content: Array<{ text: string }>; isError: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("exceeds text_attachment length");
    expect(client.threads).not.toHaveBeenCalled();
  });
});

// ─── text_attachment char→byte offset conversion ────────────────────

describe("threads_publish_text text_attachment byte offset conversion", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerThreadsPublishingTools(server as never, client);
  });

  it("converts Cyrillic character offsets to UTF-8 byte offsets", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    // "Жирный" = 6 chars / 12 bytes; " и " = 3 chars / 4 bytes (space+и+space = 1+2+1); "курсив" = 6 chars / 12 bytes
    await handler({
      text: "Hello",
      text_attachment: "Жирный и курсив",
      text_attachment_styling: [
        { offset: 0, length: 6, styles: ["bold"] },       // "Жирный" → byte 0, byte len 12
        { offset: 9, length: 6, styles: ["italic"] },     // "курсив" → byte 16, byte len 12
      ],
    });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    const parsed = JSON.parse(createCall[2].text_attachment as string);
    expect(parsed.text_with_styling_info).toEqual([
      { offset: 0, length: 12, styling_info: ["bold"] },
      { offset: 16, length: 12, styling_info: ["italic"] },
    ]);
  });

  it("keeps ASCII offsets unchanged (1 byte per char)", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    await handler({
      text: "Hello",
      text_attachment: "Bold and italic text",
      text_attachment_styling: [
        { offset: 0, length: 4, styles: ["bold"] },
        { offset: 9, length: 6, styles: ["italic"] },
      ],
    });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    const parsed = JSON.parse(createCall[2].text_attachment as string);
    expect(parsed.text_with_styling_info).toEqual([
      { offset: 0, length: 4, styling_info: ["bold"] },
      { offset: 9, length: 6, styling_info: ["italic"] },
    ]);
  });

  it("handles emoji offsets correctly (4 bytes per emoji)", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    // "🔥Hot" = "🔥" is 1 char (length 2 in JS) + "Hot" 3 chars
    await handler({
      text: "Hello",
      text_attachment: "🔥Hot stuff",
      text_attachment_styling: [
        { offset: 2, length: 3, styles: ["bold"] },     // "Hot" starts at char 2 (after 🔥 which is 2 JS chars)
      ],
    });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    const parsed = JSON.parse(createCall[2].text_attachment as string);
    // 🔥 = 4 bytes in UTF-8, so "Hot" starts at byte 4
    expect(parsed.text_with_styling_info).toEqual([
      { offset: 4, length: 3, styling_info: ["bold"] },
    ]);
  });
});

// ─── textAttachmentStylingSchema validation ─────────────────────────

describe("textAttachmentStylingSchema validation", () => {
  const schema = textAttachmentStylingSchema;

  it("accepts valid styling array", () => {
    const result = schema.parse([{ offset: 0, length: 5, styles: ["bold"] }]);
    expect(result).toEqual([{ offset: 0, length: 5, styles: ["bold"] }]);
  });

  it("accepts multiple styles per range", () => {
    const result = schema.parse([{ offset: 0, length: 5, styles: ["bold", "italic", "underline"] }]);
    expect(result![0].styles).toEqual(["bold", "italic", "underline"]);
  });

  it("accepts undefined (optional)", () => {
    expect(schema.parse(undefined)).toBeUndefined();
  });

  it("rejects invalid style name", () => {
    expect(() => schema.parse([{ offset: 0, length: 5, styles: ["comic-sans"] }])).toThrow();
  });

  it("rejects empty styles array", () => {
    expect(() => schema.parse([{ offset: 0, length: 5, styles: [] }])).toThrow();
  });

  it("rejects negative offset", () => {
    expect(() => schema.parse([{ offset: -1, length: 5, styles: ["bold"] }])).toThrow();
  });

  it("rejects zero length", () => {
    expect(() => schema.parse([{ offset: 0, length: 0, styles: ["bold"] }])).toThrow();
  });
});

describe("threads_repost", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerThreadsPublishingTools(server as never, client);
  });

  it("calls POST /{post_id}/repost with empty body", async () => {
    const handler = server.tools.get("threads_repost")!;
    await handler({ post_id: "post-77" });

    const call = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("POST");
    expect(call[1]).toBe("/post-77/repost");
    expect(call[2]).toEqual({});
  });

  it("returns repost id from API response", async () => {
    const repostClient = {
      threadsUserId: "threads-123",
      threads: vi.fn(async () => ({
        data: { id: "repost-999" },
        rateLimit: undefined,
      })),
    } as unknown as MetaClient;

    const localServer = makeMockServer();
    registerThreadsPublishingTools(localServer as never, repostClient);
    const handler = localServer.tools.get("threads_repost")!;
    const result = await handler({ post_id: "post-77" }) as { content: Array<{ text: string }> };

    expect(result.content[0].text).toContain("repost-999");
  });
});
