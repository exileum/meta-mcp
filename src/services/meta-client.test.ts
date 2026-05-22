import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MetaClient,
  DEFAULT_META_API_VERSION,
  DEFAULT_THREADS_API_VERSION,
  RATE_LIMIT_SLOWDOWN_THRESHOLD,
  RATE_LIMIT_BACKOFF_THRESHOLD,
  RATE_LIMIT_SLOWDOWN_MS,
  RATE_LIMIT_BACKOFF_MS,
  RATE_LIMIT_SNAPSHOT_TTL_MS,
  MAX_RETRY_DELAY_MS,
  parseRetryAfter,
  computeBackoffDelay,
} from "./meta-client.js";
import { MetaConfig } from "../config.js";
import { MetaApiError, MetaNetworkError, formatErrorResponse } from "../utils/errors.js";

function mockConfig(overrides: Partial<MetaConfig> = {}): MetaConfig {
  return {
    appId: "test-app-id",
    appSecret: "test-app-secret",
    instagramAccessToken: "ig-token",
    instagramUserId: "ig-user-id",
    threadsAccessToken: "threads-token",
    threadsUserId: "threads-user-id",
    ...overrides,
  };
}

function jsonResponse(body: object, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("non-JSON response handling", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("wraps non-empty text response in { raw, success } object", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("plain text body", {
        status: 200,
        headers: { "content-type": "text/plain" },
      })
    );

    const client = new MetaClient(mockConfig());
    const result = await client.ig("GET", "/me");

    expect(result.data).toEqual({ raw: "plain text body", success: true });
  });

  it("returns { raw: '', success: true } when text response is empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", {
        status: 200,
        headers: { "content-type": "text/plain" },
      })
    );

    const client = new MetaClient(mockConfig());
    const result = await client.ig("GET", "/me");

    expect(result.data).toEqual({ raw: "", success: true });
  });
});

describe("parseRateLimit", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("maps snake_case x-app-usage fields to camelCase RateLimit", async () => {
    const usage = JSON.stringify({ call_count: 28, total_cpu_time: 15, total_time: 12 });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ id: "123" }, { "x-app-usage": usage })
    );

    const client = new MetaClient(mockConfig());
    const result = await client.ig("GET", "/me");

    expect(result.rateLimit).toEqual({
      callCount: 28,
      totalCpuTime: 15,
      totalTime: 12,
    });
  });

  it("returns undefined rateLimit when x-app-usage header is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ id: "123" })
    );

    const client = new MetaClient(mockConfig());
    const result = await client.ig("GET", "/me");

    expect(result.rateLimit).toBeUndefined();
  });

  it("returns undefined rateLimit when x-app-usage contains invalid JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ id: "123" }, { "x-app-usage": "not-json" })
    );

    const client = new MetaClient(mockConfig());
    const result = await client.ig("GET", "/me");

    expect(result.rateLimit).toBeUndefined();
  });

  // Defensive coercion for the Claude-review PR #233 — `JSON.parse` returns
  // `any`, and if Meta ever serializes a usage field as a string, leaving the
  // value through as-is would feed `Math.max` a string at the throttle site.
  it("coerces stringified numbers in x-app-usage to numeric RateLimit fields", async () => {
    const usage = JSON.stringify({ call_count: "85", total_cpu_time: 12, total_time: "20.5" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ id: "123" }, { "x-app-usage": usage }));

    const client = new MetaClient(mockConfig());
    const result = await client.ig("GET", "/me");

    expect(result.rateLimit).toEqual({ callCount: 85, totalCpuTime: 12, totalTime: 20.5 });
  });

  it("drops non-finite values (NaN, Infinity) from RateLimit rather than propagating them", async () => {
    const usage = JSON.stringify({ call_count: "not-a-number", total_cpu_time: null, total_time: 50 });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ id: "123" }, { "x-app-usage": usage }));

    const client = new MetaClient(mockConfig());
    const result = await client.ig("GET", "/me");

    expect(result.rateLimit).toEqual({ callCount: undefined, totalCpuTime: undefined, totalTime: 50 });
  });
});

describe("MetaClient JSON body mode", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ recipient_id: "123", message_id: "m_456" })
    );
  });

  it("sends Content-Type application/json with JSON body when jsonBody option is set", async () => {
    const client = new MetaClient(mockConfig());
    await client.ig("POST", "/ig-user-id/messages", undefined, {
      jsonBody: {
        recipient: { id: "123" },
        message: { text: "Hello" },
        messaging_type: "RESPONSE",
      },
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [_url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      recipient: { id: "123" },
      message: { text: "Hello" },
      messaging_type: "RESPONSE",
    });
  });

  it("puts access_token in query string (not body) when using jsonBody", async () => {
    const client = new MetaClient(mockConfig());
    await client.ig("POST", "/ig-user-id/messages", undefined, {
      jsonBody: {
        recipient: { id: "123" },
        message: { text: "Hi" },
      },
    });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);

    expect(parsed.searchParams.get("access_token")).toBe("ig-token");
    const body = JSON.parse(init.body as string);
    expect(body).not.toHaveProperty("access_token");
  });

  it("uses form-encoded body by default for POST requests", async () => {
    const client = new MetaClient(mockConfig());
    await client.ig("POST", "/ig-user-id/media_publish", {
      creation_id: "container-123",
    });

    const [_url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("creation_id")).toBe("container-123");
    expect(body.get("access_token")).toBe("ig-token");
  });

  it("includes topic_tag in form-encoded Threads POST body", async () => {
    const client = new MetaClient(mockConfig());
    await client.threads("POST", "/threads-user-id/threads", {
      media_type: "TEXT",
      text: "Hello",
      topic_tag: "Pets",
    });

    const [_url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("topic_tag")).toBe("Pets");
    expect(body.get("media_type")).toBe("TEXT");
    expect(body.get("text")).toBe("Hello");
    expect(body.get("access_token")).toBe("threads-token");
  });
});

