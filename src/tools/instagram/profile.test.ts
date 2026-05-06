import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { registerIgProfileTools } from "./profile.js";
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
      data: { business_discovery: { id: "456", username: "target" } },
      rateLimit: undefined,
    })),
  } as unknown as MetaClient;
}

describe("ig_business_discovery", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgProfileTools(server as never, client);
  });

  it("uses schema default fields when fields is omitted", async () => {
    await server.callTool("ig_business_discovery", { username: "target" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("GET");
    expect(call[1]).toBe("/123");
    expect(call[2]).toEqual({
      fields: "business_discovery.fields(id,username,name,biography,followers_count,follows_count,media_count){username=target}",
    });
  });

  it("passes through caller-provided fields verbatim", async () => {
    await server.callTool("ig_business_discovery", { username: "target", fields: "id,username,profile_picture_url" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toEqual({
      fields: "business_discovery.fields(id,username,profile_picture_url){username=target}",
    });
  });

  it("returns error content on API failure", async () => {
    const failingClient = {
      igUserId: "123",
      ig: vi.fn(async () => { throw new Error("Account not found"); }),
    } as unknown as MetaClient;
    server = makeMockServer();
    registerIgProfileTools(server as never, failingClient);

    const result = await server.callTool("ig_business_discovery", { username: "missing" }) as { content: { text: string }[]; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Account not found");
  });
});
