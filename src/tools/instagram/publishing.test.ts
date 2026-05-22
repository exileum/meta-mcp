import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient, HttpMethod } from "../../services/meta-client.js";
import { httpsUrl } from "../../schemas.js";
import { registerIgPublishingTools, collaboratorsSchema } from "./publishing.js";

/** Captures the tool handlers registered via server.registerTool() */
function captureTools(server: McpServer) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  vi.spyOn(server, "registerTool").mockImplementation(
    (name: unknown, _config: unknown, handler: unknown) => {
      handlers.set(name as string, handler as (...args: unknown[]) => unknown);
      return undefined as never;
    }
  );
  return handlers;
}

function makeStoryMockClient(): MetaClient & { ig: ReturnType<typeof vi.fn> } {
  const client = {
    igUserId: "123456",
    ig: vi.fn(async () => ({
      data: { id: "container-1", status_code: "FINISHED" },
      rateLimit: undefined,
    })),
  } as unknown as MetaClient & { ig: ReturnType<typeof vi.fn> };
  return client;
}

/** Lightweight mock server for param-forwarding tests */
function makeMockServer() {
  const tools = new Map<string, (...args: unknown[]) => unknown>();
  const descriptions = new Map<string, string>();
  return {
    tools,
    descriptions,
    registerTool: vi.fn((name: string, config: { description?: string }, handler: (...args: unknown[]) => unknown) => {
      tools.set(name, handler);
      descriptions.set(name, config.description ?? "");
    }),
  };
}

function makeParamMockClient(): MetaClient {
  return {
    igUserId: "123",
    ig: vi.fn(async () => ({
      data: { id: "container-1", status_code: "FINISHED" },
      rateLimit: undefined,
    })),
  } as unknown as MetaClient;
}

describe("ig_publish_story", () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;
  let client: MetaClient & { ig: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    client = makeStoryMockClient();
    handlers = captureTools(server);
    registerIgPublishingTools(server, client);
  });

  it("sets media_type STORIES for IMAGE stories", async () => {
    const handler = handlers.get("ig_publish_story")!;
    await handler({ media_type: "IMAGE", media_url: "https://example.com/photo.jpg" });

    // First call is the container creation POST
    const [method, path, params] = client.ig.mock.calls[0];
    expect(method).toBe("POST");
    expect(path).toBe("/123456/media");
    expect(params).toMatchObject({
      media_type: "STORIES",
      image_url: "https://example.com/photo.jpg",
    });
    expect(params.video_url).toBeUndefined();
  });

  it("sets media_type STORIES for VIDEO stories", async () => {
    const handler = handlers.get("ig_publish_story")!;
    await handler({ media_type: "VIDEO", media_url: "https://example.com/video.mp4" });

    const [method, path, params] = client.ig.mock.calls[0];
    expect(method).toBe("POST");
    expect(path).toBe("/123456/media");
    expect(params).toMatchObject({
      media_type: "STORIES",
      video_url: "https://example.com/video.mp4",
    });
    expect(params.image_url).toBeUndefined();
  });

  it("never sets media_type to VIDEO for stories", async () => {
    const handler = handlers.get("ig_publish_story")!;
    await handler({ media_type: "VIDEO", media_url: "https://example.com/video.mp4" });

    const [, , params] = client.ig.mock.calls[0];
    expect(params.media_type).not.toBe("VIDEO");
  });
});


