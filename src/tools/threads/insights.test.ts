import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { registerThreadsInsightTools } from "./insights.js";

// Capture tool registrations from server.tool()
type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;
const registeredTools = new Map<string, ToolHandler>();

const mockServer = {
  tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
    registeredTools.set(name, handler);
  }),
} as unknown as McpServer;

function makeMockClient(response: unknown = { data: [] }): MetaClient {
  return {
    threads: vi.fn(async () => ({ data: response, rateLimit: undefined })),
    threadsUserId: "user-123",
  } as unknown as MetaClient;
}

describe("threads_get_post_insights", () => {
  it("defaults to valid post-level metrics (no clicks)", async () => {
    const client = makeMockClient();
    registeredTools.clear();
    registerThreadsInsightTools(mockServer, client);

    const handler = registeredTools.get("threads_get_post_insights")!;
    await handler({ post_id: "post-456" } as Record<string, unknown>);

    expect(client.threads).toHaveBeenCalledWith("GET", "/post-456/insights", {
      metric: "views,likes,replies,reposts,quotes",
    });
  });

  it("passes custom metric when provided", async () => {
    const client = makeMockClient();
    registeredTools.clear();
    registerThreadsInsightTools(mockServer, client);

    const handler = registeredTools.get("threads_get_post_insights")!;
    await handler({ post_id: "post-456", metric: "views,likes" });

    expect(client.threads).toHaveBeenCalledWith("GET", "/post-456/insights", {
      metric: "views,likes",
    });
  });

  it("returns error content on API failure", async () => {
    const client = {
      threads: vi.fn(async () => { throw new Error("Invalid metric"); }),
      threadsUserId: "user-123",
    } as unknown as MetaClient;
    registeredTools.clear();
    registerThreadsInsightTools(mockServer, client);

    const handler = registeredTools.get("threads_get_post_insights")!;
    const result = await handler({ post_id: "post-456" } as Record<string, unknown>);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid metric");
  });
});

describe("threads_get_user_insights", () => {
  it("passes period to the API (explicit value)", async () => {
    const client = makeMockClient();
    registeredTools.clear();
    registerThreadsInsightTools(mockServer, client);

    const handler = registeredTools.get("threads_get_user_insights")!;
    await handler({ metric: "views", period: "lifetime", since: undefined, until: undefined });

    expect(client.threads).toHaveBeenCalledWith("GET", "/user-123/threads_insights", {
      metric: "views",
      period: "lifetime",
    });
  });

  it("defaults period to 'day' when omitted", async () => {
    const client = makeMockClient();
    registeredTools.clear();
    registerThreadsInsightTools(mockServer, client);

    const handler = registeredTools.get("threads_get_user_insights")!;
    await handler({ metric: "likes" } as Record<string, unknown>);

    expect(client.threads).toHaveBeenCalledWith("GET", "/user-123/threads_insights", {
      metric: "likes",
      period: "day",
    });
  });

  it("includes since and until when provided", async () => {
    const client = makeMockClient();
    registeredTools.clear();
    registerThreadsInsightTools(mockServer, client);

    const handler = registeredTools.get("threads_get_user_insights")!;
    await handler({ metric: "views", period: "day", since: "1712991600", until: "1713078000" });

    expect(client.threads).toHaveBeenCalledWith("GET", "/user-123/threads_insights", {
      metric: "views",
      period: "day",
      since: "1712991600",
      until: "1713078000",
    });
  });

  it("returns error content on API failure", async () => {
    const client = {
      threads: vi.fn(async () => { throw new Error("API rate limit"); }),
      threadsUserId: "user-123",
    } as unknown as MetaClient;
    registeredTools.clear();
    registerThreadsInsightTools(mockServer, client);

    const handler = registeredTools.get("threads_get_user_insights")!;
    const result = await handler({ metric: "views", period: "day", since: undefined, until: undefined });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("API rate limit");
  });
});