// Regression guard for #81 — `String(v)` silently mangles arrays/objects in
// form-encoded params (e.g., `String([1,2,3])` → "1,2,3", `String({a:1})` →
// "[object Object]"). The form-encoded path must reject non-primitives at
// runtime so callers can't accidentally ship corrupted requests.
describe("form-encoded params reject non-primitive values (#81)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));
  });

  it("throws when an array is passed as a form parameter", async () => {
    const client = new MetaClient(mockConfig());
    await expect(
      client.ig("POST", "/x", { children: [1, 2, 3] as unknown as string })
    ).rejects.toThrow(/form parameter "children" has unsupported type "array"/);
  });

  it("throws when a plain object is passed as a form parameter", async () => {
    const client = new MetaClient(mockConfig());
    await expect(
      client.ig("POST", "/x", { user_tags: { username: "foo", x: 0.5 } as unknown as string })
    ).rejects.toThrow(/Form-encoded params must be string \| number \| boolean/);
  });

  it("throws on GET requests too (query-string path)", async () => {
    const client = new MetaClient(mockConfig());
    await expect(
      client.threads("GET", "/x", { foo: { nested: true } as unknown as string })
    ).rejects.toThrow(/form parameter "foo"/);
  });

  it("accepts string, number, and boolean primitives", async () => {
    const client = new MetaClient(mockConfig());
    await expect(
      client.threads("POST", "/x", { s: "hi", n: 42, b: true })
    ).resolves.toBeDefined();
  });

  it("skips undefined, null, and empty string values (existing filter)", async () => {
    const client = new MetaClient(mockConfig());
    await client.threads("POST", "/x", {
      kept: "v",
      gone1: undefined,
      gone2: null,
      gone3: "",
    });
    const fetchMock = vi.mocked(globalThis.fetch);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = new URLSearchParams(init.body as string);
    expect(body.get("kept")).toBe("v");
    expect(body.has("gone1")).toBe(false);
    expect(body.has("gone2")).toBe(false);
    expect(body.has("gone3")).toBe(false);
  });

  it("throws on DELETE with non-primitive params (query-string path)", async () => {
    const client = new MetaClient(mockConfig());
    await expect(
      client.ig("DELETE", "/x", { ids: ["a", "b"] as unknown as string })
    ).rejects.toThrow(/form parameter "ids" has unsupported type "array"/);
  });

  it("rejects combining params with jsonBody", async () => {
    const client = new MetaClient(mockConfig());
    await expect(
      client.ig("POST", "/x", { extra: "v" }, { jsonBody: { body: true } })
    ).rejects.toThrow(/`params` cannot be combined with `options\.jsonBody`/);
  });
});

describe("MetaClient token endpoints", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ access_token: "long-lived-token", expires_in: 5184000 })
    );
  });

  // ── igExchangeToken ────────────────────────────────────────

  describe("igExchangeToken", () => {
    it("calls graph.instagram.com with ig_exchange_token grant_type", async () => {
      const client = new MetaClient(mockConfig());
      await client.igExchangeToken("short-ig-token");

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const parsed = new URL(url);

      expect(parsed.origin).toBe("https://graph.instagram.com");
      expect(parsed.pathname).toBe("/access_token");
      expect(parsed.searchParams.get("grant_type")).toBe("ig_exchange_token");
      expect(parsed.searchParams.get("client_secret")).toBe("test-app-secret");
      expect(parsed.searchParams.get("access_token")).toBe("short-ig-token");
    });

    it("throws when appSecret is missing", async () => {
      const client = new MetaClient(mockConfig({ appSecret: "" }));
      await expect(client.igExchangeToken("tok")).rejects.toThrow("META_APP_SECRET");
    });
  });

  // ── igRefreshToken ─────────────────────────────────────────

  describe("igRefreshToken", () => {
    it("calls graph.instagram.com/refresh_access_token with ig_refresh_token", async () => {
      const client = new MetaClient(mockConfig());
      await client.igRefreshToken("long-ig-token");

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const parsed = new URL(url);

      expect(parsed.origin).toBe("https://graph.instagram.com");
      expect(parsed.pathname).toBe("/refresh_access_token");
      expect(parsed.searchParams.get("grant_type")).toBe("ig_refresh_token");
      expect(parsed.searchParams.get("access_token")).toBe("long-ig-token");
    });
  });

  // ── threadsExchangeToken ───────────────────────────────────

  describe("threadsExchangeToken", () => {
    it("calls graph.threads.net with th_exchange_token grant_type", async () => {
      const client = new MetaClient(mockConfig());
      await client.threadsExchangeToken("short-threads-token");

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const parsed = new URL(url);

      expect(parsed.origin).toBe("https://graph.threads.net");
      expect(parsed.pathname).toBe("/access_token");
      expect(parsed.searchParams.get("grant_type")).toBe("th_exchange_token");
      expect(parsed.searchParams.get("client_secret")).toBe("test-app-secret");
      expect(parsed.searchParams.get("access_token")).toBe("short-threads-token");
    });

    it("throws when appSecret is missing", async () => {
      const client = new MetaClient(mockConfig({ appSecret: "" }));
      await expect(client.threadsExchangeToken("tok")).rejects.toThrow("META_APP_SECRET");
    });
  });

  // ── threadsRefreshToken ────────────────────────────────────

  describe("threadsRefreshToken", () => {
    it("calls graph.threads.net/refresh_access_token with th_refresh_token", async () => {
      const client = new MetaClient(mockConfig());
      await client.threadsRefreshToken("long-threads-token");

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const parsed = new URL(url);

      expect(parsed.origin).toBe("https://graph.threads.net");
      expect(parsed.pathname).toBe("/refresh_access_token");
      expect(parsed.searchParams.get("grant_type")).toBe("th_refresh_token");
      expect(parsed.searchParams.get("access_token")).toBe("long-threads-token");
    });
  });

  // ── no version prefix in token URLs ────────────────────────

  describe("token URLs have no version prefix", () => {
    it("igExchangeToken URL has no /v* prefix", async () => {
      const client = new MetaClient(mockConfig());
      await client.igExchangeToken("tok");
      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).not.toMatch(/\/v\d+/);
    });

    it("igRefreshToken URL has no /v* prefix", async () => {
      const client = new MetaClient(mockConfig());
      await client.igRefreshToken("tok");
      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).not.toMatch(/\/v\d+/);
    });

    it("threadsExchangeToken URL has no /v* prefix", async () => {
      const client = new MetaClient(mockConfig());
      await client.threadsExchangeToken("tok");
      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).not.toMatch(/\/v\d+/);
    });

    it("threadsRefreshToken URL has no /v* prefix", async () => {
      const client = new MetaClient(mockConfig());
      await client.threadsRefreshToken("tok");
      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).not.toMatch(/\/v\d+/);
    });
  });
});