describe("ig_publish_carousel", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerIgPublishingTools(server as never, client);
  });

  it("polls carousel container status before publishing", async () => {
    const handler = server.tools.get("ig_publish_carousel")!;
    await handler({
      items: [
        { type: "IMAGE", url: "https://example.com/a.jpg" },
        { type: "IMAGE", url: "https://example.com/b.jpg" },
      ],
      caption: "test carousel",
    });

    const calls = (client.ig as ReturnType<typeof vi.fn>).mock.calls;
    // Children are created in parallel via Promise.all, so the sequence is:
    // 0. POST /{userId}/media (child 1 container)
    // 1. POST /{userId}/media (child 2 container)
    // 2. GET /container-1 (poll child 1 status)
    // 3. GET /container-1 (poll child 2 status)
    // 4. POST /{userId}/media (carousel container)
    // 5. GET /container-1 (poll carousel status) <-- regression guard for #29
    // 6. POST /{userId}/media_publish
    expect(calls.length).toBe(7);

    // Verify the carousel container status poll (call index 5)
    expect(calls[5][0]).toBe("GET");
    expect(calls[5][2]).toEqual({ fields: "status_code" });

    // Verify media_publish is the last call (call index 6)
    expect(calls[6][0]).toBe("POST");
    expect(calls[6][1]).toBe("/123/media_publish");
  });

  it("creates child containers in parallel (all child POSTs precede polls)", async () => {
    const handler = server.tools.get("ig_publish_carousel")!;
    await handler({
      items: [
        { type: "IMAGE", url: "https://example.com/a.jpg" },
        { type: "IMAGE", url: "https://example.com/b.jpg" },
        { type: "IMAGE", url: "https://example.com/c.jpg" },
      ],
    });

    const calls = (client.ig as ReturnType<typeof vi.fn>).mock.calls;
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
    expect(calls[8][1]).toBe("/123/media_publish");
  });
});

describe("ig_publish_video media_type", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerIgPublishingTools(server as never, client);
  });

  it("sends media_type=REELS, not VIDEO (Meta deprecated VIDEO on Nov 9, 2023)", async () => {
    const handler = server.tools.get("ig_publish_video")!;
    await handler({ video_url: "https://example.com/video.mp4" });

    const createCall = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).toMatchObject({
      video_url: "https://example.com/video.mp4",
      media_type: "REELS",
    });
    expect(createCall[2].media_type).not.toBe("VIDEO");
  });

  it("sets share_to_feed=true to preserve legacy feed placement", async () => {
    const handler = server.tools.get("ig_publish_video")!;
    await handler({ video_url: "https://example.com/video.mp4" });

    const createCall = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).toMatchObject({ share_to_feed: true });
  });

  it("description flags the tool as DEPRECATED and points to ig_publish_reel", () => {
    const description = server.descriptions.get("ig_publish_video")!;
    expect(description).toContain("DEPRECATED");
    expect(description).toContain("ig_publish_reel");
  });
});

describe("ig_publish_video thumb_offset", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerIgPublishingTools(server as never, client);
  });

  it("includes thumb_offset when value is 0", async () => {
    const handler = server.tools.get("ig_publish_video")!;
    await handler({ video_url: "https://example.com/video.mp4", thumb_offset: 0 });

    const createCall = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).toHaveProperty("thumb_offset", 0);
  });

  it("excludes thumb_offset when undefined", async () => {
    const handler = server.tools.get("ig_publish_video")!;
    await handler({ video_url: "https://example.com/video.mp4" });

    const createCall = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).not.toHaveProperty("thumb_offset");
  });

  it("includes thumb_offset when value is non-zero", async () => {
    const handler = server.tools.get("ig_publish_video")!;
    await handler({ video_url: "https://example.com/video.mp4", thumb_offset: 5000 });

    const createCall = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).toHaveProperty("thumb_offset", 5000);
  });
});

describe("ig_publish_reel thumb_offset", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerIgPublishingTools(server as never, client);
  });

  it("includes thumb_offset when value is 0", async () => {
    const handler = server.tools.get("ig_publish_reel")!;
    await handler({ video_url: "https://example.com/reel.mp4", thumb_offset: 0 });

    const createCall = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).toHaveProperty("thumb_offset", 0);
  });

  it("excludes thumb_offset when undefined", async () => {
    const handler = server.tools.get("ig_publish_reel")!;
    await handler({ video_url: "https://example.com/reel.mp4" });

    const createCall = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).not.toHaveProperty("thumb_offset");
  });

  it("includes thumb_offset when value is non-zero", async () => {
    const handler = server.tools.get("ig_publish_reel")!;
    await handler({ video_url: "https://example.com/reel.mp4", thumb_offset: 5000 });

    const createCall = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).toHaveProperty("thumb_offset", 5000);
  });
});

