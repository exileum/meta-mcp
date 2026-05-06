import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerThreadsInsightTools } from "./insights.js";
import { MetaClient } from "../../services/meta-client.js";
import { makeMockServer, type MockServer } from "../test-utils.js";

function makeMockClient(response: unknown = { data: [] }): MetaClient {
  return {
    threads: vi.fn(async () => ({ data: response, rateLimit: undefined })),
    threadsUserId: "user-123",
  } as unknown as MetaClient;
}

describe("threads_get_post_insights", () => {
  let server: MockServer;
  let client: MetaClient;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerThreadsInsightTools(server as never, client);
  });

  it("includes shares in default post-level metrics", async () => {
    await server.callTool("threads_get_post_insights", { post_id: "post-456" });

    expect(client.threads).toHaveBeenCalledWith("GET", "/post-456/insights", {
      metric: "views,likes,replies,reposts,quotes,shares",
    });
  });

  it("passes custom metric when provided", async () => {
    await server.callTool("threads_get_post_insights", { post_id: "post-456", metric: "views,likes" });

    expect(client.threads).toHaveBeenCalledWith("GET", "/post-456/insights", {
      metric: "views,likes",
    });
  });

  it("returns error content on API failure", async () => {
    const failingClient = {
      threads: vi.fn(async () => { throw new Error("Invalid metric"); }),
      threadsUserId: "user-123",
    } as unknown as MetaClient;
    const failingServer = makeMockServer();
    registerThreadsInsightTools(failingServer as never, failingClient);

    const result = await failingServer.callTool("threads_get_post_insights", { post_id: "post-456" }) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid metric");
  });
});

describe("threads_get_user_insights", () => {
  let server: MockServer;
  let client: MetaClient;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerThreadsInsightTools(server as never, client);
  });

  it("passes period to the API (explicit value)", async () => {
    await server.callTool("threads_get_user_insights", { metric: "views", period: "lifetime" });

    expect(client.threads).toHaveBeenCalledWith("GET", "/user-123/threads_insights", {
      metric: "views",
      period: "lifetime",
    });
  });

  it("defaults period to 'day' when omitted", async () => {
    await server.callTool("threads_get_user_insights", { metric: "likes" });

    expect(client.threads).toHaveBeenCalledWith("GET", "/user-123/threads_insights", {
      metric: "likes",
      period: "day",
    });
  });

  it("includes since and until when provided", async () => {
    await server.callTool("threads_get_user_insights", { metric: "views", period: "day", since: "1712991600", until: "1713078000" });

    expect(client.threads).toHaveBeenCalledWith("GET", "/user-123/threads_insights", {
      metric: "views",
      period: "day",
      since: "1712991600",
      until: "1713078000",
    });
  });

  it("returns error content on API failure", async () => {
    const failingClient = {
      threads: vi.fn(async () => { throw new Error("API rate limit"); }),
      threadsUserId: "user-123",
    } as unknown as MetaClient;
    const failingServer = makeMockServer();
    registerThreadsInsightTools(failingServer as never, failingClient);

    const result = await failingServer.callTool("threads_get_user_insights", { metric: "views", period: "day" }) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("API rate limit");
  });
});
