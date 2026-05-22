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

describe("ig_get_conversations pagination cursors", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgMessagingTools(server as never, client);
  });

  it("omits both cursors when neither is provided", async () => {
    await server.callTool("ig_get_conversations", {});

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).not.toHaveProperty("after");
    expect(call[2]).not.toHaveProperty("before");
  });

  it("forwards before cursor when provided alone", async () => {
    await server.callTool("ig_get_conversations", { before: "cursor-prev" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toMatchObject({ before: "cursor-prev" });
    expect(call[2]).not.toHaveProperty("after");
  });

  it("forwards both cursors when both are provided", async () => {
    await server.callTool("ig_get_conversations", { after: "cursor-next", before: "cursor-prev" });

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
    await server.callTool("ig_get_messages", { conversation_id: "conv_1" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).not.toHaveProperty("after");
    expect(call[2]).not.toHaveProperty("before");
  });

  it("forwards before cursor when provided alone", async () => {
    await server.callTool("ig_get_messages", { conversation_id: "conv_1", before: "cursor-prev" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toMatchObject({ before: "cursor-prev" });
    expect(call[2]).not.toHaveProperty("after");
  });

  it("forwards both cursors when both are provided", async () => {
    await server.callTool("ig_get_messages", { conversation_id: "conv_1", after: "cursor-next", before: "cursor-prev" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toMatchObject({ after: "cursor-next", before: "cursor-prev" });
  });
});

describe("ig_send_message messaging_type and tag", () => {
  let server: MockServer;
  let client: MetaClient;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgMessagingTools(server as never, client);
  });

  it("defaults messaging_type to RESPONSE and omits tag", async () => {
    await server.callTool("ig_send_message", { recipient_id: "user_1", message: "hello" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("POST");
    expect(call[1]).toBe("/123/messages");
    expect(call[2]).toBeUndefined();
    expect(call[3].jsonBody).toEqual({
      recipient: { id: "user_1" },
      message: { text: "hello" },
      messaging_type: "RESPONSE",
    });
    expect(call[3].jsonBody).not.toHaveProperty("tag");
  });

  it("forwards explicit messaging_type=UPDATE without a tag", async () => {
    await server.callTool("ig_send_message", {
      recipient_id: "user_1",
      message: "shipping update",
      messaging_type: "UPDATE",
    });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[3].jsonBody.messaging_type).toBe("UPDATE");
    expect(call[3].jsonBody).not.toHaveProperty("tag");
  });

  it("forwards MESSAGE_TAG + HUMAN_AGENT for the 7-day window", async () => {
    await server.callTool("ig_send_message", {
      recipient_id: "user_1",
      message: "support follow-up",
      messaging_type: "MESSAGE_TAG",
      tag: "HUMAN_AGENT",
    });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[3].jsonBody).toEqual({
      recipient: { id: "user_1" },
      message: { text: "support follow-up" },
      messaging_type: "MESSAGE_TAG",
      tag: "HUMAN_AGENT",
    });
  });

  it.each([
    "CONFIRMED_EVENT_UPDATE",
    "POST_PURCHASE_UPDATE",
    "ACCOUNT_UPDATE",
    "CUSTOMER_FEEDBACK",
  ] as const)("accepts %s tag via MESSAGE_TAG", async (tag) => {
    await server.callTool("ig_send_message", {
      recipient_id: "user_1",
      message: "tagged",
      messaging_type: "MESSAGE_TAG",
      tag,
    });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[3].jsonBody.tag).toBe(tag);
  });

  it("rejects MESSAGE_TAG without a tag and skips the API call", async () => {
    const result = await server.callTool("ig_send_message", {
      recipient_id: "user_1",
      message: "missing tag",
      messaging_type: "MESSAGE_TAG",
    }) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error_type).toBe("validation");
    expect(payload.message).toMatch(/messaging_type=MESSAGE_TAG requires a tag/);
    expect(client.ig).not.toHaveBeenCalled();
  });

  it("rejects tag when messaging_type is not MESSAGE_TAG", async () => {
    const result = await server.callTool("ig_send_message", {
      recipient_id: "user_1",
      message: "stray tag",
      tag: "HUMAN_AGENT",
    }) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error_type).toBe("validation");
    expect(payload.message).toMatch(/tag is only valid when messaging_type=MESSAGE_TAG/);
    expect(client.ig).not.toHaveBeenCalled();
  });

  it("rejects unknown tag values via the Zod enum", async () => {
    await expect(
      server.callTool("ig_send_message", {
        recipient_id: "user_1",
        message: "bad tag",
        messaging_type: "MESSAGE_TAG",
        tag: "NOT_A_REAL_TAG",
      })
    ).rejects.toThrow();
    expect(client.ig).not.toHaveBeenCalled();
  });
});