describe("ig_publish_reel alt_text", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerIgPublishingTools(server as never, client);
  });

  it("does not forward alt_text to Meta even if passed (Reels do not support alt_text)", async () => {
    const handler = server.tools.get("ig_publish_reel")!;
    // Cast through unknown: the schema no longer declares alt_text, but we still
    // verify the handler ignores the field if a caller bypasses validation.
    await handler({
      video_url: "https://example.com/reel.mp4",
      alt_text: "should be ignored",
    } as unknown as Parameters<typeof handler>[0]);

    const createCall = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).not.toHaveProperty("alt_text");
  });
});

describe("ig_publish_carousel alt_text", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerIgPublishingTools(server as never, client);
  });

  it("forwards alt_text for IMAGE items", async () => {
    const handler = server.tools.get("ig_publish_carousel")!;
    await handler({
      items: [
        { type: "IMAGE", url: "https://example.com/a.jpg", alt_text: "First photo" },
        { type: "IMAGE", url: "https://example.com/b.jpg", alt_text: "Second photo" },
      ],
    });

    const childPosts = (client.ig as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === "POST" && (c[2] as Record<string, unknown>)?.is_carousel_item === true
    );
    expect(childPosts).toHaveLength(2);
    expect(childPosts[0][2]).toMatchObject({
      image_url: "https://example.com/a.jpg",
      alt_text: "First photo",
    });
    expect(childPosts[1][2]).toMatchObject({
      image_url: "https://example.com/b.jpg",
      alt_text: "Second photo",
    });
  });

  it("never forwards alt_text for VIDEO items", async () => {
    const handler = server.tools.get("ig_publish_carousel")!;
    // Even if a caller bypasses the discriminated-union schema, the handler
    // must not forward alt_text for VIDEO items (Meta does not support it).
    await handler({
      items: [
        { type: "VIDEO", url: "https://example.com/a.mp4", alt_text: "ignored" },
        { type: "VIDEO", url: "https://example.com/b.mp4", alt_text: "ignored" },
      ],
    } as unknown as Parameters<typeof handler>[0]);

    const childPosts = (client.ig as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === "POST" && (c[2] as Record<string, unknown>)?.is_carousel_item === true
    );
    expect(childPosts).toHaveLength(2);
    for (const call of childPosts) {
      expect(call[2]).not.toHaveProperty("alt_text");
    }
  });

  it("forwards alt_text only for IMAGE in mixed carousel", async () => {
    const handler = server.tools.get("ig_publish_carousel")!;
    await handler({
      items: [
        { type: "IMAGE", url: "https://example.com/a.jpg", alt_text: "Photo alt" },
        { type: "VIDEO", url: "https://example.com/b.mp4" },
      ],
    });

    const childPosts = (client.ig as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === "POST" && (c[2] as Record<string, unknown>)?.is_carousel_item === true
    );
    const imagePost = childPosts.find(
      (c) => (c[2] as Record<string, unknown>)?.image_url === "https://example.com/a.jpg"
    );
    const videoPost = childPosts.find(
      (c) => (c[2] as Record<string, unknown>)?.video_url === "https://example.com/b.mp4"
    );
    expect(imagePost).toBeDefined();
    expect(videoPost).toBeDefined();
    expect(imagePost![2]).toMatchObject({
      image_url: "https://example.com/a.jpg",
      alt_text: "Photo alt",
    });
    expect(videoPost![2]).toMatchObject({
      video_url: "https://example.com/b.mp4",
      media_type: "VIDEO",
    });
    expect(videoPost![2]).not.toHaveProperty("alt_text");
  });
});

