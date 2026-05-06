import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig } from "./config.js";

const ENV_VARS = [
  "META_APP_ID",
  "META_APP_SECRET",
  "INSTAGRAM_ACCESS_TOKEN",
  "INSTAGRAM_USER_ID",
  "THREADS_ACCESS_TOKEN",
  "THREADS_USER_ID",
] as const;

describe("loadConfig", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    for (const name of ENV_VARS) vi.stubEnv(name, "");
    warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    warnSpy.mockRestore();
  });

  it("returns the parsed config when every var is set and numeric IDs are valid", () => {
    vi.stubEnv("META_APP_ID", "1234567890");
    vi.stubEnv("META_APP_SECRET", "app-secret");
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "ig-token");
    vi.stubEnv("INSTAGRAM_USER_ID", "17841405822304914");
    vi.stubEnv("THREADS_ACCESS_TOKEN", "threads-token");
    vi.stubEnv("THREADS_USER_ID", "9876543210");

    const config = loadConfig();

    expect(config).toEqual({
      appId: "1234567890",
      appSecret: "app-secret",
      instagramAccessToken: "ig-token",
      instagramUserId: "17841405822304914",
      threadsAccessToken: "threads-token",
      threadsUserId: "9876543210",
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("returns empty defaults and warns when no credentials are set", () => {
    const config = loadConfig();

    expect(config).toEqual({
      appId: "",
      appSecret: "",
      instagramAccessToken: "",
      instagramUserId: "",
      threadsAccessToken: "",
      threadsUserId: "",
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("no credentials configured");
  });

  it("treats unset env vars the same as empty strings", () => {
    vi.unstubAllEnvs();
    for (const name of ENV_VARS) delete process.env[name];

    const config = loadConfig();

    expect(config.appId).toBe("");
    expect(config.instagramUserId).toBe("");
  });

  it("warns when INSTAGRAM_ACCESS_TOKEN is set but INSTAGRAM_USER_ID is missing", () => {
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "ig-token");

    loadConfig();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "INSTAGRAM_ACCESS_TOKEN is set but INSTAGRAM_USER_ID is missing"
      )
    );
  });

  it("warns when INSTAGRAM_USER_ID is set but INSTAGRAM_ACCESS_TOKEN is missing", () => {
    vi.stubEnv("INSTAGRAM_USER_ID", "17841405822304914");

    loadConfig();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "INSTAGRAM_USER_ID is set but INSTAGRAM_ACCESS_TOKEN is missing"
      )
    );
  });

  it("warns when THREADS_ACCESS_TOKEN is set but THREADS_USER_ID is missing", () => {
    vi.stubEnv("THREADS_ACCESS_TOKEN", "threads-token");

    loadConfig();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "THREADS_ACCESS_TOKEN is set but THREADS_USER_ID is missing"
      )
    );
  });

  it("warns when THREADS_USER_ID is set but THREADS_ACCESS_TOKEN is missing", () => {
    vi.stubEnv("THREADS_USER_ID", "9876543210");

    loadConfig();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "THREADS_USER_ID is set but THREADS_ACCESS_TOKEN is missing"
      )
    );
  });

  it("warns when META_APP_ID is set but META_APP_SECRET is missing", () => {
    vi.stubEnv("META_APP_ID", "1234567890");

    loadConfig();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("META_APP_ID is set but META_APP_SECRET is missing")
    );
  });

  it("warns when META_APP_SECRET is set but META_APP_ID is missing", () => {
    vi.stubEnv("META_APP_SECRET", "app-secret");

    loadConfig();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("META_APP_SECRET is set but META_APP_ID is missing")
    );
  });

  it('accepts "me" as INSTAGRAM_USER_ID (Meta authenticated-user alias)', () => {
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "ig-token");
    vi.stubEnv("INSTAGRAM_USER_ID", "me");

    const config = loadConfig();

    expect(config.instagramUserId).toBe("me");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('accepts "me" as THREADS_USER_ID (Meta authenticated-user alias)', () => {
    vi.stubEnv("THREADS_ACCESS_TOKEN", "threads-token");
    vi.stubEnv("THREADS_USER_ID", "me");

    const config = loadConfig();

    expect(config.threadsUserId).toBe("me");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('rejects "me" with a suffix (must be exactly "me" or numeric)', () => {
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "ig-token");
    vi.stubEnv("INSTAGRAM_USER_ID", "me123");

    expect(() => loadConfig()).toThrow(
      /INSTAGRAM_USER_ID must be a numeric string or "me"/
    );
  });

  it('does not allow "me" for META_APP_ID (Meta App IDs are always numeric)', () => {
    vi.stubEnv("META_APP_ID", "me");
    vi.stubEnv("META_APP_SECRET", "app-secret");

    expect(() => loadConfig()).toThrow(/META_APP_ID must be a numeric string/);
  });

  it("emits only the pair warning, not the no-credentials warning, when only a user ID is set", () => {
    vi.stubEnv("INSTAGRAM_USER_ID", "12345");

    loadConfig();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain(
      "INSTAGRAM_USER_ID is set but INSTAGRAM_ACCESS_TOKEN is missing"
    );
    expect(warnSpy.mock.calls[0]?.[0]).not.toContain("no credentials configured");
  });

  it("does not emit pair warnings when both halves of a pair are set", () => {
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "ig-token");
    vi.stubEnv("INSTAGRAM_USER_ID", "17841405822304914");

    loadConfig();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("throws on non-numeric INSTAGRAM_USER_ID", () => {
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "ig-token");
    vi.stubEnv("INSTAGRAM_USER_ID", "not-a-number");

    expect(() => loadConfig()).toThrow(/INSTAGRAM_USER_ID must be a numeric string/);
  });

  it("throws on non-numeric THREADS_USER_ID", () => {
    vi.stubEnv("THREADS_ACCESS_TOKEN", "threads-token");
    vi.stubEnv("THREADS_USER_ID", "abc123");

    expect(() => loadConfig()).toThrow(/THREADS_USER_ID must be a numeric string/);
  });

  it("throws on non-numeric META_APP_ID", () => {
    vi.stubEnv("META_APP_ID", "my-app");
    vi.stubEnv("META_APP_SECRET", "app-secret");

    expect(() => loadConfig()).toThrow(/META_APP_ID must be a numeric string/);
  });

  it('accepts "0" as a valid numeric ID (falsy-string regression coverage for ?? vs ||)', () => {
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "ig-token");
    vi.stubEnv("INSTAGRAM_USER_ID", "0");

    const config = loadConfig();

    expect(config.instagramUserId).toBe("0");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("collects multiple format errors into a single thrown message", () => {
    vi.stubEnv("INSTAGRAM_USER_ID", "bad-ig");
    vi.stubEnv("THREADS_USER_ID", "bad-threads");

    expect(() => loadConfig()).toThrow(
      /INSTAGRAM_USER_ID must be a numeric string[\s\S]*THREADS_USER_ID must be a numeric string/
    );
  });

  it("prefixes the thrown error with the standard config-error header", () => {
    vi.stubEnv("INSTAGRAM_USER_ID", "bad-value");

    expect(() => loadConfig()).toThrow(/^Invalid meta-mcp configuration:/);
  });
});
