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
    igUserId: "123",
    ig: vi.fn(async () => ({
      data: {},
      rateLimit: undefined,
    })),
  } as unknown as MetaClient;
}

describe("ig_business_discovery field expression syntax", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgProfileTools(server as never, client);
  });

  it("uses canonical business_discovery.username(USERNAME){fields} syntax with default fields", async () => {
    const handler = server.tools.get("ig_business_discovery")!;
    await handler({ username: "bluebottle" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("GET");
    expect(call[1]).toBe("/123");
    expect(call[2]).toEqual({
      fields: "business_discovery.username(bluebottle){id,username,name,biography,followers_count,follows_count,media_count}",
    });
  });

  it("passes caller-provided fields through inside the canonical {fields} braces", async () => {
    const handler = server.tools.get("ig_business_discovery")!;
    await handler({ username: "bluebottle", fields: "id,username,followers_count" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("GET");
    expect(call[1]).toBe("/123");
    expect(call[2]).toEqual({
      fields: "business_discovery.username(bluebottle){id,username,followers_count}",
    });
  });
});
