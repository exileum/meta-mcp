import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerIgMentionTools } from "./mentions.js";
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

describe("ig_get_mentioned_comments fields override", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgMentionTools(server as never, client);
  });

  it("uses hardcoded default fields when fields is omitted", async () => {
    const handler = server.tools.get("ig_get_mentioned_comments")!;
    await handler({ comment_id: "c_1" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe("/123/mentioned_comment");
    expect(call[2]).toEqual({
      comment_id: "c_1",
      fields: "id,text,timestamp,username,media{id,media_url,media_type}",
    });
  });

  it("passes through caller-provided fields verbatim", async () => {
    const handler = server.tools.get("ig_get_mentioned_comments")!;
    await handler({ comment_id: "c_2", fields: "id,text,timestamp" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toEqual({
      comment_id: "c_2",
      fields: "id,text,timestamp",
    });
  });
});

describe("ig_get_tagged_media fields override", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgMentionTools(server as never, client);
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
