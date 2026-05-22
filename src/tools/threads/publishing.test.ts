import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { registerThreadsPublishingTools, topicTagSchema, shareToIgStorySchema, pollOptionsSchema, textAttachmentStylingSchema, allowlistedCountryCodesSchema } from "./publishing.js";
import { MetaClient, HttpMethod } from "../../services/meta-client.js";

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
    registerTool: vi.fn((name: string, _config: unknown, handler: (...args: unknown[]) => unknown) => {
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
      threads: vi.fn(async (method: HttpMethod, path: string, params?: Record<string, unknown>) => {
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

    // Children are created in parallel via Promise.all:
    // 0. POST child 1 container → container-1
    // 1. POST child 2 container → container-2
    // 2. GET child 1 status (wait) → FINISHED
    // 3. GET child 2 status (wait) → FINISHED
    // 4. POST carousel container → container-5
    // 5. GET carousel status (wait) ← regression guard for the carousel poll fix
    // 6. POST publish
    expect(calls).toHaveLength(7);
    expect(calls[4][2]).toHaveProperty("media_type", "CAROUSEL");
    // The GET after carousel creation is the wait poll
    expect(calls[5][0]).toBe("GET");
    expect(calls[5][1]).toContain("container-5");
    // Final call is the publish
    expect(calls[6][0]).toBe("POST");
    expect(calls[6][1]).toContain("threads_publish");
  });

  it("creates child containers in parallel (all child POSTs precede polls)", async () => {
    server = makeMockServer();
    const client = makeParamMockClient();
    registerThreadsPublishingTools(server as never, client);
    const handler = server.tools.get("threads_publish_carousel")!;
    await handler({
      items: [
        { type: "IMAGE", url: "https://example.com/1.jpg" },
        { type: "IMAGE", url: "https://example.com/2.jpg" },
        { type: "IMAGE", url: "https://example.com/3.jpg" },
      ],
    });

    const calls = (client.threads as ReturnType<typeof vi.fn>).mock.calls;
    // Parallel order: 3× POST child, 3× GET child-poll, POST parent, GET parent-poll, POST publish.
    // Sequential implementation would interleave POST/GET/POST/GET/POST/GET and fail this assertion.
    // Ordering is deterministic because vi.fn(async () => …) records the call synchronously on
    // entry and Array.map starts all three async callbacks before any await resumes.
    expect(calls).toHaveLength(9);
    expect(calls.slice(0, 3).every((c) => c[0] === "POST")).toBe(true);
    expect(calls.slice(3, 6).every((c) => c[0] === "GET")).toBe(true);
    expect(calls[6][0]).toBe("POST");
    expect(calls[7][0]).toBe("GET");
    expect(calls[8][0]).toBe("POST");
    expect(calls[8][1]).toContain("threads_publish");
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

// ─── gif_id / gif_provider co-dependency tests ──────────────────────

describe("threads_publish_text gif_id/gif_provider co-dependency", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerThreadsPublishingTools(server as never, client);
  });

  it("rejects gif_id without gif_provider", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    const result = await handler({ text: "Hello", gif_id: "abc123" }) as { content: Array<{ text: string }>; isError: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("gif_id and gif_provider must be provided together");
    expect(client.threads).not.toHaveBeenCalled();
  });

  it("rejects gif_provider without gif_id", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    const result = await handler({ text: "Hello", gif_provider: "GIPHY" }) as { content: Array<{ text: string }>; isError: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("gif_id and gif_provider must be provided together");
    expect(client.threads).not.toHaveBeenCalled();
  });

  it("accepts both gif_id and gif_provider together (sends gif_attachment)", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    await handler({ text: "Hello", gif_id: "abc123", gif_provider: "GIPHY" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2].gif_attachment).toBe(JSON.stringify({ gif_id: "abc123", provider: "GIPHY" }));
  });

  it("excludes gif_attachment when neither is provided", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    await handler({ text: "Hello" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).not.toHaveProperty("gif_attachment");
  });

  // Mirror the gif_id schema used in threads_publish_text to verify .min(1) rejects ""
  // before the handler-level co-dependency check sees an empty string and emits a
  // misleading "must be provided together" error.
  it("rejects empty gif_id at the schema level (.min(1))", () => {
    const gifIdSchema = z.string().min(1).optional();
    expect(() => gifIdSchema.parse("")).toThrow();
  });
});