// Mirror of the discriminated-union schema in `ig_publish_carousel` so the
// validation contract is covered explicitly at the parse boundary.
describe("ig_publish_carousel items schema", () => {
  const itemsSchema = z.array(z.discriminatedUnion("type", [
    z.object({
      type: z.literal("IMAGE"),
      url: httpsUrl,
      alt_text: z.string().optional(),
    }),
    z.object({
      type: z.literal("VIDEO"),
      url: httpsUrl,
    }),
  ])).min(2).max(10);

  it("preserves alt_text on IMAGE items after parse", () => {
    const parsed = itemsSchema.parse([
      { type: "IMAGE", url: "https://example.com/a.jpg", alt_text: "ok" },
      { type: "IMAGE", url: "https://example.com/b.jpg" },
    ]);
    expect(parsed[0]).toMatchObject({ type: "IMAGE", alt_text: "ok" });
    expect(parsed[1]).not.toHaveProperty("alt_text");
  });

  it("strips alt_text from VIDEO items after parse", () => {
    const parsed = itemsSchema.parse([
      { type: "VIDEO", url: "https://example.com/a.mp4", alt_text: "ignored" },
      { type: "VIDEO", url: "https://example.com/b.mp4" },
    ] as unknown as z.infer<typeof itemsSchema>);
    expect(parsed[0]).toEqual({ type: "VIDEO", url: "https://example.com/a.mp4" });
    expect(parsed[0]).not.toHaveProperty("alt_text");
    expect(parsed[1]).not.toHaveProperty("alt_text");
  });

  it("rejects items missing the type discriminator", () => {
    expect(() => itemsSchema.parse([
      { url: "https://example.com/a.jpg" },
      { type: "IMAGE", url: "https://example.com/b.jpg" },
    ])).toThrow();
  });

  it("rejects items with an invalid type discriminator", () => {
    expect(() => itemsSchema.parse([
      { type: "AUDIO", url: "https://example.com/a.mp3" },
      { type: "IMAGE", url: "https://example.com/b.jpg" },
    ])).toThrow();
  });
});

describe("collaboratorsSchema validation", () => {
  it("accepts undefined (parameter is optional)", () => {
    expect(collaboratorsSchema.parse(undefined)).toBeUndefined();
  });

  it("accepts an array of 1 to 3 well-formed usernames", () => {
    expect(collaboratorsSchema.parse(["alice"])).toEqual(["alice"]);
    expect(collaboratorsSchema.parse(["alice", "bob"])).toEqual(["alice", "bob"]);
    expect(collaboratorsSchema.parse(["alice", "bob", "carol"])).toEqual(["alice", "bob", "carol"]);
  });

  it("rejects arrays with more than 3 entries (Instagram API limit)", () => {
    expect(() => collaboratorsSchema.parse(["a", "b", "c", "d"])).toThrow();
  });

  it("rejects an explicitly empty array (use undefined to omit instead)", () => {
    expect(() => collaboratorsSchema.parse([])).toThrow();
  });

  it("rejects arrays with duplicate usernames after normalization", () => {
    expect(() => collaboratorsSchema.parse(["alice", "alice"])).toThrow();
    // Duplicates only after '@'-stripping should also be rejected
    expect(() => collaboratorsSchema.parse(["@alice", "alice"])).toThrow();
    expect(() => collaboratorsSchema.parse(["  alice  ", "@@alice"])).toThrow();
  });

  it("strips a single leading '@' from each entry", () => {
    expect(collaboratorsSchema.parse(["@alice", "@bob"])).toEqual(["alice", "bob"]);
  });

  it("strips all consecutive leading '@' characters", () => {
    expect(collaboratorsSchema.parse(["@@@alice"])).toEqual(["alice"]);
  });

  it("trims surrounding whitespace before stripping '@'", () => {
    expect(collaboratorsSchema.parse(["  @alice  "])).toEqual(["alice"]);
  });

  it("rejects empty strings, whitespace-only, or '@'-only entries", () => {
    expect(() => collaboratorsSchema.parse([""])).toThrow();
    expect(() => collaboratorsSchema.parse(["   "])).toThrow();
    expect(() => collaboratorsSchema.parse(["@"])).toThrow();
    expect(() => collaboratorsSchema.parse(["@@@"])).toThrow();
  });
});

