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
