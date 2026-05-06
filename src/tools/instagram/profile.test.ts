import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerIgProfileTools, igBusinessDiscoveryUsernameSchema } from "./profile.js";
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
    const handler = server.tools.get("ig_business_discovery");
    expect(handler).toBeDefined();
    await handler!({ username: "bluebottle" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("GET");
    expect(call[1]).toBe("/123");
    expect(call[2]).toEqual({
      fields: "business_discovery.username(bluebottle){id,username,name,biography,followers_count,follows_count,media_count}",
    });
  });

  it("passes caller-provided fields through inside the canonical {fields} braces", async () => {
    const handler = server.tools.get("ig_business_discovery");
    expect(handler).toBeDefined();
    await handler!({ username: "bluebottle", fields: "id,username,followers_count" });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("GET");
    expect(call[1]).toBe("/123");
    expect(call[2]).toEqual({
      fields: "business_discovery.username(bluebottle){id,username,followers_count}",
    });
  });

  it("forwards a parsed (normalized) username to the canonical expression unchanged", async () => {
    const handler = server.tools.get("ig_business_discovery");
    expect(handler).toBeDefined();
    const parsed = igBusinessDiscoveryUsernameSchema.parse("  @bluebottle  ");
    await handler!({ username: parsed });

    const call = (client.ig as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toEqual({
      fields: "business_discovery.username(bluebottle){id,username,name,biography,followers_count,follows_count,media_count}",
    });
  });

  it("returns an isError result when the underlying client rejects", async () => {
    (client.ig as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Meta API error: rate limited"));
    const handler = server.tools.get("ig_business_discovery");
    expect(handler).toBeDefined();
    const result = (await handler!({ username: "bluebottle" })) as {
      isError?: boolean;
      content: { type: string; text: string }[];
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("Business discovery failed");
    expect(result.content[0].text).toContain("rate limited");
  });
});

describe("igBusinessDiscoveryUsernameSchema validation", () => {
  it("passes a plain username through unchanged", () => {
    expect(igBusinessDiscoveryUsernameSchema.parse("bluebottle")).toBe("bluebottle");
  });

  it("strips a single leading '@'", () => {
    expect(igBusinessDiscoveryUsernameSchema.parse("@bluebottle")).toBe("bluebottle");
  });

  it("strips all consecutive leading '@' characters", () => {
    expect(igBusinessDiscoveryUsernameSchema.parse("@@bluebottle")).toBe("bluebottle");
    expect(igBusinessDiscoveryUsernameSchema.parse("@@@@bluebottle")).toBe("bluebottle");
  });

  it("rejects '@' that is not at the start (Instagram usernames cannot contain @)", () => {
    expect(() => igBusinessDiscoveryUsernameSchema.parse("user@name")).toThrow();
  });

  it("trims surrounding whitespace before stripping '@'", () => {
    expect(igBusinessDiscoveryUsernameSchema.parse("  bluebottle  ")).toBe("bluebottle");
    expect(igBusinessDiscoveryUsernameSchema.parse("  @bluebottle  ")).toBe("bluebottle");
  });

  it("rejects an empty string", () => {
    expect(() => igBusinessDiscoveryUsernameSchema.parse("")).toThrow();
  });

  it("rejects a whitespace-only string", () => {
    expect(() => igBusinessDiscoveryUsernameSchema.parse("   ")).toThrow();
  });

  it("rejects a single '@' (empty after strip)", () => {
    expect(() => igBusinessDiscoveryUsernameSchema.parse("@")).toThrow();
  });

  it("rejects multiple '@' only (empty after strip)", () => {
    expect(() => igBusinessDiscoveryUsernameSchema.parse("@@@@")).toThrow();
  });

  it("accepts a 1-character username (length boundary)", () => {
    expect(igBusinessDiscoveryUsernameSchema.parse("a")).toBe("a");
  });

  it("accepts a 30-character username (length boundary)", () => {
    const max = "a".repeat(30);
    expect(igBusinessDiscoveryUsernameSchema.parse(max)).toBe(max);
  });

  it("rejects a 31-character username (over length boundary)", () => {
    expect(() => igBusinessDiscoveryUsernameSchema.parse("a".repeat(31))).toThrow();
  });

  it("accepts usernames with periods and underscores", () => {
    expect(igBusinessDiscoveryUsernameSchema.parse("user.name_test")).toBe("user.name_test");
    expect(igBusinessDiscoveryUsernameSchema.parse("a.b.c")).toBe("a.b.c");
    expect(igBusinessDiscoveryUsernameSchema.parse("_underscore_")).toBe("_underscore_");
  });

  it("rejects hyphens (not allowed in Instagram usernames)", () => {
    expect(() => igBusinessDiscoveryUsernameSchema.parse("user-name")).toThrow();
  });

  it("rejects internal whitespace", () => {
    expect(() => igBusinessDiscoveryUsernameSchema.parse("blue bottle")).toThrow();
  });

  it.each([
    ["closing parenthesis", "bluebottle)"],
    ["opening parenthesis", "bluebottle("],
    ["closing brace", "bluebottle}"],
    ["opening brace", "bluebottle{"],
    ["comma", "blue,bottle"],
    ["equals sign", "blue=evil"],
    ["semicolon", "blue;evil"],
    ["query injection payload", "bluebottle){evil="],
    ["non-ASCII letter", "bluebött"],
    ["emoji", "blue🌸"],
  ])("rejects username containing %s", (_label, value) => {
    expect(() => igBusinessDiscoveryUsernameSchema.parse(value)).toThrow();
  });
});