describe("ig_publish_photo collaborators", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerIgPublishingTools(server as never, client);
  });

  it("forwards collaborators as a JSON-encoded array on the container POST", async () => {
    const handler = server.tools.get("ig_publish_photo")!;
    await handler({
      image_url: "https://example.com/a.jpg",
      collaborators: ["alice", "bob"],
    });

    const createCall = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).toHaveProperty("collaborators", JSON.stringify(["alice", "bob"]));
  });

  it("forwards already-parsed (normalized) collaborators unchanged", async () => {
    const handler = server.tools.get("ig_publish_photo")!;
    // Parse through the schema first (mirrors what the MCP server does in production):
    // it strips '@' and trims whitespace before the handler ever sees the value.
    const parsed = collaboratorsSchema.parse(["  @alice  ", "@@bob"]);
    await handler({
      image_url: "https://example.com/a.jpg",
      collaborators: parsed,
    });

    const createCall = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).toHaveProperty("collaborators", JSON.stringify(["alice", "bob"]));
  });

  it("omits collaborators when the parameter is undefined", async () => {
    const handler = server.tools.get("ig_publish_photo")!;
    await handler({ image_url: "https://example.com/a.jpg" });

    const createCall = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).not.toHaveProperty("collaborators");
  });

  it("omits collaborators when an empty array bypasses the schema (defense in depth)", async () => {
    // The schema now rejects [] at parse time, but the handler must also stay safe
    // if a caller passes [] directly (e.g. tests, programmatic invocation).
    const handler = server.tools.get("ig_publish_photo")!;
    await handler({
      image_url: "https://example.com/a.jpg",
      collaborators: [],
    });

    const createCall = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).not.toHaveProperty("collaborators");
  });
});

describe("ig_publish_video collaborators", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerIgPublishingTools(server as never, client);
  });

  it("forwards collaborators on the container POST (deprecated tool, parity with ig_publish_reel)", async () => {
    const handler = server.tools.get("ig_publish_video")!;
    await handler({
      video_url: "https://example.com/v.mp4",
      collaborators: ["alice"],
    });

    const createCall = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).toHaveProperty("collaborators", JSON.stringify(["alice"]));
  });

  it("omits collaborators when undefined", async () => {
    const handler = server.tools.get("ig_publish_video")!;
    await handler({ video_url: "https://example.com/v.mp4" });

    const createCall = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).not.toHaveProperty("collaborators");
  });
});

describe("ig_publish_reel collaborators", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerIgPublishingTools(server as never, client);
  });

  it("forwards collaborators on the container POST", async () => {
    const handler = server.tools.get("ig_publish_reel")!;
    await handler({
      video_url: "https://example.com/r.mp4",
      collaborators: ["alice", "bob", "carol"],
    });

    const createCall = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).toHaveProperty("collaborators", JSON.stringify(["alice", "bob", "carol"]));
  });

  it("omits collaborators when undefined", async () => {
    const handler = server.tools.get("ig_publish_reel")!;
    await handler({ video_url: "https://example.com/r.mp4" });

    const createCall = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).not.toHaveProperty("collaborators");
  });
});

describe("ig_publish_carousel collaborators", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerIgPublishingTools(server as never, client);
  });

  it("forwards collaborators on the carousel parent POST, not on child POSTs", async () => {
    const handler = server.tools.get("ig_publish_carousel")!;
    await handler({
      items: [
        { type: "IMAGE", url: "https://example.com/a.jpg" },
        { type: "IMAGE", url: "https://example.com/b.jpg" },
      ],
      collaborators: ["alice", "bob"],
    });

    const calls = (client.ig as ReturnType<typeof vi.fn>).mock.calls;
    // Child POSTs at indices 0 and 2 must NOT carry collaborators
    expect(calls[0][2]).not.toHaveProperty("collaborators");
    expect(calls[2][2]).not.toHaveProperty("collaborators");
    // The carousel parent POST (index 4) MUST carry collaborators as JSON
    expect(calls[4][2]).toMatchObject({
      media_type: "CAROUSEL",
      collaborators: JSON.stringify(["alice", "bob"]),
    });
  });

  it("omits collaborators when the parameter is undefined", async () => {
    const handler = server.tools.get("ig_publish_carousel")!;
    await handler({
      items: [
        { type: "IMAGE", url: "https://example.com/a.jpg" },
        { type: "IMAGE", url: "https://example.com/b.jpg" },
      ],
    });

    const calls = (client.ig as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[4][2]).not.toHaveProperty("collaborators");
  });
});

describe("ig_publish_story collaborators (not supported)", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerIgPublishingTools(server as never, client);
  });

  it("never forwards collaborators even if a caller bypasses validation", async () => {
    const handler = server.tools.get("ig_publish_story")!;
    // Stories do not accept collaborators per Meta API; if a caller bypasses
    // the schema, the handler must not forward the field to the API.
    await handler({
      media_type: "IMAGE",
      media_url: "https://example.com/s.jpg",
      collaborators: ["alice"],
    } as unknown as Parameters<typeof handler>[0]);

    const createCall = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createCall[2]).not.toHaveProperty("collaborators");
  });
});

