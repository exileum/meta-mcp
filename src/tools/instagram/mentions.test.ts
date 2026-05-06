import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerIgMentionTools } from "./mentions.js";
import { MetaClient } from "../../services/meta-client.js";

function makeMockServer() {
  const tools = new Map<string, (...args: unknown[]) => unknown>();
  const descriptions = new Map<string, string>();
  return {
    tools,
    descriptions,
    tool: vi.fn((name: string, desc: string, _schema: unknown, handler: (...args: unknown[]) => unknown) => {
      tools.set(name, handler);
      descriptions.set(name, desc);
    }),
  };
}

function makeMockClient(): MetaClient {
  return {
    igUserId: "123",
    ig: vi.fn(async () => ({
      data: { id: "comment_42", text: "@you nice post", timestamp: "2026-04-04T01:00:00+0000" },
      rateLimit: undefined,
    })),
  } as unknown as MetaClient;
}

describe("ig_get_mentioned_comment", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgMentionTools(server as never, client);
  });

  it("registers under the singular name (matches the API endpoint)", () => {
    expect(server.tools.has("ig_get_mentioned_comment")).toBe(true);
    expect(server.tools.has("ig_get_mentioned_comments")).toBe(false);
  });

  it("description clarifies it returns a single comment", () => {
    const desc = server.descriptions.get("ig_get_mentioned_comment")!;
    expect(desc).toMatch(/single comment|specific comment/i);
  });

  it("calls the singular /mentioned_comment endpoint with comment_id and default fields", async () => {
    const handler = server.tools.get("ig_get_mentioned_comment")!;
    await handler({ comment_id: "comment_42" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("GET");
    expect(call[1]).toBe("/123/mentioned_comment");
    expect(call[2]).toEqual({
      comment_id: "comment_42",
      fields: "id,text,timestamp,username,media{id,media_url,media_type}",
    });
  });

  it("passes through caller-provided fields verbatim", async () => {
    const handler = server.tools.get("ig_get_mentioned_comment")!;
    await handler({ comment_id: "comment_99", fields: "id,text" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toEqual({ comment_id: "comment_99", fields: "id,text" });
  });
});

describe("ig_get_tagged_media", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgMentionTools(server as never, client);
  });

  it("is still registered after the mentions rename", () => {
    expect(server.tools.has("ig_get_tagged_media")).toBe(true);
  });

  it("uses hardcoded default fields when fields is omitted", async () => {
    const handler = server.tools.get("ig_get_tagged_media")!;
    await handler({});

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe("/123/tags");
    expect(call[2]).toEqual({
      fields: "id,caption,media_type,media_url,permalink,timestamp,username",
    });
  });

  it("passes through caller-provided fields verbatim", async () => {
    const handler = server.tools.get("ig_get_tagged_media")!;
    await handler({ fields: "id,caption,media_type" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toMatchObject({ fields: "id,caption,media_type" });
  });
});

describe("ig_get_tagged_media pagination cursors", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgMentionTools(server as never, client);
  });

  it("omits both cursors when neither is provided", async () => {
    const handler = server.tools.get("ig_get_tagged_media")!;
    await handler({});

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).not.toHaveProperty("after");
    expect(call[2]).not.toHaveProperty("before");
  });

  it("forwards before cursor when provided alone", async () => {
    const handler = server.tools.get("ig_get_tagged_media")!;
    await handler({ before: "cursor-prev" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toMatchObject({ before: "cursor-prev" });
    expect(call[2]).not.toHaveProperty("after");
  });

  it("forwards both cursors when both are provided", async () => {
    const handler = server.tools.get("ig_get_tagged_media")!;
    await handler({ after: "cursor-next", before: "cursor-prev" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toMatchObject({ after: "cursor-next", before: "cursor-prev" });
  });
});
