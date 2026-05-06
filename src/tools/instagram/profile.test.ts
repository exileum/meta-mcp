import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { registerIgProfileTools } from "./profile.js";
import { MetaClient } from "../../services/meta-client.js";

function makeMockServer() {
  const tools = new Map<string, (...args: unknown[]) => unknown>();
  const schemas = new Map<string, z.ZodRawShape>();
  return {
    tools,
    schemas,
    tool: vi.fn((name: string, _desc: string, schema: z.ZodRawShape, handler: (...args: unknown[]) => unknown) => {
      tools.set(name, handler);
      schemas.set(name, schema);
    }),
  };
}

function makeMockClient(): MetaClient {
  return {
    igUserId: "123",
    ig: vi.fn(async () => ({
      data: { data: [{ name: "views", values: [{ value: 100 }] }] },
      rateLimit: undefined,
    })),
  } as unknown as MetaClient;
}

describe("ig_get_account_insights period enum", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgProfileTools(server as never, client);
  });

  function periodSchema() {
    const raw = server.schemas.get("ig_get_account_insights")!;
    return z.object(raw);
  }

  it("rejects period=month (Meta API has no such period)", () => {
    const result = periodSchema().safeParse({ metric: "views", period: "month" });
    expect(result.success).toBe(false);
  });

  it.each(["day", "week", "days_28", "lifetime"])("accepts period=%s", (period) => {
    const result = periodSchema().safeParse({ metric: "views", period });
    expect(result.success).toBe(true);
  });

  it("rejects unknown periods (e.g. 'year')", () => {
    const result = periodSchema().safeParse({ metric: "views", period: "year" });
    expect(result.success).toBe(false);
  });
});

describe("ig_get_account_insights describe strings", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgProfileTools(server as never, client);
  });

  it("period describe documents the lifetime restriction to follower_count + demographics", () => {
    const raw = server.schemas.get("ig_get_account_insights")!;
    const periodDescription = (raw.period as z.ZodTypeAny).description ?? "";
    expect(periodDescription).toMatch(/lifetime/);
    expect(periodDescription).toMatch(/follower_count/);
    expect(periodDescription).toMatch(/follower_demographics/);
  });

  it("metric describe lists both time-series and lifetime-only metrics", () => {
    const raw = server.schemas.get("ig_get_account_insights")!;
    const metricDescription = (raw.metric as z.ZodTypeAny).description ?? "";
    expect(metricDescription).toMatch(/views/);
    expect(metricDescription).toMatch(/follower_count/);
    expect(metricDescription).toMatch(/follower_demographics/);
  });
});

describe("ig_get_account_insights handler", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgProfileTools(server as never, client);
  });

  it("forwards metric and period to /{ig-user-id}/insights", async () => {
    const handler = server.tools.get("ig_get_account_insights")!;
    await handler({ metric: "views,reach", period: "day" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("GET");
    expect(call[1]).toBe("/123/insights");
    expect(call[2]).toEqual({ metric: "views,reach", period: "day" });
  });

  it("includes since and until when provided", async () => {
    const handler = server.tools.get("ig_get_account_insights")!;
    await handler({ metric: "views", period: "day", since: "1712991600", until: "1713078000" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toEqual({
      metric: "views",
      period: "day",
      since: "1712991600",
      until: "1713078000",
    });
  });

  it("supports follower_count + lifetime combination", async () => {
    const handler = server.tools.get("ig_get_account_insights")!;
    await handler({ metric: "follower_count", period: "lifetime" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toEqual({ metric: "follower_count", period: "lifetime" });
  });

  it("returns isError=true on API failure", async () => {
    const failingClient = {
      igUserId: "123",
      ig: vi.fn(async () => { throw new Error("API rate limit"); }),
    } as unknown as MetaClient;
    const failingServer = makeMockServer();
    registerIgProfileTools(failingServer as never, failingClient);

    const handler = failingServer.tools.get("ig_get_account_insights")!;
    const result = await handler({ metric: "views", period: "day" }) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("API rate limit");
  });
});
