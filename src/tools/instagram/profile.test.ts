import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerIgProfileTools } from "./profile.js";
import { MetaClient } from "../../services/meta-client.js";
import { makeMockServer, type MockServer } from "../test-utils.js";

function makeMockClient(): MetaClient {
  return {
    igUserId: "123",
    ig: vi.fn(async () => ({
      data: { business_discovery: { id: "456", username: "target" } },
      rateLimit: undefined,
    })),
  } as unknown as MetaClient;
}

describe("ig_business_discovery", () => {
  let server: MockServer;
  let client: MetaClient;

  beforeEach(() => {
    server = makeMockServer();
    client = makeMockClient();
    registerIgProfileTools(server as never, client);
  });

  it("uses schema default fields when fields is omitted", async () => {
    await server.callTool("ig_business_discovery", { username: "target" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("GET");
    expect(call[1]).toBe("/123");
    expect(call[2]).toEqual({
      fields: "business_discovery.fields(id,username,name,biography,followers_count,follows_count,media_count){username=target}",
    });
  });

  it("passes through caller-provided fields verbatim", async () => {
    await server.callTool("ig_business_discovery", { username: "target", fields: "id,username,profile_picture_url" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toEqual({
      fields: "business_discovery.fields(id,username,profile_picture_url){username=target}",
    });
  });

  it("returns error content on API failure", async () => {
    const failingClient = {
      igUserId: "123",
      ig: vi.fn(async () => { throw new Error("Account not found"); }),
    } as unknown as MetaClient;
    const failingServer = makeMockServer();
    registerIgProfileTools(failingServer as never, failingClient);

    const result = await failingServer.callTool("ig_business_discovery", { username: "missing" }) as { content: { text: string }[]; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Account not found");
  });
});