// Regression guard for #70 — Meta Graph API and Threads API versions used to
// be hardcoded as `v25.0` / `v1.0` in three URL string literals; deprecation
// of either version forced a meta-mcp release just to flip the string. The
// version is now an optional constructor knob with `META_API_VERSION` /
// `THREADS_API_VERSION` env-var fallback. Token endpoints stay unversioned.
describe("MetaClient API version override (#70)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    // Fresh Response per call — Response bodies can only be read once, so
    // tests that exercise multiple fetches need mockImplementation, not
    // mockResolvedValue (which would hand out the same exhausted Response).
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the documented defaults (v25.0 for Graph API, v1.0 for Threads)", () => {
    expect(DEFAULT_META_API_VERSION).toBe("v25.0");
    expect(DEFAULT_THREADS_API_VERSION).toBe("v1.0");
  });

  it("default constructor builds /v25.0/ Instagram URLs and /v1.0/ Threads URLs", async () => {
    const client = new MetaClient(mockConfig());
    await client.ig("GET", "/me");
    await client.threads("GET", "/me");

    const [igUrl] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const [threadsUrl] = fetchSpy.mock.calls[1] as [string, RequestInit];

    expect(igUrl).toContain("https://graph.instagram.com/v25.0/me");
    expect(threadsUrl).toContain("https://graph.threads.net/v1.0/me");
  });

  it("metaApiVersion option overrides Instagram and Facebook URLs", async () => {
    const client = new MetaClient(mockConfig(), { metaApiVersion: "v26.0" });
    await client.ig("GET", "/me");
    await client.meta("GET", "/me");

    const [igUrl] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const [fbUrl] = fetchSpy.mock.calls[1] as [string, RequestInit];

    expect(igUrl).toContain("https://graph.instagram.com/v26.0/me");
    expect(fbUrl).toContain("https://graph.facebook.com/v26.0/me");
  });

  it("metaApiVersion override does NOT leak into IG token endpoints", async () => {
    const client = new MetaClient(mockConfig(), { metaApiVersion: "v26.0" });
    await client.igExchangeToken("short-tok");
    await client.igRefreshToken("long-tok");

    const [exchangeUrl] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const [refreshUrl] = fetchSpy.mock.calls[1] as [string, RequestInit];

    expect(exchangeUrl).not.toMatch(/\/v\d+/);
    expect(refreshUrl).not.toMatch(/\/v\d+/);
  });

  it("threadsApiVersion option overrides Threads URLs only", async () => {
    const client = new MetaClient(mockConfig(), { threadsApiVersion: "v2.0" });
    await client.threads("GET", "/me");
    await client.ig("GET", "/me");

    const [threadsUrl] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const [igUrl] = fetchSpy.mock.calls[1] as [string, RequestInit];

    expect(threadsUrl).toContain("https://graph.threads.net/v2.0/me");
    expect(igUrl).toContain("https://graph.instagram.com/v25.0/me");
  });

  it("threadsApiVersion override does NOT leak into Threads token endpoints", async () => {
    const client = new MetaClient(mockConfig(), { threadsApiVersion: "v2.0" });
    await client.threadsExchangeToken("short-tok");
    await client.threadsRefreshToken("long-tok");

    const [exchangeUrl] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const [refreshUrl] = fetchSpy.mock.calls[1] as [string, RequestInit];

    expect(exchangeUrl).not.toMatch(/\/v\d+/);
    expect(refreshUrl).not.toMatch(/\/v\d+/);
  });

  it("META_API_VERSION env var is picked up when no explicit option is passed", async () => {
    vi.stubEnv("META_API_VERSION", "v27.0");
    const client = new MetaClient(mockConfig());
    await client.ig("GET", "/me");

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("https://graph.instagram.com/v27.0/me");
  });

  it("THREADS_API_VERSION env var is picked up when no explicit option is passed", async () => {
    vi.stubEnv("THREADS_API_VERSION", "v3.0");
    const client = new MetaClient(mockConfig());
    await client.threads("GET", "/me");

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("https://graph.threads.net/v3.0/me");
  });

  it("explicit option takes precedence over env var", async () => {
    vi.stubEnv("META_API_VERSION", "v27.0");
    const client = new MetaClient(mockConfig(), { metaApiVersion: "v28.0" });
    await client.ig("GET", "/me");

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("https://graph.instagram.com/v28.0/me");
  });

  it.each([
    ["25", "missing v prefix"],
    ["v25", "missing minor"],
    ["v25.0.1", "extra segment"],
    ["abc", "non-numeric"],
    ["V25.0", "uppercase V"],
  ])("malformed META_API_VERSION %s (%s) falls back to default with stderr warning", async (badValue) => {
    vi.stubEnv("META_API_VERSION", badValue);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const client = new MetaClient(mockConfig());
    await client.ig("GET", "/me");

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`https://graph.instagram.com/${DEFAULT_META_API_VERSION}/me`);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining(`META_API_VERSION="${badValue}"`)
    );
  });

  it("malformed THREADS_API_VERSION falls back to default with stderr warning", async () => {
    vi.stubEnv("THREADS_API_VERSION", "1.0");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const client = new MetaClient(mockConfig());
    await client.threads("GET", "/me");

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`https://graph.threads.net/${DEFAULT_THREADS_API_VERSION}/me`);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining(`THREADS_API_VERSION="1.0"`)
    );
  });

  it("malformed metaApiVersion option falls back to default with stderr warning", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const client = new MetaClient(mockConfig(), { metaApiVersion: "v25-0" });
    await client.ig("GET", "/me");

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`https://graph.instagram.com/${DEFAULT_META_API_VERSION}/me`);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining(`MetaClientOptions.META_API_VERSION="v25-0"`)
    );
  });

  it("malformed threadsApiVersion option falls back to default with stderr warning", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const client = new MetaClient(mockConfig(), { threadsApiVersion: "abc" });
    await client.threads("GET", "/me");

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`https://graph.threads.net/${DEFAULT_THREADS_API_VERSION}/me`);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining(`MetaClientOptions.THREADS_API_VERSION="abc"`)
    );
  });

  it("empty-string metaApiVersion option falls through to default without warning", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const client = new MetaClient(mockConfig(), { metaApiVersion: "" });
    await client.ig("GET", "/me");

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`https://graph.instagram.com/${DEFAULT_META_API_VERSION}/me`);
    // Empty string is treated as "not set" — same as the env-var path — and
    // must NOT slip through to produce a "https://graph.instagram.com//me"
    // double-slash URL.
    expect(url).not.toContain("graph.instagram.com//");
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("empty META_API_VERSION env var falls through to default without warning", async () => {
    vi.stubEnv("META_API_VERSION", "");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const client = new MetaClient(mockConfig());
    await client.ig("GET", "/me");

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`https://graph.instagram.com/${DEFAULT_META_API_VERSION}/me`);
    expect(errSpy).not.toHaveBeenCalled();
  });
});