// ─── attachment mutual exclusion + alt_text dependency (#185) ───────

describe("threads_publish_text attachment mutual exclusion", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerThreadsPublishingTools(server as never, client);
  });

  it("rejects gif + text_attachment", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    const result = await handler({
      text: "Hello",
      gif_id: "abc123",
      gif_provider: "GIPHY",
      text_attachment: "Long form content",
    }) as { content: Array<{ text: string }>; isError: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("GIF attachment cannot be combined with");
    expect(client.threads).not.toHaveBeenCalled();
  });

  it("rejects gif + poll_options", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    const result = await handler({
      text: "Hello",
      gif_id: "abc123",
      gif_provider: "GIPHY",
      poll_options: ["Yes", "No"],
    }) as { content: Array<{ text: string }>; isError: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("GIF attachment cannot be combined with");
    expect(client.threads).not.toHaveBeenCalled();
  });

  it("rejects gif + link_attachment", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    const result = await handler({
      text: "Hello",
      gif_id: "abc123",
      gif_provider: "GIPHY",
      link_attachment: "https://example.com",
    }) as { content: Array<{ text: string }>; isError: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("GIF attachment cannot be combined with");
    expect(client.threads).not.toHaveBeenCalled();
  });

  it("rejects poll_options + link_attachment", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    const result = await handler({
      text: "Hello",
      poll_options: ["Yes", "No"],
      link_attachment: "https://example.com",
    }) as { content: Array<{ text: string }>; isError: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("poll_options cannot be combined with link_attachment");
    expect(client.threads).not.toHaveBeenCalled();
  });
});

// ─── alt_text rejection at the Zod schema level (#185 follow-up) ───
//
// v5.0.0 (#185) removed alt_text from the threads_publish_text schema and
// claimed callers would now get a Zod schema error. The raw shape registered
// without it was fine, but z.object() defaults to .strip() — so unknown keys
// were silently dropped instead of throwing. This block locks in the explicit
// rejection: alt_text declared as z.never("…").optional() so omitting passes
// while passing any value triggers a descriptive Zod issue.

describe("threads_publish_text alt_text rejection at the schema level", () => {
  let server: ReturnType<typeof makeMockServer>;

  beforeEach(() => {
    server = makeMockServer();
    registerThreadsPublishingTools(server as never, makeParamMockClient());
  });

  function getTextSchema(): z.ZodObject<z.ZodRawShape> {
    const call = (server.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(c => c[0] === "threads_publish_text");
    if (!call) throw new Error("threads_publish_text was not registered");
    const config = call[1] as { inputSchema?: z.ZodRawShape };
    return z.object(config.inputSchema ?? {});
  }

  it("rejects alt_text with a descriptive message that points to the right tools", () => {
    const result = getTextSchema().safeParse({ text: "Hello", alt_text: "image description" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["alt_text"]);
      expect(result.error.issues[0].message).toContain("alt_text is not supported on text-only Threads posts");
      expect(result.error.issues[0].message).toContain("threads_publish_image");
    }
  });

  it("accepts the call when alt_text is omitted", () => {
    expect(getTextSchema().safeParse({ text: "Hello" }).success).toBe(true);
  });

  it("accepts the call when alt_text is explicitly undefined", () => {
    expect(getTextSchema().safeParse({ text: "Hello", alt_text: undefined }).success).toBe(true);
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

// ─── auto_publish (auto_publish_text=true shortcut) ─────────────────

describe("threads_publish_text auto_publish", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerThreadsPublishingTools(server as never, client);
  });

  it("sends auto_publish_text=true and makes a single API call by default", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    await handler({ text: "Hello" });

    const calls = (client.threads as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("POST");
    expect(calls[0][1]).toBe("/threads-123/threads");
    expect(calls[0][2]).toHaveProperty("auto_publish_text", true);
  });

  it("omits auto_publish_text and makes two calls when auto_publish=false", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    await handler({ text: "Hello", auto_publish: false });

    const calls = (client.threads as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][2]).not.toHaveProperty("auto_publish_text");
    expect(calls[1][0]).toBe("POST");
    expect(calls[1][1]).toBe("/threads-123/threads_publish");
    expect(calls[1][2]).toHaveProperty("creation_id", "container-1");
  });

  it("keeps auto_publish_text=true alongside advanced params (poll, topic_tag)", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    await handler({
      text: "Vote!",
      poll_options: ["Yes", "No"],
      topic_tag: "Polls",
    });

    const calls = (client.threads as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][2]).toHaveProperty("auto_publish_text", true);
    expect(calls[0][2]).toHaveProperty("poll_attachment");
    expect(calls[0][2]).toHaveProperty("topic_tag", "Polls");
  });

  it("returns the id from the single-call response (treated as the published post id)", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    const result = await handler({ text: "Hello" }) as { content: Array<{ text: string }> };
    expect(result.content[0].text).toContain("container-1");
  });
});

