import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { registerIgMessagingTools } from "./messaging.js";
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

describe("ig_get_conversations fields override", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgMessagingTools(server as never, client);
  });

  it("uses schema default fields when fields is omitted", async () => {
    await server.callTool("ig_get_conversations", {});

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe("/123/conversations");
    expect(call[2]).toEqual({
      platform: "instagram",
      fields: "id,updated_time,participants,messages{id,message,from,created_time}",
    });
  });

  it("passes through caller-provided fields verbatim", async () => {
    await server.callTool("ig_get_conversations", { fields: "id,updated_time" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toMatchObject({
      platform: "instagram",
      fields: "id,updated_time",
    });
  });
});

describe("ig_get_messages fields override", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgMessagingTools(server as never, client);
  });

  it("uses schema default fields when fields is omitted", async () => {
    await server.callTool("ig_get_messages", { conversation_id: "conv_1" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe("/conv_1/messages");
    expect(call[2]).toEqual({
      fields: "id,message,from,created_time,attachments",
    });
  });

  it("passes through caller-provided fields verbatim", async () => {
    await server.callTool("ig_get_messages", { conversation_id: "conv_2", fields: "id,message" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toMatchObject({ fields: "id,message" });
  });
});

describe("ig_get_message fields override", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgMessagingTools(server as never, client);
  });

  it("uses schema default fields when fields is omitted", async () => {
    await server.callTool("ig_get_message", { message_id: "msg_1" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe("/msg_1");
    expect(call[2]).toEqual({
      fields: "id,message,from,created_time,attachments",
    });
  });

  it("passes through caller-provided fields verbatim", async () => {
    await server.callTool("ig_get_message", { message_id: "msg_2", fields: "id,message,reply_to" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toEqual({ fields: "id,message,reply_to" });
  });
});
