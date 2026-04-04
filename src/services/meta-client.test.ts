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