// Regression guard for #60 — `parseRateLimit()` already surfaced
// `x-app-usage` as `_rateLimit` on tool responses, but the client never
// throttled itself. A burst of MCP tool calls walked into Meta's 100%
// threshold and got 429-ed for up to an hour. The client now consults the
// most recent snapshot before every request and pre-sleeps once usage
// crosses 80% / 90%.
describe("MetaClient rate-limit throttling (#60)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function usageResponse(usage: Partial<{ call_count: number; total_cpu_time: number; total_time: number }>) {
    return jsonResponse({ ok: true }, { "x-app-usage": JSON.stringify(usage) });
  }

  it("does not throttle the first request (no snapshot yet)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(usageResponse({ call_count: 95 }));
    const client = new MetaClient(mockConfig());

    await client.ig("GET", "/me");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("delays the next request by RATE_LIMIT_SLOWDOWN_MS when prior callCount is 85%", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(usageResponse({ call_count: 85 }))
      .mockResolvedValueOnce(jsonResponse({ ok: 2 }));
    const client = new MetaClient(mockConfig());

    await client.ig("GET", "/me");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const second = client.ig("GET", "/me");
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_SLOWDOWN_MS - 1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("delays the next request by RATE_LIMIT_BACKOFF_MS when prior usage is >= 90%", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(usageResponse({ call_count: 92 }))
      .mockResolvedValueOnce(jsonResponse({ ok: 2 }));
    const client = new MetaClient(mockConfig());

    await client.ig("GET", "/me");

    const second = client.ig("GET", "/me");
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_BACKOFF_MS - 1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not delay the next request when prior usage stays below 80%", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(usageResponse({ call_count: 78, total_cpu_time: 70, total_time: 50 }))
      .mockResolvedValueOnce(jsonResponse({ ok: 2 }));
    const client = new MetaClient(mockConfig());

    await client.ig("GET", "/me");
    await client.ig("GET", "/me");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("uses the max of callCount, totalCpuTime, totalTime to pick the delay", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(usageResponse({ call_count: 10, total_cpu_time: 85, total_time: 20 }))
      .mockResolvedValueOnce(jsonResponse({ ok: 2 }));
    const client = new MetaClient(mockConfig());

    await client.ig("GET", "/me");

    const second = client.ig("GET", "/me");
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_SLOWDOWN_MS - 1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("treats undefined fields as 0 — only totalTime present at 95% triggers backoff", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(usageResponse({ total_time: 95 }))
      .mockResolvedValueOnce(jsonResponse({ ok: 2 }));
    const client = new MetaClient(mockConfig());

    await client.ig("GET", "/me");

    const second = client.ig("GET", "/me");
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_BACKOFF_MS - 1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("updates the snapshot from an error response so the next request still throttles", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: "Token expired", code: 190, type: "OAuthException" } }),
          {
            status: 401,
            headers: {
              "content-type": "application/json",
              "x-app-usage": JSON.stringify({ call_count: 95 }),
            },
          }
        )
      )
      .mockResolvedValueOnce(jsonResponse({ ok: 2 }));
    const client = new MetaClient(mockConfig());

    await expect(client.ig("GET", "/me")).rejects.toBeDefined();

    const second = client.ig("GET", "/me");
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_BACKOFF_MS - 1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not clear an existing snapshot when a response lacks x-app-usage", async () => {
    // 1: usage 92%; 2: header-less response (e.g. a token endpoint);
    // 3: still throttled by the 92% snapshot from request 1.
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(usageResponse({ call_count: 92 }))
      .mockResolvedValueOnce(jsonResponse({ ok: 2 }))
      .mockResolvedValueOnce(jsonResponse({ ok: 3 }));
    const client = new MetaClient(mockConfig());

    await client.ig("GET", "/me");
    const second = client.ig("GET", "/me");
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_BACKOFF_MS);
    await second;

    const third = client.ig("GET", "/me");
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_BACKOFF_MS - 1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1);
    await third;
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("logs the throttle decision once per throttled call", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(usageResponse({ call_count: 92 }))
      .mockResolvedValueOnce(jsonResponse({ ok: 2 }));
    const client = new MetaClient(mockConfig());

    await client.ig("GET", "/me");
    expect(errSpy).not.toHaveBeenCalled();

    const second = client.ig("GET", "/me");
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_BACKOFF_MS);
    await second;

    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringMatching(/x-app-usage at 92%.*delaying next request by 5000ms/)
    );
  });

  it("uses the documented threshold and delay constants", () => {
    expect(RATE_LIMIT_SLOWDOWN_THRESHOLD).toBe(80);
    expect(RATE_LIMIT_BACKOFF_THRESHOLD).toBe(90);
    expect(RATE_LIMIT_SLOWDOWN_MS).toBe(1000);
    expect(RATE_LIMIT_BACKOFF_MS).toBe(5000);
    expect(RATE_LIMIT_SNAPSHOT_TTL_MS).toBe(60 * 60 * 1000);
  });

  // Claude-review on PR #233 — a stale 92% snapshot from yesterday should not
  // cause a spurious 5s backoff today. Meta's window is rolling 1h, so we age
  // out the snapshot after RATE_LIMIT_SNAPSHOT_TTL_MS.
  it("discards a stale snapshot after RATE_LIMIT_SNAPSHOT_TTL_MS and does not throttle", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(usageResponse({ call_count: 92 }))
      .mockResolvedValueOnce(jsonResponse({ ok: 2 }));
    const client = new MetaClient(mockConfig());

    await client.ig("GET", "/me");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Advance fake clock past the TTL — the next call should bypass throttling.
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_SNAPSHOT_TTL_MS + 1);

    await client.ig("GET", "/me");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("still throttles when the snapshot is fresh (just below the TTL)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(usageResponse({ call_count: 92 }))
      .mockResolvedValueOnce(jsonResponse({ ok: 2 }));
    const client = new MetaClient(mockConfig());

    await client.ig("GET", "/me");

    // Just under the TTL — must still throttle.
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_SNAPSHOT_TTL_MS - 1);
    const second = client.ig("GET", "/me");
    // After the wait it should still need RATE_LIMIT_BACKOFF_MS more before firing.
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_BACKOFF_MS - 1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  // Regression for the Codex review on PR #233 — the abort signal must be
  // armed AFTER the throttle sleep, otherwise a 5s backoff would eat 5s of
  // the 30s network budget and slow Meta endpoints would spuriously time out.
  it("arms AbortSignal.timeout AFTER the throttle sleep, not before", async () => {
    const timeoutCallTimes: number[] = [];
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      timeoutCallTimes.push(Date.now());
      return realTimeout(ms);
    });

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(usageResponse({ call_count: 92 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new MetaClient(mockConfig());

    // Seed the 92% snapshot. AbortSignal.timeout fires once for this call.
    await client.ig("GET", "/me");
    expect(timeoutSpy).toHaveBeenCalledTimes(1);
    const seedSignalAt = timeoutCallTimes[0];

    // Trigger throttled second call. If the signal were armed at request()
    // entry (the buggy pattern), timeoutSpy would tick to 2 immediately — and
    // its timestamp would equal seedSignalAt. We expect the spy to tick to 2
    // only AFTER the fake clock advances by RATE_LIMIT_BACKOFF_MS.
    const second = client.ig("GET", "/me");
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_BACKOFF_MS);
    await second;

    expect(timeoutSpy).toHaveBeenCalledTimes(2);
    expect(timeoutCallTimes[1] - seedSignalAt).toBe(RATE_LIMIT_BACKOFF_MS);
  });
});

