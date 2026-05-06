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
      data: { data: [] },
      rateLimit: undefined,
    })),
  } as unknown as MetaClient;
}

describe("ig_get_collaboration_invites pagination cursors", () => {
  let server: ReturnType<typeof makeMockServer>;
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgProfileTools(server as never, client);
  });

  it("omits both cursors when neither is provided", async () => {
    const handler = server.tools.get("ig_get_collaboration_invites")!;
    await handler({});

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe("/123/collaboration_invites");
    expect(call[2]).not.toHaveProperty("after");
    expect(call[2]).not.toHaveProperty("before");
  });

  it("forwards after cursor when provided alone", async () => {
    const handler = server.tools.get("ig_get_collaboration_invites")!;
    await handler({ after: "cursor-next" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toMatchObject({ after: "cursor-next" });
    expect(call[2]).not.toHaveProperty("before");
  });

  it("forwards before cursor when provided alone", async () => {
    const handler = server.tools.get("ig_get_collaboration_invites")!;
    await handler({ before: "cursor-prev" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toMatchObject({ before: "cursor-prev" });
    expect(call[2]).not.toHaveProperty("after");
  });

  it("forwards both cursors when both are provided", async () => {
    const handler = server.tools.get("ig_get_collaboration_invites")!;
    await handler({ after: "cursor-next", before: "cursor-prev" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toMatchObject({ after: "cursor-next", before: "cursor-prev" });
  });
});
