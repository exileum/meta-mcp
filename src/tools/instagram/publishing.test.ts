import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { registerIgPublishingTools } from "./publishing.js";

/** Captures the tool handlers registered via server.tool() */
function captureTools(server: McpServer) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  vi.spyOn(server, "tool").mockImplementation(
    (name: unknown, ..._rest: unknown[]) => {
      // Last argument is always the handler function
      const handler = _rest[_rest.length - 1];
      handlers.set(name as string, handler as (...args: unknown[]) => unknown);
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
  return {
    tools,
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (...args: unknown[]) => unknown) => {
      tools.set(name, handler);
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
    // Expected call sequence:
    // 1. POST /{userId}/media (child 1 container)
    // 2. GET /container-1 (poll child 1 status)
    // 3. POST /{userId}/media (child 2 container)
    // 4. GET /container-1 (poll child 2 status)
    // 5. POST /{userId}/media (carousel container)
    // 6. GET /container-1 (poll carousel status) <-- this was missing before the fix
    // 7. POST /{userId}/media_publish
    expect(calls.length).toBe(7);

    // Verify the carousel container status poll (call index 5)
    expect(calls[5][0]).toBe("GET");
    expect(calls[5][2]).toEqual({ fields: "status_code" });

    // Verify media_publish is the last call (call index 6)
    expect(calls[6][0]).toBe("POST");
    expect(calls[6][1]).toBe("/123/media_publish");
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