describe("MetaClient throws MetaApiError on failures", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("throws MetaApiError with httpStatus and parsed fields on HTTP error", async () => {
    const errorBody = JSON.stringify({
      error: {
        message: "Invalid OAuth access token.",
        type: "OAuthException",
        code: 190,
        error_subcode: 463,
        fbtrace_id: "AbcTrace123",
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(errorBody, {
        status: 401,
        headers: { "content-type": "application/json" },
      })
    );

    const client = new MetaClient(mockConfig());

    await expect(client.ig("GET", "/me")).rejects.toMatchObject({
      name: "MetaApiError",
      httpStatus: 401,
      apiCode: 190,
      apiSubcode: 463,
      apiType: "OAuthException",
      fbtraceId: "AbcTrace123",
      endpoint: "/me",
      method: "GET",
    });
  });

  it("preserves backwards-compatible message format", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"error":{"message":"Token expired","code":190}}', {
        status: 401,
        headers: { "content-type": "application/json" },
      })
    );

    const client = new MetaClient(mockConfig());

    await expect(client.ig("GET", "/me")).rejects.toThrow(/Meta API GET \/me \(401\):/);
  });

  it("falls back gracefully when error body is not JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Internal Server Error", {
        status: 500,
        headers: { "content-type": "text/plain" },
      })
    );

    // `maxRetries: 0` isolates this test to the error-parsing path. 500 is
    // a retryable status (#61), so without disabling retries the cached
    // mock Response would be re-read across retry attempts and its body
    // would be consumed before the final throw.
    const client = new MetaClient(mockConfig(), { maxRetries: 0 });
    let thrown: unknown;
    try {
      await client.ig("GET", "/me");
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(MetaApiError);
    expect((thrown as MetaApiError).httpStatus).toBe(500);
    expect((thrown as MetaApiError).apiCode).toBeUndefined();
    expect((thrown as MetaApiError).body).toBe("Internal Server Error");
  });

  it("throws MetaApiError on JSON success-status-but-error-body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: "(#100) Invalid parameter",
            type: "GraphMethodException",
            code: 100,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const client = new MetaClient(mockConfig());

    await expect(client.ig("GET", "/me")).rejects.toMatchObject({
      name: "MetaApiError",
      apiCode: 100,
      apiType: "GraphMethodException",
      endpoint: "/me",
    });
  });

  it("preserves 'nonexisting field' substring in MetaApiError message", async () => {
    const errorBody = JSON.stringify({
      error: {
        message: "(#100) Tried accessing nonexisting field (status) on node type",
        type: "GraphMethodException",
        code: 100,
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(errorBody, {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    );

    const client = new MetaClient(mockConfig());

    await expect(client.threads("GET", "/123456")).rejects.toThrow(/nonexisting field/);
  });
});

// Regression guards for #61 — `MetaClient.request()` used to make a single
// `fetch()` attempt; transient 429/5xx and network errors surfaced as
// permanent failures. The retry loop now attempts up to `maxRetries + 1`
// times with exponential backoff and honors a `Retry-After` header.
describe("MetaClient retry logic (#61)", () => {
  function freshJsonResponse(body: object, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json", ...headers },
    });
  }

  function errorResponse(status: number, headers: Record<string, string> = {}): Response {
    return new Response("upstream failure", {
      status,
      headers: { "content-type": "text/plain", ...headers },
    });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("retries on transient failures", () => {
    it("does not retry when the first attempt succeeds", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(() => Promise.resolve(freshJsonResponse({ ok: true })));
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = new MetaClient(mockConfig(), { retryBaseDelayMs: 0, sleep });
      await client.ig("GET", "/me");

      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(sleep).not.toHaveBeenCalled();
    });

    it("retries a 503 once and returns the second response's body", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy
        .mockResolvedValueOnce(errorResponse(503))
        .mockResolvedValueOnce(freshJsonResponse({ id: "after-retry" }));
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = new MetaClient(mockConfig(), { retryBaseDelayMs: 0, sleep });
      const result = await client.ig("GET", "/me");

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledOnce();
      expect(result.data).toEqual({ id: "after-retry" });
    });

    it("retries a 429 the same way as a 5xx", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy
        .mockResolvedValueOnce(errorResponse(429))
        .mockResolvedValueOnce(freshJsonResponse({ id: "after-rate-limit" }));
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = new MetaClient(mockConfig(), { retryBaseDelayMs: 0, sleep });
      const result = await client.ig("GET", "/me");

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(result.data).toEqual({ id: "after-rate-limit" });
    });

    it.each([500, 502, 503, 504])(
      "retries HTTP %i (retryable transient status)",
      async (status) => {
        const fetchSpy = vi.spyOn(globalThis, "fetch");
        fetchSpy
          .mockResolvedValueOnce(errorResponse(status))
          .mockResolvedValueOnce(freshJsonResponse({ ok: true }));
        const sleep = vi.fn().mockResolvedValue(undefined);

        const client = new MetaClient(mockConfig(), { retryBaseDelayMs: 0, sleep });
        await client.ig("GET", "/me");

        expect(fetchSpy).toHaveBeenCalledTimes(2);
      }
    );

    it("retries when fetch itself throws a network error", async () => {
      const networkErr = new TypeError("fetch failed");
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy
        .mockRejectedValueOnce(networkErr)
        .mockImplementation(() => Promise.resolve(freshJsonResponse({ id: "recovered" })));
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = new MetaClient(mockConfig(), { retryBaseDelayMs: 0, sleep });
      const result = await client.ig("GET", "/me");

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledOnce();
      expect(result.data).toEqual({ id: "recovered" });
    });

    it("retries an AbortError (signal timeout) and recovers", async () => {
      const abort = new Error("The operation was aborted");
      abort.name = "AbortError";
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy
        .mockRejectedValueOnce(abort)
        .mockImplementation(() => Promise.resolve(freshJsonResponse({ ok: true })));
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = new MetaClient(mockConfig(), { retryBaseDelayMs: 0, sleep });
      await client.ig("GET", "/me");

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("does not retry permanent failures", () => {
    it.each([400, 401, 403, 404, 422])(
      "does not retry HTTP %i (permanent caller-side error)",
      async (status) => {
        const fetchSpy = vi.spyOn(globalThis, "fetch");
        fetchSpy.mockResolvedValueOnce(
          new Response(JSON.stringify({ error: { message: "nope", code: 100 } }), {
            status,
            headers: { "content-type": "application/json" },
          })
        );

        const client = new MetaClient(mockConfig(), { retryBaseDelayMs: 0 });
        await expect(client.ig("GET", "/me")).rejects.toBeInstanceOf(MetaApiError);

        expect(fetchSpy).toHaveBeenCalledOnce();
      }
    );
  });

  describe("exhausts the retry budget", () => {
    it("makes maxRetries + 1 requests then throws the last MetaApiError", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockImplementation(() => Promise.resolve(errorResponse(503)));
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = new MetaClient(mockConfig(), {
        maxRetries: 3,
        retryBaseDelayMs: 0,
        sleep,
      });

      await expect(client.ig("GET", "/me")).rejects.toMatchObject({
        name: "MetaApiError",
        httpStatus: 503,
      });

      // Initial attempt + 3 retries = 4 fetches, 3 sleeps between them.
      expect(fetchSpy).toHaveBeenCalledTimes(4);
      expect(sleep).toHaveBeenCalledTimes(3);
    });

    it("wraps the last network error in MetaNetworkError after exhausted retries", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const finalErr = new TypeError("fetch failed");
      fetchSpy
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockRejectedValueOnce(finalErr);
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = new MetaClient(mockConfig(), {
        maxRetries: 3,
        retryBaseDelayMs: 0,
        sleep,
      });

      let thrown: unknown;
      try {
        await client.ig("GET", "/me");
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeInstanceOf(MetaNetworkError);
      expect((thrown as MetaNetworkError).kind).toBe("network");
      expect((thrown as MetaNetworkError).cause).toBe(finalErr);
      expect(fetchSpy).toHaveBeenCalledTimes(4);
      expect(sleep).toHaveBeenCalledTimes(3);
    });

    it("post-retry MetaApiError still categorizes as server via formatErrorResponse", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(() =>
        Promise.resolve(errorResponse(503))
      );
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = new MetaClient(mockConfig(), {
        maxRetries: 2,
        retryBaseDelayMs: 0,
        sleep,
      });

      let caught: unknown;
      try {
        await client.ig("GET", "/me");
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(MetaApiError);

      const formatted = formatErrorResponse(caught, "Get profile");
      const payload = JSON.parse(formatted.content[0].text) as Record<string, unknown>;
      expect(payload.error_type).toBe("server");
      expect(payload.remediation).toEqual(expect.stringContaining("retry"));
    });

    it("post-retry rate-limit MetaApiError still categorizes as rate_limit", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(() =>
        Promise.resolve(errorResponse(429))
      );
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = new MetaClient(mockConfig(), {
        maxRetries: 2,
        retryBaseDelayMs: 0,
        sleep,
      });

      let caught: unknown;
      try {
        await client.ig("GET", "/me");
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(MetaApiError);

      const formatted = formatErrorResponse(caught, "Get profile");
      const payload = JSON.parse(formatted.content[0].text) as Record<string, unknown>;
      expect(payload.error_type).toBe("rate_limit");
    });

    it("post-retry network error still categorizes as network", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = new MetaClient(mockConfig(), {
        maxRetries: 2,
        retryBaseDelayMs: 0,
        sleep,
      });

      let caught: unknown;
      try {
        await client.ig("GET", "/me");
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(MetaNetworkError);

      const formatted = formatErrorResponse(caught, "Get profile");
      const payload = JSON.parse(formatted.content[0].text) as Record<string, unknown>;
      expect(payload.error_type).toBe("network");
    });
  });

  describe("non-finite option values fall back to defaults", () => {
    it.each([
      ["Infinity", Number.POSITIVE_INFINITY],
      ["NaN", Number.NaN],
    ])("treats maxRetries: %s as the default (%s would be a footgun)", async (_label, badValue) => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockImplementation(() => Promise.resolve(errorResponse(503)));
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = new MetaClient(mockConfig(), {
        maxRetries: badValue,
        retryBaseDelayMs: 0,
        sleep,
      });

      await expect(client.ig("GET", "/me")).rejects.toBeInstanceOf(MetaApiError);

      // Falls back to DEFAULT_MAX_RETRIES = 3 → 4 fetches total.
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });

    it.each([
      ["Infinity", Number.POSITIVE_INFINITY],
      ["NaN", Number.NaN],
    ])("treats retryBaseDelayMs: %s as the default", async (_label, badValue) => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(errorResponse(503))
        .mockResolvedValueOnce(freshJsonResponse({ ok: true }));
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = new MetaClient(mockConfig(), {
        maxRetries: 1,
        retryBaseDelayMs: badValue,
        sleep,
      });
      await client.ig("GET", "/me");

      // Falls back to DEFAULT_RETRY_BASE_DELAY_MS = 1000 → 1s base, no jitter
      // guarantee → 1000 <= delay <= 1250.
      const [delay] = (sleep.mock.calls[0] ?? []) as [number];
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(1250);
    });
  });

  describe("maxRetries: 0 disables retries", () => {
    it("makes a single fetch call on a retryable 503 and throws immediately", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy.mockResolvedValueOnce(errorResponse(503));
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = new MetaClient(mockConfig(), { maxRetries: 0, sleep });
      await expect(client.ig("GET", "/me")).rejects.toBeInstanceOf(MetaApiError);

      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(sleep).not.toHaveBeenCalled();
    });

    it("makes a single fetch call on a network error and wraps it in MetaNetworkError", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const err = new TypeError("fetch failed");
      fetchSpy.mockRejectedValueOnce(err);
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = new MetaClient(mockConfig(), { maxRetries: 0, sleep });

      let thrown: unknown;
      try {
        await client.ig("GET", "/me");
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(MetaNetworkError);
      expect((thrown as MetaNetworkError).cause).toBe(err);
      expect((thrown as MetaNetworkError).kind).toBe("network");

      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(sleep).not.toHaveBeenCalled();
    });
  });

  describe("Retry-After header is honored", () => {
    it("uses the seconds form when present (Retry-After: 2)", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(errorResponse(429, { "Retry-After": "2" }))
        .mockResolvedValueOnce(freshJsonResponse({ ok: true }));
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = new MetaClient(mockConfig(), { retryBaseDelayMs: 0, sleep });
      await client.ig("GET", "/me");

      expect(sleep).toHaveBeenCalledWith(2000);
    });

    it("uses an HTTP-date form when present and computes the delta from the injected now()", async () => {
      const fixedNow = 1_700_000_000_000;
      const retryAt = new Date(fixedNow + 4000).toUTCString();

      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(errorResponse(503, { "Retry-After": retryAt }))
        .mockResolvedValueOnce(freshJsonResponse({ ok: true }));
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = new MetaClient(mockConfig(), {
        retryBaseDelayMs: 0,
        sleep,
        now: () => fixedNow,
      });
      await client.ig("GET", "/me");

      // HTTP-date precision is 1 second, so allow a 1000 ms tolerance.
      const [delay] = (sleep.mock.calls[0] ?? []) as [number];
      expect(delay).toBeGreaterThanOrEqual(3000);
      expect(delay).toBeLessThanOrEqual(4000);
    });

    it("caps an oversized Retry-After at MAX_RETRY_DELAY_MS (60s)", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(errorResponse(503, { "Retry-After": "999999" }))
        .mockResolvedValueOnce(freshJsonResponse({ ok: true }));
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = new MetaClient(mockConfig(), { retryBaseDelayMs: 0, sleep });
      await client.ig("GET", "/me");

      expect(sleep).toHaveBeenCalledWith(MAX_RETRY_DELAY_MS);
    });

    it("falls back to exponential backoff when Retry-After is unparseable", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(errorResponse(503, { "Retry-After": "definitely-not-a-date" }))
        .mockResolvedValueOnce(freshJsonResponse({ ok: true }));
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = new MetaClient(mockConfig(), { retryBaseDelayMs: 0, sleep });
      await client.ig("GET", "/me");

      // With retryBaseDelayMs=0, exponential is 0 — but sleep was still called.
      expect(sleep).toHaveBeenCalledOnce();
      expect(sleep).toHaveBeenCalledWith(0);
    });
  });

  describe("AbortSignal is fresh per attempt", () => {
    it("each fetch call receives a different AbortSignal", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      fetchSpy
        .mockResolvedValueOnce(errorResponse(503))
        .mockResolvedValueOnce(errorResponse(503))
        .mockResolvedValueOnce(freshJsonResponse({ ok: true }));
      const sleep = vi.fn().mockResolvedValue(undefined);

      const client = new MetaClient(mockConfig(), { retryBaseDelayMs: 0, sleep });
      await client.ig("GET", "/me");

      const signals = fetchSpy.mock.calls.map((call) => (call[1] as RequestInit).signal);
      expect(signals).toHaveLength(3);
      // All three signals must be distinct objects — sharing a single signal
      // would mean the AbortSignal.timeout from attempt 0 leaks into attempt
      // 1 and silently aborts subsequent retries.
      expect(signals[0]).not.toBe(signals[1]);
      expect(signals[1]).not.toBe(signals[2]);
      expect(signals[0]).not.toBe(signals[2]);
    });
  });
});