// ─── allowlistedCountryCodesSchema validation ──────────────────────

describe("allowlistedCountryCodesSchema validation", () => {
  const schema = allowlistedCountryCodesSchema;

  it("accepts a single valid uppercase code", () => {
    expect(schema.parse(["US"])).toEqual(["US"]);
  });

  it("accepts multiple valid codes", () => {
    expect(schema.parse(["US", "CA", "GB"])).toEqual(["US", "CA", "GB"]);
  });

  it("accepts lowercase codes (uppercased at send time, not at validation time)", () => {
    expect(schema.parse(["us", "ca"])).toEqual(["us", "ca"]);
  });

  it("accepts mixed-case codes", () => {
    expect(schema.parse(["uS", "Ca"])).toEqual(["uS", "Ca"]);
  });

  it("accepts undefined (optional)", () => {
    expect(schema.parse(undefined)).toBeUndefined();
  });

  it("rejects 1-letter codes", () => {
    expect(() => schema.parse(["U"])).toThrow();
  });

  it("rejects 3-letter codes (alpha-3 not supported)", () => {
    expect(() => schema.parse(["USA"])).toThrow();
  });

  it("rejects empty string", () => {
    expect(() => schema.parse([""])).toThrow();
  });

  it("rejects digits", () => {
    expect(() => schema.parse(["12"])).toThrow();
  });

  it("rejects empty array (use undefined to omit)", () => {
    expect(() => schema.parse([])).toThrow();
  });
});

// ─── allowlisted_country_codes parameter forwarding tests ──────────

describe("threads_publish_text allowlisted_country_codes", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerThreadsPublishingTools(server as never, client);
  });

  it("forwards codes as a comma-joined uppercased string (format-pinning test)", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    await handler({ text: "Hello", allowlisted_country_codes: ["US", "CA"] });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    // Pins the format to "US,CA" — guards against future refactors using JSON.stringify
    expect(createCall[2]).toHaveProperty("allowlisted_country_codes", "US,CA");
  });

  it("uppercases lowercase codes before sending", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    await handler({ text: "Hello", allowlisted_country_codes: ["us", "ca"] });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).toHaveProperty("allowlisted_country_codes", "US,CA");
  });

  it("excludes allowlisted_country_codes when not provided", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    await handler({ text: "Hello" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).not.toHaveProperty("allowlisted_country_codes");
  });

  it("works alongside auto_publish_text=true (single-call mode)", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    await handler({ text: "Hello", allowlisted_country_codes: ["GB"] });

    const calls = (client.threads as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][2]).toHaveProperty("auto_publish_text", true);
    expect(calls[0][2]).toHaveProperty("allowlisted_country_codes", "GB");
  });
});

