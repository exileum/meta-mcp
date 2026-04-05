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

describe("threads_search_posts", () => {
  it("calls /keyword_search endpoint (not user-scoped)", async () => {
    const server = makeMockServer();
    const client = makeMockClient();
    registerThreadsMediaTools(server as never, client);

    const handler = server.tools.get("threads_search_posts")!;
    await handler({ q: "test query" });

    const call = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("GET");
    expect(call[1]).toBe("/keyword_search");
    expect(call[2].q).toBe("test query");
  });

  it("forwards search_type and search_mode as separate params", async () => {
    const server = makeMockServer();
    const client = makeMockClient();
    registerThreadsMediaTools(server as never, client);

    const handler = server.tools.get("threads_search_posts")!;
    await handler({ q: "test", search_type: "RECENT", search_mode: "TAG" });

    const call = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2].search_type).toBe("RECENT");
    expect(call[2].search_mode).toBe("TAG");
  });

  it("forwards optional filter params correctly", async () => {
    const server = makeMockServer();
    const client = makeMockClient();
    registerThreadsMediaTools(server as never, client);

    const handler = server.tools.get("threads_search_posts")!;
    await handler({
      q: "test",
      media_type: "IMAGE",
      author_username: "testuser",
      since: "1700000000",
      until: "1700100000",
      limit: 50,
    });

    const call = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2].media_type).toBe("IMAGE");
    expect(call[2].author_username).toBe("testuser");
    expect(call[2].since).toBe("1700000000");
    expect(call[2].until).toBe("1700100000");
    expect(call[2].limit).toBe(50);
  });

  it("omits optional params when not provided", async () => {
    const server = makeMockServer();
    const client = makeMockClient();
    registerThreadsMediaTools(server as never, client);

    const handler = server.tools.get("threads_search_posts")!;
    await handler({ q: "minimal" });

    const call = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toEqual({
      q: "minimal",
      fields: "id,text,username,permalink,timestamp,media_type,media_url,topic_tag",
    });
  });
});
