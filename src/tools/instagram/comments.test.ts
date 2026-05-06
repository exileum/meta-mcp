import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { registerIgCommentTools } from "./comments.js";
import { MetaClient } from "../../services/meta-client.js";

type ZodShape = Record<string, z.ZodTypeAny>;
type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

function makeMockServer() {
  const tools = new Map<string, { schema: ZodShape; handler: ToolHandler }>();
  return {
    tools,
    tool: vi.fn((name: string, _desc: string, schema: ZodShape, handler: ToolHandler) => {
      tools.set(name, { schema, handler });
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

  it("uses schema default fields when fields is omitted", async () => {
    await server.callTool("ig_get_comments", { media_id: "media_1" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe("/media_1/comments");
    expect(call[2]).toEqual({
      fields: "id,text,username,timestamp,like_count,replies{id,text,username,timestamp}",
    });
  });

  it("passes through caller-provided fields verbatim", async () => {
    await server.callTool("ig_get_comments", { media_id: "media_2", fields: "id,text,hidden" });

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

  it("uses schema default fields when fields is omitted", async () => {
    await server.callTool("ig_get_comment", { comment_id: "c_1" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe("/c_1");
    expect(call[2]).toEqual({
      fields: "id,text,username,timestamp,like_count,parent_id,media",
    });
  });

  it("passes through caller-provided fields verbatim", async () => {
    await server.callTool("ig_get_comment", { comment_id: "c_2", fields: "id,text,hidden,user" });

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

  it("uses schema default fields when fields is omitted", async () => {
    await server.callTool("ig_get_replies", { comment_id: "c_1" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe("/c_1/replies");
    expect(call[2]).toEqual({
      fields: "id,text,username,timestamp,like_count",
    });
  });

  it("passes through caller-provided fields verbatim", async () => {
    await server.callTool("ig_get_replies", { comment_id: "c_2", fields: "id,text" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toMatchObject({ fields: "id,text" });
  });
});
