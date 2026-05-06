import { describe, it, expect, vi } from "vitest";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { registerInstagramResources } from "./instagram.js";
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
    igUserId: "ig-123",
    ig: vi.fn(async () => ({
      data: {
        id: "ig-123",
        username: "testuser",
        biography: "Test bio",
      },
      rateLimit: undefined,
    })),
  } as unknown as MetaClient;
}

describe("instagram-profile resource", () => {
  it("registers under the namespaced meta-mcp:// URI scheme", () => {
    const server = makeMockServer();
    const client = makeMockClient();
    registerInstagramResources(server as never, client);

    expect(server.resources).toHaveLength(1);
    expect(server.resources[0].name).toBe("instagram-profile");
    expect(server.resources[0].uri).toBe("meta-mcp://instagram/profile");
  });

  it("registers description and application/json mimeType metadata", () => {
    const server = makeMockServer();
    const client = makeMockClient();
    registerInstagramResources(server as never, client);

    expect(server.resources[0].metadata.description).toContain("Instagram");
    expect(server.resources[0].metadata.mimeType).toBe("application/json");
  });

  it("handler calls GET /{igUserId} with profile fields", async () => {
    const server = makeMockServer();
    const client = makeMockClient();
    registerInstagramResources(server as never, client);

    await server.resources[0].handler();

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("GET");
    expect(call[1]).toBe("/ig-123");
    const fields = call[2].fields as string;
    expect(fields).toContain("id");
    expect(fields).toContain("username");
    expect(fields).toContain("biography");
    expect(fields).toContain("followers_count");
  });

  it("handler returns content with the namespaced meta-mcp:// URI", async () => {
    const server = makeMockServer();
    const client = makeMockClient();
    registerInstagramResources(server as never, client);

    const result = await server.resources[0].handler();
    const contents = (
      result as { contents: { uri: string; mimeType: string; text: string }[] }
    ).contents;

    expect(contents).toHaveLength(1);
    expect(contents[0].uri).toBe("meta-mcp://instagram/profile");
    expect(contents[0].mimeType).toBe("application/json");
    expect(contents[0].text).toContain("testuser");
  });

  it("handler throws McpError when client.ig rejects with a MetaApiError", async () => {
    const server = makeMockServer();
    const client = {
      igUserId: "ig-123",
      ig: vi.fn(async () => {
        throw new MetaApiError({
          message: "Meta API GET /ig-123 (401): Invalid OAuth token",
          httpStatus: 401,
          apiType: "OAuthException",
          apiCode: 190,
          endpoint: "/ig-123",
          method: "GET",
        });
      }),
    } as unknown as MetaClient;
    registerInstagramResources(server as never, client);

    const caught = await server.resources[0].handler().catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(McpError);
    expect(caught).toMatchObject({
      code: ErrorCode.InternalError,
      data: { error_type: "auth", http_status: 401, code: 190 },
    });
    expect((client.ig as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("handler sanitizes access_token leaks in the thrown McpError message", async () => {
    const server = makeMockServer();
    const client = {
      igUserId: "ig-123",
      ig: vi.fn(async () => {
        throw new Error(
          "fetch failed: https://graph.instagram.com/ig-123?access_token=EAAB_token_secret",
        );
      }),
    } as unknown as MetaClient;
    registerInstagramResources(server as never, client);

    try {
      await server.resources[0].handler();
      throw new Error("expected handler to throw");
    } catch (caught) {
      expect(caught).toBeInstanceOf(McpError);
      const mcpError = caught as McpError;
      expect(mcpError.message).toContain("access_token=***");
      expect(mcpError.message).not.toContain("EAAB_token_secret");
    }
  });
});
