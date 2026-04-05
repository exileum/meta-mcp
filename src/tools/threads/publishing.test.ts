import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { waitForThreadsContainer, registerThreadsPublishingTools, topicTagSchema } from "./publishing.js";
import { MetaClient } from "../../services/meta-client.js";

// Mirror the gif_provider schema used in threads_publish_text
const gifProviderSchema = z.enum(["GIPHY"]).optional();

function makeMockClient(statusSequence: string[]): MetaClient {
  let callIndex = 0;
  return {
    threads: vi.fn(async () => {
      const status = statusSequence[callIndex++];
      if (status === undefined) {
        throw new Error(`makeMockClient: statusSequence exhausted at call ${callIndex}`);
      }
      return { data: { status }, rateLimit: undefined };
    }),
  } as unknown as MetaClient;
}

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

describe("waitForThreadsContainer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns immediately when status is FINISHED on first poll", async () => {
    const client = makeMockClient(["FINISHED"]);
    await waitForThreadsContainer(client, "container-1", 30);
    expect(client.threads).toHaveBeenCalledTimes(1);
  });

  it("throws on ERROR status", async () => {
    const client = makeMockClient(["ERROR"]);
    await expect(waitForThreadsContainer(client, "container-1", 30)).rejects.toThrow(
      "Threads container processing failed (ERROR status)"
    );
  });

  it("throws on EXPIRED status", async () => {
    const client = makeMockClient(["EXPIRED"]);
    await expect(waitForThreadsContainer(client, "container-1", 30)).rejects.toThrow(
      "Threads container expired — it was not published within 24 hours and must be recreated"
    );
  });

  it("throws on PUBLISHED status", async () => {
    const client = makeMockClient(["PUBLISHED"]);
    await expect(waitForThreadsContainer(client, "container-1", 30)).rejects.toThrow(
      "Threads container already published"
    );
  });

  it("throws on unexpected status", async () => {
    const client = makeMockClient(["SOMETHING_NEW"]);
    await expect(waitForThreadsContainer(client, "container-1", 30)).rejects.toThrow(
      "Unexpected Threads container status: SOMETHING_NEW"
    );
  });

  it("includes last status in timeout message", async () => {
    const client = makeMockClient(Array(20).fill("IN_PROGRESS"));
    const promise = waitForThreadsContainer(client, "container-1", 4);
    // Attach rejection handler before advancing timers to avoid unhandled rejection
    const rejection = expect(promise).rejects.toThrow(
      "Threads container processing timed out after 4s (last status: IN_PROGRESS)"
    );
    // maxWait=4s, interval=2s → 2 attempts, each with a 2s sleep
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
  });

  it("polls multiple times before FINISHED", async () => {
    const client = makeMockClient(["IN_PROGRESS", "IN_PROGRESS", "FINISHED"]);
    const promise = waitForThreadsContainer(client, "container-1", 30);
    // Advance past the two IN_PROGRESS sleeps
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    expect(client.threads).toHaveBeenCalledTimes(3);
  });

  it("passes correct arguments to client.threads", async () => {
    const client = makeMockClient(["FINISHED"]);
    await waitForThreadsContainer(client, "abc-123", 30);
    expect(client.threads).toHaveBeenCalledWith("GET", "/abc-123", { fields: "status" });
  });

  it("throws when status field is missing from API response", async () => {
    const client = {
      threads: vi.fn(async () => ({ data: {}, rateLimit: undefined })),
    } as unknown as MetaClient;
    await expect(waitForThreadsContainer(client, "container-1", 30)).rejects.toThrow(
      "Threads container status field missing from API response"
    );
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
