import { describe, it, expect, vi } from "vitest";
import { registerThreadsMediaTools } from "./media.js";
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

describe("threads_get_posts default fields", () => {
  it("requests gif_url (not gif_attachment) in default fields", async () => {
    const server = makeMockServer();
    const client = makeMockClient();
    registerThreadsMediaTools(server as never, client);

    const handler = server.tools.get("threads_get_posts")!;
    await handler({});

    const call = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    const fields = call[2].fields as string;
    expect(fields).toContain("gif_url");
    expect(fields).not.toContain("gif_attachment");
  });
});

describe("threads_get_post default fields", () => {
  it("requests gif_url (not gif_attachment) in default fields", async () => {
    const server = makeMockServer();
    const client = makeMockClient();
    registerThreadsMediaTools(server as never, client);

    const handler = server.tools.get("threads_get_post")!;
    await handler({ post_id: "12345" });

    const call = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    const fields = call[2].fields as string;
    expect(fields).toContain("gif_url");
    expect(fields).not.toContain("gif_attachment");
  });

  it("respects custom fields parameter", async () => {
    const server = makeMockServer();
    const client = makeMockClient();
    registerThreadsMediaTools(server as never, client);

    const handler = server.tools.get("threads_get_post")!;
    await handler({ post_id: "12345", fields: "id,text" });

    const call = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2].fields).toBe("id,text");
  });
});