describe("Instagram publishing text-field length validation", () => {
  let server: ReturnType<typeof makeMockServer>;

  beforeEach(() => {
    server = makeMockServer();
    registerIgPublishingTools(server as never, makeParamMockClient());
  });

  function getSchema(toolName: string): z.ZodObject<z.ZodRawShape> {
    const call = (server.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(c => c[0] === toolName);
    if (!call) throw new Error(`${toolName} was not registered`);
    const config = call[1] as { inputSchema?: z.ZodRawShape };
    return z.object(config.inputSchema ?? {});
  }

  describe("caption (max 2200 chars)", () => {
    it.each([
      ["ig_publish_photo", { image_url: "https://example.com/a.jpg" }],
      ["ig_publish_video", { video_url: "https://example.com/a.mp4" }],
      ["ig_publish_reel",  { video_url: "https://example.com/a.mp4" }],
      ["ig_publish_carousel", {
        items: [
          { type: "IMAGE", url: "https://example.com/a.jpg" },
          { type: "IMAGE", url: "https://example.com/b.jpg" },
        ],
      }],
    ])("%s accepts a caption at the 2200-char boundary", (toolName, base) => {
      const schema = getSchema(toolName);
      expect(schema.safeParse({ ...base, caption: "a".repeat(2200) }).success).toBe(true);
    });

    it.each([
      ["ig_publish_photo", { image_url: "https://example.com/a.jpg" }],
      ["ig_publish_video", { video_url: "https://example.com/a.mp4" }],
      ["ig_publish_reel",  { video_url: "https://example.com/a.mp4" }],
      ["ig_publish_carousel", {
        items: [
          { type: "IMAGE", url: "https://example.com/a.jpg" },
          { type: "IMAGE", url: "https://example.com/b.jpg" },
        ],
      }],
    ])("%s rejects a caption exceeding 2200 chars", (toolName, base) => {
      const schema = getSchema(toolName);
      expect(schema.safeParse({ ...base, caption: "a".repeat(2201) }).success).toBe(false);
    });

    it("counts emoji as single code points, not UTF-16 surrogate pairs", () => {
      const schema = getSchema("ig_publish_photo");
      // 2200 emoji = 2200 code points (4400 UTF-16 units). A UTF-16-based
      // .max(2200) would falsely reject this; the code-point refine accepts it.
      const emojiCaption = "😀".repeat(2200);
      expect(emojiCaption.length).toBe(4400);
      expect([...emojiCaption].length).toBe(2200);
      expect(schema.safeParse({ image_url: "https://example.com/a.jpg", caption: emojiCaption }).success).toBe(true);
    });

    it("rejects a caption with 2201 emoji code points", () => {
      const schema = getSchema("ig_publish_photo");
      expect(schema.safeParse({
        image_url: "https://example.com/a.jpg",
        caption: "😀".repeat(2201),
      }).success).toBe(false);
    });
  });

  describe("alt_text (max 1000 chars)", () => {
    it("ig_publish_photo accepts alt_text at the 1000-char boundary", () => {
      const schema = getSchema("ig_publish_photo");
      expect(schema.safeParse({
        image_url: "https://example.com/a.jpg",
        alt_text: "a".repeat(1000),
      }).success).toBe(true);
    });

    it("ig_publish_photo rejects alt_text exceeding 1000 chars", () => {
      const schema = getSchema("ig_publish_photo");
      expect(schema.safeParse({
        image_url: "https://example.com/a.jpg",
        alt_text: "a".repeat(1001),
      }).success).toBe(false);
    });

    it("ig_publish_carousel accepts alt_text at the 1000-char boundary on IMAGE items", () => {
      const schema = getSchema("ig_publish_carousel");
      expect(schema.safeParse({
        items: [
          { type: "IMAGE", url: "https://example.com/a.jpg", alt_text: "a".repeat(1000) },
          { type: "IMAGE", url: "https://example.com/b.jpg" },
        ],
      }).success).toBe(true);
    });

    it("ig_publish_carousel rejects alt_text exceeding 1000 chars on IMAGE items", () => {
      const schema = getSchema("ig_publish_carousel");
      expect(schema.safeParse({
        items: [
          { type: "IMAGE", url: "https://example.com/a.jpg", alt_text: "a".repeat(1001) },
          { type: "IMAGE", url: "https://example.com/b.jpg" },
        ],
      }).success).toBe(false);
    });

    it("counts emoji alt_text as code points, not UTF-16 units", () => {
      const schema = getSchema("ig_publish_photo");
      // 1000 emoji code points = 2000 UTF-16 units; passes the code-point refine.
      expect(schema.safeParse({
        image_url: "https://example.com/a.jpg",
        alt_text: "😀".repeat(1000),
      }).success).toBe(true);
    });
  });
});

describe("Instagram publish progress notifications", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeParamMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeParamMockClient();
    registerIgPublishingTools(server as never, client);
  });

  it("emits a notifications/progress event during ig_publish_reel when a progressToken is set", async () => {
    const sendNotification = vi.fn(async () => undefined);
    const handler = server.tools.get("ig_publish_reel")!;
    await handler(
      { video_url: "https://example.com/v.mp4" },
      { _meta: { progressToken: "tok-reel" }, sendNotification }
    );
    expect(sendNotification).toHaveBeenCalled();
    const call = sendNotification.mock.calls[0][0] as { method: string; params: { progressToken: string } };
    expect(call.method).toBe("notifications/progress");
    expect(call.params.progressToken).toBe("tok-reel");
  });

  it("does not emit progress when no progressToken is set", async () => {
    const sendNotification = vi.fn(async () => undefined);
    const handler = server.tools.get("ig_publish_reel")!;
    await handler({ video_url: "https://example.com/v.mp4" }, { _meta: {}, sendNotification });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("does not throw when extra is omitted (existing test pattern)", async () => {
    const handler = server.tools.get("ig_publish_reel")!;
    await expect(handler({ video_url: "https://example.com/v.mp4" })).resolves.toBeDefined();
  });

  it("ig_publish_carousel emits strictly increasing progress values via the shared notifier", async () => {
    const sendNotification = vi.fn(async () => undefined);
    const handler = server.tools.get("ig_publish_carousel")!;
    await handler(
      {
        items: [
          { type: "IMAGE", url: "https://example.com/a.jpg" },
          { type: "IMAGE", url: "https://example.com/b.jpg" },
          { type: "IMAGE", url: "https://example.com/c.jpg" },
        ],
      },
      { _meta: { progressToken: "tok-carousel" }, sendNotification }
    );
    // 3 child polls + 1 final carousel poll = 4 emissions on the shared token.
    expect(sendNotification).toHaveBeenCalledTimes(4);
    const progressValues = sendNotification.mock.calls.map(
      (call) => (call[0] as { params: { progress: number; progressToken: string } }).params.progress
    );
    expect(progressValues).toEqual([1, 2, 3, 4]);
    const firstCall = sendNotification.mock.calls[0][0] as { params: { progressToken: string; total?: number } };
    expect(firstCall.params.progressToken).toBe("tok-carousel");
    expect(firstCall.params.total).toBeUndefined();
  });
});

