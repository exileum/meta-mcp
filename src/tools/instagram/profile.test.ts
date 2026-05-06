import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerIgProfileTools } from "./profile.js";
import { MetaClient } from "../../services/meta-client.js";

function makeMockServer() {
  const tools = new Map<string, (...args: unknown[]) => unknown>();
  return {
    tools,
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (...args: unknown[]) => unknown) => {
      tools.set(name, handler);
    }),
  };
}

function makeMockClient(): MetaClient {
  return {
    igUserId: "user-123",
    ig: vi.fn(async () => ({
      data: { data: [] },
      rateLimit: undefined,
    })),
  } as unknown as MetaClient;
}

describe("ig_get_account_insights", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgProfileTools(server as never, client);
  });

  it("forwards required metric and period to the API", async () => {
    const handler = server.tools.get("ig_get_account_insights")!;
    await handler({ metric: "views,reach", period: "day" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("GET");
    expect(call[1]).toBe("/user-123/insights");
    expect(call[2]).toEqual({ metric: "views,reach", period: "day" });
  });

  it("includes metric_type in the request when provided", async () => {
    const handler = server.tools.get("ig_get_account_insights")!;
    await handler({ metric: "reach", period: "day", metric_type: "time_series" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toEqual({ metric: "reach", period: "day", metric_type: "time_series" });
  });

  it("accepts metric_type='total_value'", async () => {
    const handler = server.tools.get("ig_get_account_insights")!;
    await handler({ metric: "views", period: "day", metric_type: "total_value" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toEqual({ metric: "views", period: "day", metric_type: "total_value" });
  });

  it("omits metric_type from the request when not provided", async () => {
    const handler = server.tools.get("ig_get_account_insights")!;
    await handler({ metric: "views", period: "day" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).not.toHaveProperty("metric_type");
  });

  it("forwards since/until alongside metric_type", async () => {
    const handler = server.tools.get("ig_get_account_insights")!;
    await handler({
      metric: "reach",
      period: "day",
      metric_type: "time_series",
      since: "1712991600",
      until: "1713078000",
    });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toEqual({
      metric: "reach",
      period: "day",
      metric_type: "time_series",
      since: "1712991600",
      until: "1713078000",
    });
  });

  it("returns error content when the API call fails", async () => {
    const failingClient = {
      igUserId: "user-123",
      ig: vi.fn(async () => { throw new Error("metric_type not supported for views"); }),
    } as unknown as MetaClient;
    const failingServer = makeMockServer();
    registerIgProfileTools(failingServer as never, failingClient);

    const handler = failingServer.tools.get("ig_get_account_insights")!;
    const result = await handler({ metric: "views", period: "day", metric_type: "time_series" }) as {
      content: { type: string; text: string }[];
      isError?: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("metric_type not supported for views");
  });
});