describe("threads_publish_image allowlisted_country_codes", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerThreadsPublishingTools(server as never, client);
  });

  it("forwards codes as a comma-joined uppercased string", async () => {
    const handler = server.tools.get("threads_publish_image")!;
    await handler({ image_url: "https://example.com/photo.jpg", allowlisted_country_codes: ["US", "CA"] });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).toHaveProperty("allowlisted_country_codes", "US,CA");
  });

  it("excludes allowlisted_country_codes when not provided", async () => {
    const handler = server.tools.get("threads_publish_image")!;
    await handler({ image_url: "https://example.com/photo.jpg" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).not.toHaveProperty("allowlisted_country_codes");
  });
});

describe("threads_publish_video allowlisted_country_codes", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerThreadsPublishingTools(server as never, client);
  });

  it("forwards codes as a comma-joined uppercased string", async () => {
    const handler = server.tools.get("threads_publish_video")!;
    await handler({ video_url: "https://example.com/video.mp4", allowlisted_country_codes: ["us", "GB"] });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).toHaveProperty("allowlisted_country_codes", "US,GB");
  });

  it("excludes allowlisted_country_codes when not provided", async () => {
    const handler = server.tools.get("threads_publish_video")!;
    await handler({ video_url: "https://example.com/video.mp4" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).not.toHaveProperty("allowlisted_country_codes");
  });
});

describe("threads_publish_carousel allowlisted_country_codes", () => {
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

  it("forwards codes on the carousel parent container as a comma-joined uppercased string", async () => {
    const handler = server.tools.get("threads_publish_carousel")!;
    await handler({ items: twoItems, allowlisted_country_codes: ["US", "CA"] });

    const calls = (client.threads as ReturnType<typeof vi.fn>).mock.calls;
    const carouselCreateCall = calls.find(
      (c: unknown[]) => (c[2] as Record<string, unknown>)?.media_type === "CAROUSEL"
    );
    expect(carouselCreateCall).toBeDefined();
    expect(carouselCreateCall![2]).toHaveProperty("allowlisted_country_codes", "US,CA");
  });

  it("excludes allowlisted_country_codes from carousel container when not provided", async () => {
    const handler = server.tools.get("threads_publish_carousel")!;
    await handler({ items: twoItems });

    const calls = (client.threads as ReturnType<typeof vi.fn>).mock.calls;
    const carouselCreateCall = calls.find(
      (c: unknown[]) => (c[2] as Record<string, unknown>)?.media_type === "CAROUSEL"
    );
    expect(carouselCreateCall).toBeDefined();
    expect(carouselCreateCall![2]).not.toHaveProperty("allowlisted_country_codes");
  });

  it("does not add allowlisted_country_codes to child containers (parent only)", async () => {
    const handler = server.tools.get("threads_publish_carousel")!;
    await handler({ items: twoItems, allowlisted_country_codes: ["US", "CA"] });

    const calls = (client.threads as ReturnType<typeof vi.fn>).mock.calls;
    const childCalls = calls.filter(
      (c: unknown[]) => (c[2] as Record<string, unknown>)?.is_carousel_item === true
    );
    expect(childCalls).toHaveLength(2);
    for (const call of childCalls) {
      expect(call[2]).not.toHaveProperty("allowlisted_country_codes");
    }
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

describe("threads_publish_text location_id", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerThreadsPublishingTools(server as never, client);
  });

  it("includes location_id in container creation params", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    await handler({ text: "Hello", location_id: "12345" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[0]).toBe("POST");
    expect(createCall[2]).toHaveProperty("location_id", "12345");
  });

  it("excludes location_id when not provided", async () => {
    const handler = server.tools.get("threads_publish_text")!;
    await handler({ text: "Hello" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).not.toHaveProperty("location_id");
  });
});

describe("threads_publish_image location_id", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerThreadsPublishingTools(server as never, client);
  });

  it("includes location_id in container creation params", async () => {
    const handler = server.tools.get("threads_publish_image")!;
    await handler({ image_url: "https://example.com/photo.jpg", location_id: "12345" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[0]).toBe("POST");
    expect(createCall[2]).toHaveProperty("location_id", "12345");
  });

  it("excludes location_id when not provided", async () => {
    const handler = server.tools.get("threads_publish_image")!;
    await handler({ image_url: "https://example.com/photo.jpg" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).not.toHaveProperty("location_id");
  });
});

describe("threads_publish_video location_id", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerThreadsPublishingTools(server as never, client);
  });

  it("includes location_id in container creation params", async () => {
    const handler = server.tools.get("threads_publish_video")!;
    await handler({ video_url: "https://example.com/video.mp4", location_id: "12345" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[0]).toBe("POST");
    expect(createCall[2]).toHaveProperty("location_id", "12345");
  });

  it("excludes location_id when not provided", async () => {
    const handler = server.tools.get("threads_publish_video")!;
    await handler({ video_url: "https://example.com/video.mp4" });

    const createCall = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).not.toHaveProperty("location_id");
  });
});

