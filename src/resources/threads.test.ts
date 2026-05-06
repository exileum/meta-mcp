import { describe, it, expect, vi } from "vitest";
import { registerThreadsResources } from "./threads.js";
import { MetaClient } from "../services/meta-client.js";

type ResourceCall = {
  name: string;
  uri: string;
  metadata: { description: string; mimeType: string };
  handler: () => Promise<unknown>;
};

function makeMockServer() {
  const resources: ResourceCall[] = [];
  return {
    resources,
    resource: vi.fn(
      (
        name: string,
        uri: string,
        metadata: { description: string; mimeType: string },
        handler: () => Promise<unknown>,
      ) => {
        resources.push({ name, uri, metadata, handler });
      },
    ),
  };
}

function makeMockClient(): MetaClient {
  return {
    threadsUserId: "threads-123",
    threads: vi.fn(async () => ({
      data: {
        id: "threads-123",
        username: "testuser",
        is_verified: true,
      },
      rateLimit: undefined,
    })),
  } as unknown as MetaClient;
}

describe("threads-profile resource", () => {
  it("registers under the namespaced meta-mcp:// URI scheme", () => {
    const server = makeMockServer();
    const client = makeMockClient();
    registerThreadsResources(server as never, client);

    expect(server.resources).toHaveLength(1);
    expect(server.resources[0].name).toBe("threads-profile");
    expect(server.resources[0].uri).toBe("meta-mcp://threads/profile");
  });

  it("registers description and application/json mimeType metadata", () => {
    const server = makeMockServer();
    const client = makeMockClient();
    registerThreadsResources(server as never, client);

    expect(server.resources[0].metadata.description).toContain("Threads");
    expect(server.resources[0].metadata.mimeType).toBe("application/json");
  });

  it("handler calls GET /{threadsUserId} with profile fields including is_verified", async () => {
    const server = makeMockServer();
    const client = makeMockClient();
    registerThreadsResources(server as never, client);

    await server.resources[0].handler();

    const call = (client.threads as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("GET");
    expect(call[1]).toBe("/threads-123");
    const fields = call[2].fields as string;
    expect(fields).toContain("id");
    expect(fields).toContain("username");
    expect(fields).toContain("threads_biography");
    expect(fields).toContain("is_verified");
  });

  it("handler returns content with the namespaced meta-mcp:// URI", async () => {
    const server = makeMockServer();
    const client = makeMockClient();
    registerThreadsResources(server as never, client);

    const result = await server.resources[0].handler();
    const contents = (
      result as { contents: { uri: string; mimeType: string; text: string }[] }
    ).contents;

    expect(contents).toHaveLength(1);
    expect(contents[0].uri).toBe("meta-mcp://threads/profile");
    expect(contents[0].mimeType).toBe("application/json");
    expect(contents[0].text).toContain("testuser");
  });
});
