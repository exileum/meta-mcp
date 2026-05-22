import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerMetaAuthTools } from "./auth.js";
import { makeMockServer } from "../test-utils.js";
import { MetaClient } from "../../services/meta-client.js";
import { MetaConfig } from "../../config.js";

function mockConfig(overrides: Partial<MetaConfig> = {}): MetaConfig {
  return {
    appId: "test-app-id",
    appSecret: "test-app-secret",
    instagramAccessToken: "ig-old",
    instagramUserId: "ig-user-id",
    threadsAccessToken: "threads-old",
    threadsUserId: "threads-user-id",
    ...overrides,
  };
}

function jsonResponse(body: object): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("meta_exchange_token auto-apply (#65)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchSpy = vi.spyOn(globalThis, "fetch");
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates the running Instagram token so the next ig() call uses it", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ access_token: "ig-new", token_type: "bearer", expires_in: 5184000 })
    );
    fetchSpy.mockResolvedValueOnce(jsonResponse({ id: "me" }));

    const server = makeMockServer();
    const client = new MetaClient(mockConfig());
    registerMetaAuthTools(server as never, client);

    await server.callTool("meta_exchange_token", {
      short_lived_token: "ig-short",
      platform: "instagram",
    });
    await client.ig("GET", "/me");

    const [followUpUrl] = fetchSpy.mock.calls[1] as [string];
    expect(new URL(followUpUrl).searchParams.get("access_token")).toBe("ig-new");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Instagram access token updated in-memory after meta_exchange_token")
    );
  });

  it("updates the running Threads token so the next threads() call uses it", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ access_token: "threads-new", token_type: "bearer", expires_in: 5184000 })
    );
    fetchSpy.mockResolvedValueOnce(jsonResponse({ id: "me" }));

    const server = makeMockServer();
    const client = new MetaClient(mockConfig());
    registerMetaAuthTools(server as never, client);

    await server.callTool("meta_exchange_token", {
      short_lived_token: "threads-short",
      platform: "threads",
    });
    await client.threads("GET", "/me");

    const [followUpUrl] = fetchSpy.mock.calls[1] as [string];
    expect(new URL(followUpUrl).searchParams.get("access_token")).toBe("threads-new");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Threads access token updated in-memory after meta_exchange_token")
    );
  });

  it("does not cross-contaminate: instagram exchange leaves the threads token untouched", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ access_token: "ig-new", token_type: "bearer", expires_in: 5184000 })
    );
    fetchSpy.mockResolvedValueOnce(jsonResponse({ id: "me" }));

    const server = makeMockServer();
    const client = new MetaClient(mockConfig());
    registerMetaAuthTools(server as never, client);

    await server.callTool("meta_exchange_token", {
      short_lived_token: "ig-short",
      platform: "instagram",
    });
    await client.threads("GET", "/me");

    const [followUpUrl] = fetchSpy.mock.calls[1] as [string];
    expect(new URL(followUpUrl).searchParams.get("access_token")).toBe("threads-old");
  });

  it("returns the new token in the tool response so the caller can still see it", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ access_token: "ig-new", token_type: "bearer", expires_in: 5184000 })
    );

    const server = makeMockServer();
    const client = new MetaClient(mockConfig());
    registerMetaAuthTools(server as never, client);

    const result = (await server.callTool("meta_exchange_token", {
      short_lived_token: "ig-short",
      platform: "instagram",
    })) as { content: Array<{ type: string; text: string }> };
    const payload = JSON.parse(result.content[0].text) as { access_token: string };

    expect(payload.access_token).toBe("ig-new");
  });

  it("leaves the stored token untouched when the response has no access_token", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ token_type: "bearer" }));
    fetchSpy.mockResolvedValueOnce(jsonResponse({ id: "me" }));

    const server = makeMockServer();
    const client = new MetaClient(mockConfig());
    registerMetaAuthTools(server as never, client);

    await server.callTool("meta_exchange_token", {
      short_lived_token: "ig-short",
      platform: "instagram",
    });
    await client.ig("GET", "/me");

    const [followUpUrl] = fetchSpy.mock.calls[1] as [string];
    expect(new URL(followUpUrl).searchParams.get("access_token")).toBe("ig-old");
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("access token updated in-memory")
    );
  });

  it("does not mutate the running token when the exchange call fails", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "bad token", code: 190 } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    );
    fetchSpy.mockResolvedValueOnce(jsonResponse({ id: "me" }));

    const server = makeMockServer();
    const client = new MetaClient(mockConfig(), { maxRetries: 0 });
    registerMetaAuthTools(server as never, client);

    const result = (await server.callTool("meta_exchange_token", {
      short_lived_token: "ig-short",
      platform: "instagram",
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(result.isError).toBe(true);

    await client.ig("GET", "/me");
    const [followUpUrl] = fetchSpy.mock.calls[1] as [string];
    expect(new URL(followUpUrl).searchParams.get("access_token")).toBe("ig-old");
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("access token updated in-memory")
    );
  });
});