// Regression guards for #72 — MetaClient.request() previously rethrew raw
// fetch() errors after retries were exhausted, surfacing as "Publish photo
// failed: The operation was aborted" with no endpoint context or
// timeout-vs-network distinction. Failures now arrive as MetaNetworkError.
describe("MetaNetworkError wrapping (#72)", () => {
  function freshJsonResponse(body: object): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("wraps a TimeoutError with kind=timeout and a normalized message", async () => {
    const timeout = new Error("The operation was aborted");
    timeout.name = "TimeoutError";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(timeout);

    const client = new MetaClient(mockConfig(), { maxRetries: 0 });
    let thrown: unknown;
    try {
      await client.ig("GET", "/me");
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(MetaNetworkError);
    const err = thrown as MetaNetworkError;
    expect(err.kind).toBe("timeout");
    expect(err.endpoint).toBe("/me");
    expect(err.method).toBe("GET");
    expect(err.message).toBe("Meta API GET /me: request timed out after 30s");
    expect(err.cause).toBe(timeout);
  });

  it("wraps an AbortError with kind=timeout (defensive cover for older spelling)", async () => {
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(abort);

    const client = new MetaClient(mockConfig(), { maxRetries: 0 });
    let thrown: unknown;
    try {
      await client.ig("GET", "/me");
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(MetaNetworkError);
    expect((thrown as MetaNetworkError).kind).toBe("timeout");
  });

  it("wraps a TypeError('fetch failed') with kind=network and cause.message in the text", async () => {
    const cause = new TypeError("fetch failed");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(cause);

    const client = new MetaClient(mockConfig(), { maxRetries: 0 });
    let thrown: unknown;
    try {
      await client.threads("POST", "/123456/threads");
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(MetaNetworkError);
    const err = thrown as MetaNetworkError;
    expect(err.kind).toBe("network");
    expect(err.endpoint).toBe("/123456/threads");
    expect(err.method).toBe("POST");
    expect(err.message).toBe(
      "Meta API POST /123456/threads: network error — fetch failed"
    );
    expect(err.cause).toBe(cause);
  });

  it("captures the DELETE method and path in the wrapped message", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("connect ECONNREFUSED 127.0.0.1:443"));

    const client = new MetaClient(mockConfig(), { maxRetries: 0 });
    let thrown: unknown;
    try {
      await client.ig("DELETE", "/abc123");
    } catch (e) {
      thrown = e;
    }

    expect((thrown as MetaNetworkError).message).toBe(
      "Meta API DELETE /abc123: network error — connect ECONNREFUSED 127.0.0.1:443"
    );
  });

  it("only wraps after retries are exhausted — recovered fetches still resolve", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(freshJsonResponse({ id: "recovered" }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const client = new MetaClient(mockConfig(), { retryBaseDelayMs: 0, sleep });
    const result = await client.ig("GET", "/me");

    expect(result.data).toEqual({ id: "recovered" });
  });

  it("formatErrorResponse routes the wrapped error to network with remediation", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));

    const client = new MetaClient(mockConfig(), { maxRetries: 0 });
    let caught: unknown;
    try {
      await client.ig("GET", "/me");
    } catch (e) {
      caught = e;
    }

    const formatted = formatErrorResponse(caught, "Get profile");
    const payload = JSON.parse(formatted.content[0].text) as Record<string, unknown>;
    expect(payload.error_type).toBe("network");
    expect(payload.message).toBe(
      "Get profile failed: Meta API GET /me: network error — fetch failed"
    );
    expect(payload.remediation).toEqual(expect.stringContaining("Retry"));
  });
});

