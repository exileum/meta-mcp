import { describe, it, expect, vi } from "vitest";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { registerThreadsResources } from "./threads.js";
import { MetaClient } from "../services/meta-client.js";
import { MetaApiError } from "../utils/errors.js";

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

  it("handler throws McpError when client.threads rejects with a MetaApiError", async () => {
    const server = makeMockServer();
    const client = {
      threadsUserId: "threads-123",
      threads: vi.fn(async () => {
        throw new MetaApiError({
          message: "Meta API GET /threads-123 (429): rate limit",
          httpStatus: 429,
          apiCode: 17,
          endpoint: "/threads-123",
          method: "GET",
        });
      }),
    } as unknown as MetaClient;
    registerThreadsResources(server as never, client);

    const caught = await server.resources[0].handler().catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(McpError);
    expect(caught).toMatchObject({
      code: ErrorCode.InternalError,
      data: { error_type: "rate_limit", http_status: 429, code: 17 },
    });
    expect((client.threads as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("handler labels the error as 'Get Threads profile' and sanitizes tokens", async () => {
    const server = makeMockServer();
    const client = {
      threadsUserId: "threads-123",
      threads: vi.fn(async () => {
        throw new Error(
          "fetch failed: https://graph.threads.net/threads-123?access_token=THX_secret_xyz",
        );
      }),
    } as unknown as MetaClient;
    registerThreadsResources(server as never, client);

    try {
      await server.resources[0].handler();
      throw new Error("expected handler to throw");
    } catch (caught) {
      expect(caught).toBeInstanceOf(McpError);
      const mcpError = caught as McpError;
      expect(mcpError.message).toContain("Get Threads profile failed:");
      expect(mcpError.message).toContain("access_token=***");
      expect(mcpError.message).not.toContain("THX_secret_xyz");
    }
  });
});