// ─── error context tracking (#99) ─────────────────────────────────────

interface ErrorPayload {
  error: true;
  error_type: string;
  step?: string;
  container_id?: string;
  message: string;
}

function parsePayload(result: unknown): ErrorPayload {
  const text = (result as { content: { text: string }[] }).content[0].text;
  return JSON.parse(text) as ErrorPayload;
}

describe("ig_publish_photo error context", () => {
  it("reports 'container creation' step with no container_id when the create POST fails", async () => {
    const server = makeMockServer();
    const client = {
      igUserId: "ig-99",
      ig: vi.fn(async () => { throw new Error("container POST failed"); }),
    } as unknown as MetaClient;
    registerIgPublishingTools(server as never, client);
    const handler = server.tools.get("ig_publish_photo")!;
    const result = await handler({ image_url: "https://example.com/a.jpg" });
    const payload = parsePayload(result);
    expect(payload.step).toBe("container creation");
    expect(payload.container_id).toBeUndefined();
    expect(payload.message).toBe("Publish photo failed at container creation: container POST failed");
  });

  it("reports 'processing' step with container_id when the poll fails", async () => {
    const server = makeMockServer();
    let callIndex = 0;
    const client = {
      igUserId: "ig-99",
      ig: vi.fn(async (method: HttpMethod) => {
        if (callIndex++ === 0) return { data: { id: "container-77" }, rateLimit: undefined };
        if (method === "GET") return { data: { status_code: "ERROR" }, rateLimit: undefined };
        throw new Error("unexpected call");
      }),
    } as unknown as MetaClient;
    registerIgPublishingTools(server as never, client);
    const handler = server.tools.get("ig_publish_photo")!;
    const result = await handler({ image_url: "https://example.com/a.jpg" });
    const payload = parsePayload(result);
    expect(payload.step).toBe("processing");
    expect(payload.container_id).toBe("container-77");
    expect(payload.message).toContain("Publish photo failed at processing (container: container-77)");
  });

  it("reports 'publishing' step with container_id when the publish POST fails", async () => {
    const server = makeMockServer();
    let callIndex = 0;
    const client = {
      igUserId: "ig-99",
      ig: vi.fn(async (method: HttpMethod, path: string) => {
        if (callIndex++ === 0) return { data: { id: "container-77" }, rateLimit: undefined };
        if (method === "GET") return { data: { status_code: "FINISHED" }, rateLimit: undefined };
        if (path.endsWith("/media_publish")) throw new Error("publish POST failed");
        throw new Error("unexpected call");
      }),
    } as unknown as MetaClient;
    registerIgPublishingTools(server as never, client);
    const handler = server.tools.get("ig_publish_photo")!;
    const result = await handler({ image_url: "https://example.com/a.jpg" });
    const payload = parsePayload(result);
    expect(payload.step).toBe("publishing");
    expect(payload.container_id).toBe("container-77");
    expect(payload.message).toBe("Publish photo failed at publishing (container: container-77): publish POST failed");
  });
});

