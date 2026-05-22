import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  registerThreadsProfileTools,
  THREADS_PROFILE_FIELDS,
  threadsProfileCacheKey,
  THREADS_PROFILE_CACHE_PREFIX,
} from "./profile.js";
import { MetaClient, PROFILE_CACHE_TTL_MS } from "../../services/meta-client.js";
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
    threadsUserId: "threads-1",
    threads: vi.fn(async () => ({
      data: { id: "threads-1", username: "testuser", is_verified: true },
      rateLimit: { callCount: 7 },
    })),
    ...makeMockCache(),
  } as unknown as MetaClient;
}

describe("threads_get_profile field list and caching (#90)", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    vi.useFakeTimers();
    server = makeMockServer();
    client = makeMockClient();
    registerThreadsProfileTools(server as never, client);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("requests the shared THREADS_PROFILE_FIELDS list (including is_eligible_for_geo_gating)", async () => {
    const handler = server.tools.get("threads_get_profile")!;
    await handler({});

    const call = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("GET");
    expect(call[1]).toBe("/threads-1");
    expect(call[2]).toEqual({ fields: THREADS_PROFILE_FIELDS });
    expect(THREADS_PROFILE_FIELDS).toContain("is_eligible_for_geo_gating");
  });

  it("second call within TTL hits the cache (one fetch)", async () => {
    const handler = server.tools.get("threads_get_profile")!;
    await handler({});
    await handler({});

    expect((client.threads as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("cache hit omits _rateLimit (no network call)", async () => {
    const handler = server.tools.get("threads_get_profile")!;
    const first = (await handler({})) as { content: { text: string }[] };
    const second = (await handler({})) as { content: { text: string }[] };

    expect(JSON.parse(first.content[0].text)._rateLimit).toEqual({ callCount: 7 });
    expect(JSON.parse(second.content[0].text)._rateLimit).toBeUndefined();
  });

  it("re-fetches after the TTL has elapsed", async () => {
    const handler = server.tools.get("threads_get_profile")!;
    await handler({});
    vi.advanceTimersByTime(PROFILE_CACHE_TTL_MS);
    await handler({});

    expect((client.threads as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it("cache key is namespaced by threadsUserId", () => {
    expect(threadsProfileCacheKey("threads-1")).toBe(`${THREADS_PROFILE_CACHE_PREFIX}threads-1`);
    expect(threadsProfileCacheKey("threads-1")).not.toBe(threadsProfileCacheKey("threads-2"));
  });
});
