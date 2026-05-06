import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { registerIgMediaTools } from "./media.js";
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

describe("ig_get_media_list limit=0", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgMediaTools(server as never, client);
  });

  it("includes limit when value is 0", async () => {
    await server.callTool("ig_get_media_list", { limit: 0 });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toHaveProperty("limit", 0);
  });

  it("excludes limit when undefined", async () => {
    await server.callTool("ig_get_media_list", {});

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).not.toHaveProperty("limit");
  });

  it("includes limit when value is non-zero", async () => {
    await server.callTool("ig_get_media_list", { limit: 50 });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toHaveProperty("limit", 50);
  });
});

describe("ig_get_media default fields", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgMediaTools(server as never, client);
  });

  it("uses schema default fields when fields is omitted", async () => {
    await server.callTool("ig_get_media", { media_id: "media_1" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe("/media_1");
    expect(call[2]).toEqual({
      fields: "id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,like_count,comments_count",
    });
  });

  it("passes through caller-provided fields verbatim", async () => {
    await server.callTool("ig_get_media", { media_id: "media_2", fields: "id,caption" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toEqual({ fields: "id,caption" });
  });
});

describe("ig_get_media_insights default metric", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgMediaTools(server as never, client);
  });

  it("uses views,reach as default when no metric is provided", async () => {
    await server.callTool("ig_get_media_insights", { media_id: "media_1" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe("/media_1/insights");
    expect(call[2]).toEqual({ metric: "views,reach" });
  });

  it("passes through caller-provided metric verbatim", async () => {
    await server.callTool("ig_get_media_insights", { media_id: "media_2", metric: "views,reach,likes,comments,shares,reposts,reels_skip_rate" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe("/media_2/insights");
    expect(call[2]).toEqual({ metric: "views,reach,likes,comments,shares,reposts,reels_skip_rate" });
  });
});
