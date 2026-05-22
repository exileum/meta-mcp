import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerIgHashtagTools } from "./hashtags.js";
import { MetaClient, HASHTAG_CACHE_TTL_MS } from "../../services/meta-client.js";
import { makeMockCache } from "../test-utils.js";

function makeMockServer() {
  const tools = new Map<string, (...args: unknown[]) => unknown>();
  return {
    tools,
    registerTool: vi.fn((name: string, _config: unknown, handler: (...args: unknown[]) => unknown) => {
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
    ...makeMockCache(),
  } as unknown as MetaClient;
}

describe("ig_get_hashtag_recent pagination cursors", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgHashtagTools(server as never, client);
  });

  it("omits both cursors when neither is provided", async () => {
    const handler = server.tools.get("ig_get_hashtag_recent")!;
    await handler({ hashtag_id: "h_1" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe("/h_1/recent_media");
    expect(call[2]).not.toHaveProperty("after");
    expect(call[2]).not.toHaveProperty("before");
  });

  it("forwards before cursor when provided alone", async () => {
    const handler = server.tools.get("ig_get_hashtag_recent")!;
    await handler({ hashtag_id: "h_1", before: "cursor-prev" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toMatchObject({ before: "cursor-prev" });
    expect(call[2]).not.toHaveProperty("after");
  });

  it("forwards both cursors when both are provided", async () => {
    const handler = server.tools.get("ig_get_hashtag_recent")!;
    await handler({ hashtag_id: "h_1", after: "cursor-next", before: "cursor-prev" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toMatchObject({ after: "cursor-next", before: "cursor-prev" });
  });
});

describe("ig_get_hashtag_top pagination cursors", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgHashtagTools(server as never, client);
  });

  it("omits both cursors when neither is provided", async () => {
    const handler = server.tools.get("ig_get_hashtag_top")!;
    await handler({ hashtag_id: "h_1" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe("/h_1/top_media");
    expect(call[2]).not.toHaveProperty("after");
    expect(call[2]).not.toHaveProperty("before");
  });

  it("forwards before cursor when provided alone", async () => {
    const handler = server.tools.get("ig_get_hashtag_top")!;
    await handler({ hashtag_id: "h_1", before: "cursor-prev" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toMatchObject({ before: "cursor-prev" });
    expect(call[2]).not.toHaveProperty("after");
  });

  it("forwards both cursors when both are provided", async () => {
    const handler = server.tools.get("ig_get_hashtag_top")!;
    await handler({ hashtag_id: "h_1", after: "cursor-next", before: "cursor-prev" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toMatchObject({ after: "cursor-next", before: "cursor-prev" });
  });
});

describe("ig_search_hashtag cache (#90)", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    vi.useFakeTimers();
    server = makeMockServer();
    client = makeMockClient();
    (client.ig as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { data: [{ id: "h_1" }] },
      rateLimit: { callCount: 5 },
    });
    registerIgHashtagTools(server as never, client);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("identical query within TTL hits the cache (one fetch)", async () => {
    const handler = server.tools.get("ig_search_hashtag")!;
    await handler({ q: "puppies" });
    await handler({ q: "puppies" });

    expect((client.ig as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("different queries each miss the cache (two fetches)", async () => {
    const handler = server.tools.get("ig_search_hashtag")!;
    await handler({ q: "puppies" });
    await handler({ q: "kittens" });

    expect((client.ig as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it("cache hit omits _rateLimit", async () => {
    const handler = server.tools.get("ig_search_hashtag")!;
    const first = (await handler({ q: "puppies" })) as { content: { text: string }[] };
    const second = (await handler({ q: "puppies" })) as { content: { text: string }[] };

    expect(JSON.parse(first.content[0].text)._rateLimit).toEqual({ callCount: 5 });
    expect(JSON.parse(second.content[0].text)._rateLimit).toBeUndefined();
  });

  it("re-fetches after the 7-day TTL has elapsed", async () => {
    const handler = server.tools.get("ig_search_hashtag")!;
    await handler({ q: "puppies" });
    vi.advanceTimersByTime(HASHTAG_CACHE_TTL_MS);
    await handler({ q: "puppies" });

    expect((client.ig as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });
});