describe("parseRetryAfter", () => {
  it("returns undefined for a null or empty header value", () => {
    expect(parseRetryAfter(null, 0)).toBeUndefined();
    expect(parseRetryAfter("", 0)).toBeUndefined();
    expect(parseRetryAfter("   ", 0)).toBeUndefined();
  });

  it("parses integer seconds form", () => {
    expect(parseRetryAfter("5", 0)).toBe(5000);
    expect(parseRetryAfter("0", 0)).toBe(0);
    expect(parseRetryAfter("60", 0)).toBe(60_000);
  });

  it("parses fractional seconds form", () => {
    expect(parseRetryAfter("1.5", 0)).toBe(1500);
  });

  it("clamps negative seconds to zero (server time skew)", () => {
    expect(parseRetryAfter("-5", 0)).toBe(0);
  });

  it("parses HTTP-date form and returns the delta from nowMs", () => {
    const now = 1_700_000_000_000;
    const future = new Date(now + 5_000).toUTCString();
    const result = parseRetryAfter(future, now);
    // HTTP-date precision is 1 second, allow tolerance.
    expect(result).toBeGreaterThanOrEqual(4000);
    expect(result).toBeLessThanOrEqual(5000);
  });

  it("clamps past HTTP-date to zero", () => {
    const now = 1_700_000_000_000;
    const past = new Date(now - 10_000).toUTCString();
    expect(parseRetryAfter(past, now)).toBe(0);
  });

  it("returns undefined for unparseable values", () => {
    expect(parseRetryAfter("nope", 0)).toBeUndefined();
    expect(parseRetryAfter("abc123", 0)).toBeUndefined();
  });
});

