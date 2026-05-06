import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MetaClient } from "../../services/meta-client.js";
import { registerThreadsInsightTools } from "./insights.js";

type ZodShape = Record<string, z.ZodTypeAny>;
type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;
type RegisteredTool = { schema: ZodShape; handler: ToolHandler };
const registeredTools = new Map<string, RegisteredTool>();

const mockServer = {
  tool: vi.fn((name: string, _desc: string, schema: ZodShape, handler: ToolHandler) => {
    registeredTools.set(name, { schema, handler });
  }),
} as unknown as McpServer;

async function callTool(name: string, args: Record<string, unknown>) {
  const tool = registeredTools.get(name);
  if (!tool) throw new Error(`Tool ${name} not registered`);
  const parsed = z.object(tool.schema).parse(args) as Record<string, unknown>;
  return tool.handler(parsed);
}

function makeMockClient(response: unknown = { data: [] }): MetaClient {
  return {
    threads: vi.fn(async () => ({ data: response, rateLimit: undefined })),
    threadsUserId: "user-123",
  } as unknown as MetaClient;
}

describe("threads_get_post_insights", () => {
  it("includes shares in default post-level metrics", async () => {
    const client = makeMockClient();
    registeredTools.clear();
    registerThreadsInsightTools(mockServer, client);

    await callTool("threads_get_post_insights", { post_id: "post-456" });

    expect(client.threads).toHaveBeenCalledWith("GET", "/post-456/insights", {
      metric: "views,likes,replies,reposts,quotes,shares",
    });
  });

  it("passes custom metric when provided", async () => {
    const client = makeMockClient();
    registeredTools.clear();
    registerThreadsInsightTools(mockServer, client);

    await callTool("threads_get_post_insights", { post_id: "post-456", metric: "views,likes" });

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

    const result = await callTool("threads_get_post_insights", { post_id: "post-456" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid metric");
  });
});

describe("threads_get_user_insights", () => {
  it("passes period to the API (explicit value)", async () => {
    const client = makeMockClient();
    registeredTools.clear();
    registerThreadsInsightTools(mockServer, client);

    await callTool("threads_get_user_insights", { metric: "views", period: "lifetime" });

    expect(client.threads).toHaveBeenCalledWith("GET", "/user-123/threads_insights", {
      metric: "views",
      period: "lifetime",
    });
  });

  it("defaults period to 'day' when omitted", async () => {
    const client = makeMockClient();
    registeredTools.clear();
    registerThreadsInsightTools(mockServer, client);

    await callTool("threads_get_user_insights", { metric: "likes" });

    expect(client.threads).toHaveBeenCalledWith("GET", "/user-123/threads_insights", {
      metric: "likes",
      period: "day",
    });
  });

  it("includes since and until when provided", async () => {
    const client = makeMockClient();
    registeredTools.clear();
    registerThreadsInsightTools(mockServer, client);

    await callTool("threads_get_user_insights", { metric: "views", period: "day", since: "1712991600", until: "1713078000" });

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

    const result = await callTool("threads_get_user_insights", { metric: "views", period: "day" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("API rate limit");
  });
});
