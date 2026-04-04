import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { registerIgPublishingTools, waitForContainer } from "./publishing.js";

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

function makeMockClient(statusSequence: string[]): MetaClient {
  let callIndex = 0;
  return {
    ig: vi.fn(async () => {
      const status_code = statusSequence[callIndex++];
      if (status_code === undefined) {
        throw new Error(`makeMockClient: statusSequence exhausted at call ${callIndex}`);
      }
      return { data: { status_code }, rateLimit: undefined };
    }),
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

describe("waitForContainer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns immediately when status_code is FINISHED on first poll", async () => {
    const client = makeMockClient(["FINISHED"]);
    await waitForContainer(client, "container-1", 30);
    expect(client.ig).toHaveBeenCalledTimes(1);
  });

  it("throws on ERROR status", async () => {
    const client = makeMockClient(["ERROR"]);
    await expect(waitForContainer(client, "container-1", 30)).rejects.toThrow(
      "Container processing failed (ERROR status)"
    );
  });

  it("throws on EXPIRED status", async () => {
    const client = makeMockClient(["EXPIRED"]);
    await expect(waitForContainer(client, "container-1", 30)).rejects.toThrow(
      "Container expired — it was not published within 24 hours and must be recreated"
    );
  });

  it("throws on PUBLISHED status", async () => {
    const client = makeMockClient(["PUBLISHED"]);
    await expect(waitForContainer(client, "container-1", 30)).rejects.toThrow(
      "Container already published"
    );
  });

  it("throws on unexpected status", async () => {
    const client = makeMockClient(["SOMETHING_NEW"]);
    await expect(waitForContainer(client, "container-1", 30)).rejects.toThrow(
      "Unexpected container status: SOMETHING_NEW"
    );
  });

  it("includes last status in timeout message", async () => {
    const client = makeMockClient(Array(20).fill("IN_PROGRESS"));
    const promise = waitForContainer(client, "container-1", 4);
    const rejection = expect(promise).rejects.toThrow(
      "Container processing timed out after 4s (last status: IN_PROGRESS)"
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
  });

  it("polls multiple times before FINISHED", async () => {
    const client = makeMockClient(["IN_PROGRESS", "IN_PROGRESS", "FINISHED"]);
    const promise = waitForContainer(client, "container-1", 30);
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    expect(client.ig).toHaveBeenCalledTimes(3);
  });

  it("passes correct arguments to client.ig", async () => {
    const client = makeMockClient(["FINISHED"]);
    await waitForContainer(client, "abc-123", 30);
    expect(client.ig).toHaveBeenCalledWith("GET", "/abc-123", { fields: "status_code" });
  });
});
