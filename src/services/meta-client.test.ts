import { describe, it, expect, vi, beforeEach } from "vitest";
import { MetaClient } from "./meta-client.js";
import { MetaConfig } from "../config.js";

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

  it("sends Content-Type application/json with JSON body when json option is true", async () => {
    const client = new MetaClient(mockConfig());
    await client.ig("POST", "/ig-user-id/messages", {
      recipient: { id: "123" },
      message: { text: "Hello" },
      messaging_type: "RESPONSE",
    }, { json: true });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      recipient: { id: "123" },
      message: { text: "Hello" },
      messaging_type: "RESPONSE",
    });
  });

  it("puts access_token in query string (not body) when using JSON mode", async () => {
    const client = new MetaClient(mockConfig());
    await client.ig("POST", "/ig-user-id/messages", {
      recipient: { id: "123" },
      message: { text: "Hi" },
    }, { json: true });

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