describe("threads_publish_carousel location_id", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerThreadsPublishingTools(server as never, client);
  });

  it("includes location_id only on the parent CAROUSEL container, not on child containers", async () => {
    const handler = server.tools.get("threads_publish_carousel")!;
    await handler({
      items: [
        { type: "IMAGE", url: "https://example.com/1.jpg" },
        { type: "IMAGE", url: "https://example.com/2.jpg" },
      ],
      location_id: "12345",
    });

    const calls = (client.threads as ReturnType<typeof vi.fn>).mock.calls;
    const carouselCreateCall = calls.find(
      (c: unknown[]) => (c[2] as Record<string, unknown>)?.media_type === "CAROUSEL"
    );
    expect(carouselCreateCall).toBeDefined();
    expect(carouselCreateCall![2]).toHaveProperty("location_id", "12345");

    const childCalls = calls.filter(
      (c: unknown[]) => (c[2] as Record<string, unknown>)?.is_carousel_item === true
    );
    expect(childCalls).toHaveLength(2);
    for (const call of childCalls) {
      expect(call[2]).not.toHaveProperty("location_id");
    }
  });

  it("excludes location_id from parent container when not provided", async () => {
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
    expect(carouselCreateCall![2]).not.toHaveProperty("location_id");
  });
});

function makeParsingMockServer() {
  const tools = new Map<string, (...args: unknown[]) => unknown>();
  return {
    tools,
    registerTool: vi.fn((name: string, config: { inputSchema: z.ZodRawShape }, handler: (...args: unknown[]) => unknown) => {
      const parsed = z.object(config.inputSchema);
      tools.set(name, async (args: Record<string, unknown> = {}) => handler(parsed.parse(args)));
    }),
  };
}

