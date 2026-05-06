import { describe, it, expect, vi, beforeEach } from "vitest";
import { MetaClient } from "./meta-client.js";
import { MetaConfig } from "../config.js";
import { MetaApiError } from "../utils/errors.js";

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

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

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

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

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

    const client = new MetaClient(mockConfig());
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
