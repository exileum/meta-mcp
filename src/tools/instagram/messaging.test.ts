import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerIgMessagingTools } from "./messaging.js";
import { MetaClient } from "../../services/meta-client.js";
import { makeMockServer, type MockServer } from "../test-utils.js";

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
  let server: MockServer;
  let client: MetaClient;

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
  let server: MockServer;
  let client: MetaClient;

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
  let server: MockServer;
  let client: MetaClient;

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