describe("threads_search_locations", () => {
  function makeSearchClient(): MetaClient {
    return {
      threadsUserId: "threads-123",
      threads: vi.fn(async () => ({
        data: { data: [{ id: "12345", name: "Facebook HQ" }] },
        rateLimit: undefined,
      })),
    } as unknown as MetaClient;
  }

  it("calls GET /location_search and forwards q", async () => {
    const server = makeParsingMockServer();
    const client = makeSearchClient();
    registerThreadsPublishingTools(server as never, client);

    const handler = server.tools.get("threads_search_locations")!;
    await handler({ q: "Menlo Park" });

    const call = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("GET");
    expect(call[1]).toBe("/location_search");
    expect(call[2]).toEqual({ q: "Menlo Park" });
  });

  it("forwards latitude and longitude when provided together", async () => {
    const server = makeParsingMockServer();
    const client = makeSearchClient();
    registerThreadsPublishingTools(server as never, client);

    const handler = server.tools.get("threads_search_locations")!;
    await handler({ latitude: 37.48, longitude: -122.15 });

    const call = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe("/location_search");
    expect(call[2]).toEqual({ latitude: 37.48, longitude: -122.15 });
  });

  it("returns a validation error when no parameters are provided", async () => {
    const server = makeParsingMockServer();
    const client = makeSearchClient();
    registerThreadsPublishingTools(server as never, client);

    const handler = server.tools.get("threads_search_locations")!;
    const result = await handler({}) as { isError: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("either q or both latitude and longitude");
    expect((client.threads as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("returns a validation error when only latitude is provided", async () => {
    const server = makeParsingMockServer();
    const client = makeSearchClient();
    registerThreadsPublishingTools(server as never, client);

    const handler = server.tools.get("threads_search_locations")!;
    const result = await handler({ latitude: 37.48 }) as { isError: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("both latitude and longitude");
    expect((client.threads as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("returns a validation error when only longitude is provided", async () => {
    const server = makeParsingMockServer();
    const client = makeSearchClient();
    registerThreadsPublishingTools(server as never, client);

    const handler = server.tools.get("threads_search_locations")!;
    const result = await handler({ longitude: -122.15 }) as { isError: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("both latitude and longitude");
    expect((client.threads as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("returns a validation error when q is combined with coordinates", async () => {
    const server = makeParsingMockServer();
    const client = makeSearchClient();
    registerThreadsPublishingTools(server as never, client);

    const handler = server.tools.get("threads_search_locations")!;
    const result = await handler({ q: "Menlo Park", latitude: 37.48, longitude: -122.15 }) as { isError: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not both");
    expect((client.threads as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("rejects out-of-range latitude at the schema level", async () => {
    const server = makeParsingMockServer();
    const client = makeSearchClient();
    registerThreadsPublishingTools(server as never, client);

    const handler = server.tools.get("threads_search_locations")!;
    await expect(handler({ latitude: 91, longitude: 0 })).rejects.toThrow();
  });

  it("rejects out-of-range longitude at the schema level", async () => {
    const server = makeParsingMockServer();
    const client = makeSearchClient();
    registerThreadsPublishingTools(server as never, client);

    const handler = server.tools.get("threads_search_locations")!;
    await expect(handler({ latitude: 0, longitude: 181 })).rejects.toThrow();
  });

  it("rejects an empty q string at the schema level", async () => {
    const server = makeParsingMockServer();
    const client = makeSearchClient();
    registerThreadsPublishingTools(server as never, client);

    const handler = server.tools.get("threads_search_locations")!;
    await expect(handler({ q: "" })).rejects.toThrow();
  });
});

describe("Threads publish progress notifications", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerThreadsPublishingTools(server as never, client);
  });

  it("emits a notifications/progress event during threads_publish_video when a progressToken is set", async () => {
    const sendNotification = vi.fn(async () => undefined);
    const handler = server.tools.get("threads_publish_video")!;
    await handler(
      { video_url: "https://example.com/v.mp4" },
      { _meta: { progressToken: 7 }, sendNotification }
    );
    expect(sendNotification).toHaveBeenCalled();
    const call = sendNotification.mock.calls[0][0] as { method: string; params: { progressToken: number } };
    expect(call.method).toBe("notifications/progress");
    expect(call.params.progressToken).toBe(7);
  });

  it("does not emit progress when no progressToken is set", async () => {
    const sendNotification = vi.fn(async () => undefined);
    const handler = server.tools.get("threads_publish_video")!;
    await handler({ video_url: "https://example.com/v.mp4" }, { _meta: {}, sendNotification });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("does not throw when extra is omitted", async () => {
    const handler = server.tools.get("threads_publish_video")!;
    await expect(handler({ video_url: "https://example.com/v.mp4" })).resolves.toBeDefined();
  });

  it("threads_publish_carousel emits strictly increasing progress values via the shared notifier", async () => {
    const sendNotification = vi.fn(async () => undefined);
    const handler = server.tools.get("threads_publish_carousel")!;
    await handler(
      {
        items: [
          { type: "IMAGE", url: "https://example.com/a.jpg" },
          { type: "IMAGE", url: "https://example.com/b.jpg" },
        ],
      },
      { _meta: { progressToken: 99 }, sendNotification }
    );
    // 2 child polls + 1 final carousel poll = 3 emissions on the shared token.
    expect(sendNotification).toHaveBeenCalledTimes(3);
    const progressValues = sendNotification.mock.calls.map(
      (call) => (call[0] as { params: { progress: number } }).params.progress
    );
    expect(progressValues).toEqual([1, 2, 3]);
    const firstCall = sendNotification.mock.calls[0][0] as { params: { progressToken: number; total?: number } };
    expect(firstCall.params.progressToken).toBe(99);
    expect(firstCall.params.total).toBeUndefined();
  });
});
