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

function makeMockClient(): MetaClient & { ig: ReturnType<typeof vi.fn> } {
  const client = {
    igUserId: "123456",
    ig: vi.fn(async () => ({
      data: { id: "container-1", status_code: "FINISHED" },
      rateLimit: undefined,
    })),
  } as unknown as MetaClient & { ig: ReturnType<typeof vi.fn> };
  return client;
}

describe("ig_publish_story", () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;
  let client: MetaClient & { ig: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    client = makeMockClient();
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
