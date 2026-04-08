import { describe, it, expect, vi } from "vitest";
import { registerThreadsReplyTools } from "./replies.js";
import { MetaClient } from "../../services/meta-client.js";

function makeMockServer() {
  const tools = new Map<string, (...args: unknown[]) => unknown>();
  return {
    tools,
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (...args: unknown[]) => unknown) => {
      tools.set(name, handler);
    }),
  };
}

function makeMockClient(): MetaClient {
  return {
    threadsUserId: "threads-123",
    threads: vi.fn(async () => ({
      data: { data: [] },
      rateLimit: undefined,
    })),
  } as unknown as MetaClient;
}

describe("threads_get_replies mode", () => {
  it("calls /{post_id}/replies by default", async () => {
    const server = makeMockServer();
    const client = makeMockClient();
    registerThreadsReplyTools(server as never, client);

    const handler = server.tools.get("threads_get_replies")!;
    await handler({ post_id: "post-42" });

    const call = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("GET");
    expect(call[1]).toBe("/post-42/replies");
  });

  it("calls /{post_id}/replies when mode='top_level' is explicit", async () => {
    const server = makeMockServer();
    const client = makeMockClient();
    registerThreadsReplyTools(server as never, client);

    const handler = server.tools.get("threads_get_replies")!;
    await handler({ post_id: "post-42", mode: "top_level" });

    const call = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe("/post-42/replies");
  });

  it("calls /{post_id}/conversation when mode='full_tree'", async () => {
    const server = makeMockServer();
    const client = makeMockClient();
    registerThreadsReplyTools(server as never, client);

    const handler = server.tools.get("threads_get_replies")!;
    await handler({ post_id: "post-42", mode: "full_tree" });

    const call = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("GET");
    expect(call[1]).toBe("/post-42/conversation");
  });

  it("includes tree-reconstruction fields (root_post, replied_to, is_reply) in fields", async () => {
    const server = makeMockServer();
    const client = makeMockClient();
    registerThreadsReplyTools(server as never, client);

    const handler = server.tools.get("threads_get_replies")!;
    await handler({ post_id: "post-42", mode: "full_tree" });

    const call = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    const fields = call[2].fields as string;
    expect(fields).toContain("root_post");
    expect(fields).toContain("replied_to");
    expect(fields).toContain("is_reply");
  });

  it("forwards reverse, limit, after in both modes", async () => {
    const server = makeMockServer();
    const client = makeMockClient();
    registerThreadsReplyTools(server as never, client);

    const handler = server.tools.get("threads_get_replies")!;
    await handler({ post_id: "post-42", mode: "full_tree", reverse: false, limit: 25, after: "cursor-xyz" });

    const call = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2].reverse).toBe(false);
    expect(call[2].limit).toBe(25);
    expect(call[2].after).toBe("cursor-xyz");
  });

  it("omits optional params when not provided", async () => {
    const server = makeMockServer();
    const client = makeMockClient();
    registerThreadsReplyTools(server as never, client);

    const handler = server.tools.get("threads_get_replies")!;
    await handler({ post_id: "post-42" });

    const call = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).not.toHaveProperty("reverse");
    expect(call[2]).not.toHaveProperty("limit");
    expect(call[2]).not.toHaveProperty("after");
  });
});

// ─── threads_reply auto_publish (auto_publish_text=true shortcut) ────

/** Mock client that returns a container id for POST /threads and FINISHED status for GET polls */
function makePublishMockClient(): MetaClient {
  return {
    threadsUserId: "threads-123",
    threads: vi.fn(async (method: string, _path: string) => {
      if (method === "GET") {
        return { data: { status: "FINISHED" }, rateLimit: undefined };
      }
      return { data: { id: "container-1" }, rateLimit: undefined };
    }),
  } as unknown as MetaClient;
}

describe("threads_reply auto_publish", () => {
  it("text-only reply: sends auto_publish_text=true and makes a single API call by default", async () => {
    const server = makeMockServer();
    const client = makePublishMockClient();
    registerThreadsReplyTools(server as never, client);

    const handler = server.tools.get("threads_reply")!;
    await handler({ reply_to_id: "post-42", text: "Hi" });

    const calls = (client.threads as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("POST");
    expect(calls[0][1]).toBe("/threads-123/threads");
    expect(calls[0][2]).toHaveProperty("auto_publish_text", true);
    expect(calls[0][2]).toHaveProperty("reply_to_id", "post-42");
    expect(calls[0][2]).toHaveProperty("media_type", "TEXT");
  });

  it("text-only reply with auto_publish=false: omits auto_publish_text and makes two calls", async () => {
    const server = makeMockServer();
    const client = makePublishMockClient();
    registerThreadsReplyTools(server as never, client);

    const handler = server.tools.get("threads_reply")!;
    await handler({ reply_to_id: "post-42", text: "Hi", auto_publish: false });

    const calls = (client.threads as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][2]).not.toHaveProperty("auto_publish_text");
    expect(calls[1][1]).toBe("/threads-123/threads_publish");
    expect(calls[1][2]).toHaveProperty("creation_id", "container-1");
  });

  it("image reply: ignores auto_publish and always uses the two-step flow", async () => {
    const server = makeMockServer();
    const client = makePublishMockClient();
    registerThreadsReplyTools(server as never, client);

    const handler = server.tools.get("threads_reply")!;
    await handler({
      reply_to_id: "post-42",
      text: "With image",
      image_url: "https://example.com/photo.jpg",
    });

    const calls = (client.threads as ReturnType<typeof vi.fn>).mock.calls;
    // Image: create container + publish (no status poll for images in threads_reply)
    expect(calls).toHaveLength(2);
    expect(calls[0][2]).not.toHaveProperty("auto_publish_text");
    expect(calls[0][2]).toHaveProperty("media_type", "IMAGE");
    expect(calls[0][2]).toHaveProperty("image_url", "https://example.com/photo.jpg");
    expect(calls[1][1]).toBe("/threads-123/threads_publish");
  });

  it("video reply: ignores auto_publish, polls container, then publishes", async () => {
    const server = makeMockServer();
    const client = makePublishMockClient();
    registerThreadsReplyTools(server as never, client);

    const handler = server.tools.get("threads_reply")!;
    await handler({
      reply_to_id: "post-42",
      text: "With video",
      video_url: "https://example.com/clip.mp4",
    });

    const calls = (client.threads as ReturnType<typeof vi.fn>).mock.calls;
    // Video: create container + GET status (FINISHED) + publish
    expect(calls).toHaveLength(3);
    expect(calls[0][0]).toBe("POST");
    expect(calls[0][2]).not.toHaveProperty("auto_publish_text");
    expect(calls[0][2]).toHaveProperty("media_type", "VIDEO");
    expect(calls[1][0]).toBe("GET");
    expect(calls[1][1]).toContain("container-1");
    expect(calls[2][0]).toBe("POST");
    expect(calls[2][1]).toBe("/threads-123/threads_publish");
  });
});
