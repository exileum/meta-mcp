import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerIgMessagingTools } from "./messaging.js";
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

describe("ig_get_conversations fields override", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgMessagingTools(server as never, client);
  });

  it("uses hardcoded default fields when fields is omitted", async () => {
    const handler = server.tools.get("ig_get_conversations")!;
    await handler({});

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe("/123/conversations");
    expect(call[2]).toEqual({
      platform: "instagram",
      fields: "id,updated_time,participants,messages{id,message,from,created_time}",
    });
  });

  it("passes through caller-provided fields verbatim", async () => {
    const handler = server.tools.get("ig_get_conversations")!;
    await handler({ fields: "id,updated_time" });

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

  it("uses hardcoded default fields when fields is omitted", async () => {
    const handler = server.tools.get("ig_get_messages")!;
    await handler({ conversation_id: "conv_1" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe("/conv_1/messages");
    expect(call[2]).toEqual({
      fields: "id,message,from,created_time,attachments",
    });
  });

  it("passes through caller-provided fields verbatim", async () => {
    const handler = server.tools.get("ig_get_messages")!;
    await handler({ conversation_id: "conv_2", fields: "id,message" });

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

  it("uses hardcoded default fields when fields is omitted", async () => {
    const handler = server.tools.get("ig_get_message")!;
    await handler({ message_id: "msg_1" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe("/msg_1");
    expect(call[2]).toEqual({
      fields: "id,message,from,created_time,attachments",
    });
  });

  it("passes through caller-provided fields verbatim", async () => {
    const handler = server.tools.get("ig_get_message")!;
    await handler({ message_id: "msg_2", fields: "id,message,reply_to" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toEqual({ fields: "id,message,reply_to" });
  });
});

describe("ig_get_conversations pagination cursors", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgMessagingTools(server as never, client);
  });

  it("omits both cursors when neither is provided", async () => {
    const handler = server.tools.get("ig_get_conversations")!;
    await handler({});

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).not.toHaveProperty("after");
    expect(call[2]).not.toHaveProperty("before");
  });

  it("forwards before cursor when provided alone", async () => {
    const handler = server.tools.get("ig_get_conversations")!;
    await handler({ before: "cursor-prev" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toMatchObject({ before: "cursor-prev" });
    expect(call[2]).not.toHaveProperty("after");
  });

  it("forwards both cursors when both are provided", async () => {
    const handler = server.tools.get("ig_get_conversations")!;
    await handler({ after: "cursor-next", before: "cursor-prev" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toMatchObject({ after: "cursor-next", before: "cursor-prev" });
  });
});

describe("ig_get_messages pagination cursors", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgMessagingTools(server as never, client);
  });

  it("omits both cursors when neither is provided", async () => {
    const handler = server.tools.get("ig_get_messages")!;
    await handler({ conversation_id: "conv_1" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).not.toHaveProperty("after");
    expect(call[2]).not.toHaveProperty("before");
  });

  it("forwards before cursor when provided alone", async () => {
    const handler = server.tools.get("ig_get_messages")!;
    await handler({ conversation_id: "conv_1", before: "cursor-prev" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toMatchObject({ before: "cursor-prev" });
    expect(call[2]).not.toHaveProperty("after");
  });

  it("forwards both cursors when both are provided", async () => {
    const handler = server.tools.get("ig_get_messages")!;
    await handler({ conversation_id: "conv_1", after: "cursor-next", before: "cursor-prev" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toMatchObject({ after: "cursor-next", before: "cursor-prev" });
  });
});
