import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerIgCommentTools } from "./comments.js";
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
    igUserId: "123",
    ig: vi.fn(async () => ({
      data: { data: [] },
      rateLimit: undefined,
    })),
  } as unknown as MetaClient;
}

describe("ig_get_comments fields override", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgCommentTools(server as never, client);
  });

  it("uses hardcoded default fields when fields is omitted", async () => {
    const handler = server.tools.get("ig_get_comments")!;
    await handler({ media_id: "media_1" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe("/media_1/comments");
    expect(call[2]).toEqual({
      fields: "id,text,username,timestamp,like_count,replies{id,text,username,timestamp}",
    });
  });

  it("passes through caller-provided fields verbatim", async () => {
    const handler = server.tools.get("ig_get_comments")!;
    await handler({ media_id: "media_2", fields: "id,text,hidden" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toMatchObject({ fields: "id,text,hidden" });
  });
});

describe("ig_get_comment fields override", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgCommentTools(server as never, client);
  });

  it("uses hardcoded default fields when fields is omitted", async () => {
    const handler = server.tools.get("ig_get_comment")!;
    await handler({ comment_id: "c_1" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe("/c_1");
    expect(call[2]).toEqual({
      fields: "id,text,username,timestamp,like_count,parent_id,media",
    });
  });

  it("passes through caller-provided fields verbatim", async () => {
    const handler = server.tools.get("ig_get_comment")!;
    await handler({ comment_id: "c_2", fields: "id,text,hidden,user" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toEqual({ fields: "id,text,hidden,user" });
  });
});

describe("ig_get_replies fields override", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgCommentTools(server as never, client);
  });

  it("uses hardcoded default fields when fields is omitted", async () => {
    const handler = server.tools.get("ig_get_replies")!;
    await handler({ comment_id: "c_1" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe("/c_1/replies");
    expect(call[2]).toEqual({
      fields: "id,text,username,timestamp,like_count",
    });
  });

  it("passes through caller-provided fields verbatim", async () => {
    const handler = server.tools.get("ig_get_replies")!;
    await handler({ comment_id: "c_2", fields: "id,text" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toMatchObject({ fields: "id,text" });
  });
});

describe("ig_get_comments pagination cursors", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgCommentTools(server as never, client);
  });

  it("omits both cursors when neither is provided", async () => {
    const handler = server.tools.get("ig_get_comments")!;
    await handler({ media_id: "media_1" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).not.toHaveProperty("after");
    expect(call[2]).not.toHaveProperty("before");
  });

  it("forwards before cursor when provided alone", async () => {
    const handler = server.tools.get("ig_get_comments")!;
    await handler({ media_id: "media_1", before: "cursor-prev" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toMatchObject({ before: "cursor-prev" });
    expect(call[2]).not.toHaveProperty("after");
  });

  it("forwards both cursors when both are provided", async () => {
    const handler = server.tools.get("ig_get_comments")!;
    await handler({ media_id: "media_1", after: "cursor-next", before: "cursor-prev" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toMatchObject({ after: "cursor-next", before: "cursor-prev" });
  });
});

describe("ig_get_replies pagination cursors", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgCommentTools(server as never, client);
  });

  it("omits both cursors when neither is provided", async () => {
    const handler = server.tools.get("ig_get_replies")!;
    await handler({ comment_id: "c_1" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).not.toHaveProperty("after");
    expect(call[2]).not.toHaveProperty("before");
  });

  it("forwards before cursor when provided alone", async () => {
    const handler = server.tools.get("ig_get_replies")!;
    await handler({ comment_id: "c_1", before: "cursor-prev" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toMatchObject({ before: "cursor-prev" });
    expect(call[2]).not.toHaveProperty("after");
  });

  it("forwards both cursors when both are provided", async () => {
    const handler = server.tools.get("ig_get_replies")!;
    await handler({ comment_id: "c_1", after: "cursor-next", before: "cursor-prev" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toMatchObject({ after: "cursor-next", before: "cursor-prev" });
  });
});
