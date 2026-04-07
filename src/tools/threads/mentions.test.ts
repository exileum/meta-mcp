import { describe, it, expect, vi } from "vitest";
import { registerThreadsMentionsTools } from "./mentions.js";
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
    threadsUserId: "threads-123",
    threads: vi.fn(async () => ({
      data: { data: [] },
      rateLimit: undefined,
    })),
  } as unknown as MetaClient;
}

describe("threads_get_mentions", () => {
  it("calls GET /{threadsUserId}/mentions with default fields", async () => {
    const server = makeMockServer();
    const client = makeMockClient();
    registerThreadsMentionsTools(server as never, client);

    const handler = server.tools.get("threads_get_mentions")!;
    await handler({});

    const call = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("GET");
    expect(call[1]).toBe("/threads-123/mentions");
    const fields = call[2].fields as string;
    expect(fields).toContain("id");
    expect(fields).toContain("text");
    expect(fields).toContain("username");
    expect(fields).toContain("permalink");
  });

  it("forwards limit, since, until, after when provided", async () => {
    const server = makeMockServer();
    const client = makeMockClient();
    registerThreadsMentionsTools(server as never, client);

    const handler = server.tools.get("threads_get_mentions")!;
    await handler({
      limit: 10,
      since: "1700000000",
      until: "1700100000",
      after: "cursor-abc",
    });

    const call = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2].limit).toBe(10);
    expect(call[2].since).toBe("1700000000");
    expect(call[2].until).toBe("1700100000");
    expect(call[2].after).toBe("cursor-abc");
  });

  it("omits optional params when not provided", async () => {
    const server = makeMockServer();
    const client = makeMockClient();
    registerThreadsMentionsTools(server as never, client);

    const handler = server.tools.get("threads_get_mentions")!;
    await handler({});

    const call = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).not.toHaveProperty("limit");
    expect(call[2]).not.toHaveProperty("since");
    expect(call[2]).not.toHaveProperty("until");
    expect(call[2]).not.toHaveProperty("after");
  });
});