describe("ig_publish_carousel error context", () => {
  it("reports first-failing child's step + id when a child container POST fails", async () => {
    const server = makeMockServer();
    let postCount = 0;
    const client = {
      igUserId: "ig-99",
      ig: vi.fn(async (method: HttpMethod) => {
        if (method === "POST") {
          postCount++;
          if (postCount === 1) throw new Error("child POST failed");
          return { data: { id: `child-${postCount}` }, rateLimit: undefined };
        }
        return { data: { status_code: "FINISHED" }, rateLimit: undefined };
      }),
    } as unknown as MetaClient;
    registerIgPublishingTools(server as never, client);
    const handler = server.tools.get("ig_publish_carousel")!;
    const result = await handler({
      items: [
        { type: "IMAGE", url: "https://example.com/a.jpg" },
        { type: "IMAGE", url: "https://example.com/b.jpg" },
      ],
    });
    const payload = parsePayload(result);
    expect(payload.step).toBe("child container creation");
    expect(payload.container_id).toBeUndefined();
    expect(payload.message).toContain("Publish carousel failed at child container creation");
  });

  it("reports 'parent processing' step + carousel container_id when the parent poll fails", async () => {
    const server = makeMockServer();
    let postIndex = 0;
    let getIndex = 0;
    const client = {
      igUserId: "ig-99",
      ig: vi.fn(async (method: HttpMethod) => {
        if (method === "POST") {
          postIndex++;
          return { data: { id: `c-${postIndex}` }, rateLimit: undefined };
        }
        getIndex++;
        // child polls (#1, #2) return FINISHED; parent poll (#3) returns ERROR
        return {
          data: { status_code: getIndex <= 2 ? "FINISHED" : "ERROR" },
          rateLimit: undefined,
        };
      }),
    } as unknown as MetaClient;
    registerIgPublishingTools(server as never, client);
    const handler = server.tools.get("ig_publish_carousel")!;
    const result = await handler({
      items: [
        { type: "IMAGE", url: "https://example.com/a.jpg" },
        { type: "IMAGE", url: "https://example.com/b.jpg" },
      ],
    });
    const payload = parsePayload(result);
    expect(payload.step).toBe("parent processing");
    // 3rd POST creates the carousel parent; child POSTs are #1 and #2
    expect(payload.container_id).toBe("c-3");
    expect(payload.message).toContain("Publish carousel failed at parent processing (container: c-3)");
  });
});
