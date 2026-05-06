import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { registerIgMentionTools } from "./mentions.js";
import { MetaClient } from "../../services/meta-client.js";

type ZodShape = Record<string, z.ZodTypeAny>;
type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

function makeMockServer() {
  const tools = new Map<string, { schema: ZodShape; handler: ToolHandler }>();
  const descriptions = new Map<string, string>();
  return {
    tools,
    descriptions,
    tool: vi.fn((name: string, desc: string, schema: ZodShape, handler: ToolHandler) => {
      tools.set(name, { schema, handler });
      descriptions.set(name, desc);
    }),
    async callTool(name: string, args: Record<string, unknown>) {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Tool ${name} not registered`);
      const parsed = z.object(tool.schema).parse(args) as Record<string, unknown>;
      return tool.handler(parsed);
    },
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

  it("calls the singular /mentioned_comment endpoint with comment_id and schema default fields", async () => {
    await server.callTool("ig_get_mentioned_comment", { comment_id: "comment_42" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("GET");
    expect(call[1]).toBe("/123/mentioned_comment");
    expect(call[2]).toEqual({
      comment_id: "comment_42",
      fields: "id,text,timestamp,username,media{id,media_url,media_type}",
    });
  });

  it("passes through caller-provided fields verbatim", async () => {
    await server.callTool("ig_get_mentioned_comment", { comment_id: "comment_99", fields: "id,text" });

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

  it("uses schema default fields when fields is omitted", async () => {
    await server.callTool("ig_get_tagged_media", {});

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe("/123/tags");
    expect(call[2]).toEqual({
      fields: "id,caption,media_type,media_url,permalink,timestamp,username",
    });
  });

  it("passes through caller-provided fields verbatim", async () => {
    await server.callTool("ig_get_tagged_media", { fields: "id,caption,media_type" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toMatchObject({ fields: "id,caption,media_type" });
  });
});
