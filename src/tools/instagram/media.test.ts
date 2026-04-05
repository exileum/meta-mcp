import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerIgMediaTools } from "./media.js";
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
      data: { data: [] },
      rateLimit: undefined,
    })),
  } as unknown as MetaClient;
}

describe("ig_get_media_list limit=0", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgMediaTools(server as never, client);
  });

  it("includes limit when value is 0", async () => {
    const handler = server.tools.get("ig_get_media_list")!;
    await handler({ limit: 0 });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toHaveProperty("limit", 0);
  });

  it("excludes limit when undefined", async () => {
    const handler = server.tools.get("ig_get_media_list")!;
    await handler({});

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).not.toHaveProperty("limit");
  });

  it("includes limit when value is non-zero", async () => {
    const handler = server.tools.get("ig_get_media_list")!;
    await handler({ limit: 50 });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toHaveProperty("limit", 50);
  });
});