describe("meta_refresh_token auto-apply (#65)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchSpy = vi.spyOn(globalThis, "fetch");
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates the running Instagram token so the next ig() call uses it", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ access_token: "ig-refreshed", token_type: "bearer", expires_in: 5184000 })
    );
    fetchSpy.mockResolvedValueOnce(jsonResponse({ id: "me" }));

    const server = makeMockServer();
    const client = new MetaClient(mockConfig());
    registerMetaAuthTools(server as never, client);

    await server.callTool("meta_refresh_token", {
      long_lived_token: "ig-long",
      platform: "instagram",
    });
    await client.ig("GET", "/me");

    const [followUpUrl] = fetchSpy.mock.calls[1] as [string];
    expect(new URL(followUpUrl).searchParams.get("access_token")).toBe("ig-refreshed");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Instagram access token updated in-memory after meta_refresh_token")
    );
  });

  it("updates the running Threads token so the next threads() call uses it", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ access_token: "threads-refreshed", token_type: "bearer", expires_in: 5184000 })
    );
    fetchSpy.mockResolvedValueOnce(jsonResponse({ id: "me" }));

    const server = makeMockServer();
    const client = new MetaClient(mockConfig());
    registerMetaAuthTools(server as never, client);

    await server.callTool("meta_refresh_token", {
      long_lived_token: "threads-long",
      platform: "threads",
    });
    await client.threads("GET", "/me");

    const [followUpUrl] = fetchSpy.mock.calls[1] as [string];
    expect(new URL(followUpUrl).searchParams.get("access_token")).toBe("threads-refreshed");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Threads access token updated in-memory after meta_refresh_token")
    );
  });

  it("does not mutate the running token when the refresh call fails", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "expired", code: 190 } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    );
    fetchSpy.mockResolvedValueOnce(jsonResponse({ id: "me" }));

    const server = makeMockServer();
    const client = new MetaClient(mockConfig(), { maxRetries: 0 });
    registerMetaAuthTools(server as never, client);

    const result = (await server.callTool("meta_refresh_token", {
      long_lived_token: "threads-long",
      platform: "threads",
    })) as { isError?: boolean };
    expect(result.isError).toBe(true);

    await client.threads("GET", "/me");
    const [followUpUrl] = fetchSpy.mock.calls[1] as [string];
    expect(new URL(followUpUrl).searchParams.get("access_token")).toBe("threads-old");
  });
});

describe("meta_debug_token does not touch stored tokens (#65)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never calls updateConfig regardless of the debug response shape", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ data: { is_valid: true, expires_at: 0, scopes: [] } })
    );
    fetchSpy.mockResolvedValueOnce(jsonResponse({ id: "me" }));

    const server = makeMockServer();
    const client = new MetaClient(mockConfig());
    const updateSpy = vi.spyOn(client, "updateConfig");
    registerMetaAuthTools(server as never, client);

    await server.callTool("meta_debug_token", { input_token: "any" });
    expect(updateSpy).not.toHaveBeenCalled();

    await client.ig("GET", "/me");
    const [followUpUrl] = fetchSpy.mock.calls[1] as [string];
    expect(new URL(followUpUrl).searchParams.get("access_token")).toBe("ig-old");
  });
});