describe("computeBackoffDelay", () => {
  it("returns base delay for attempt 0 with zero jitter", () => {
    expect(computeBackoffDelay(0, 1000, () => 0)).toBe(1000);
  });

  it("doubles per attempt (exponential growth)", () => {
    expect(computeBackoffDelay(0, 1000, () => 0)).toBe(1000);
    expect(computeBackoffDelay(1, 1000, () => 0)).toBe(2000);
    expect(computeBackoffDelay(2, 1000, () => 0)).toBe(4000);
    expect(computeBackoffDelay(3, 1000, () => 0)).toBe(8000);
  });

  it("applies up to 25% jitter (upper bound)", () => {
    expect(computeBackoffDelay(0, 1000, () => 1)).toBe(1250);
    expect(computeBackoffDelay(2, 1000, () => 1)).toBe(5000); // 4000 + 1000
  });

  it("caps at MAX_RETRY_DELAY_MS", () => {
    expect(computeBackoffDelay(20, 1000, () => 0)).toBe(MAX_RETRY_DELAY_MS);
    expect(computeBackoffDelay(20, 1000, () => 1)).toBe(MAX_RETRY_DELAY_MS);
  });

  it("returns 0 when baseDelayMs is 0 (test fast path)", () => {
    expect(computeBackoffDelay(0, 0, () => 0)).toBe(0);
    expect(computeBackoffDelay(5, 0, () => 1)).toBe(0);
  });
});
