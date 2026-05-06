import { describe, it, expect } from "vitest";
import { httpsUrl, metaId } from "./schemas.js";

describe("httpsUrl schema", () => {
  it("accepts valid HTTPS URLs", () => {
    expect(httpsUrl.safeParse("https://example.com/image.jpg").success).toBe(true);
    expect(httpsUrl.safeParse("https://cdn.example.com/path/to/video.mp4").success).toBe(true);
    expect(httpsUrl.safeParse("https://example.com").success).toBe(true);
  });

  it("accepts HTTPS URLs with mixed-case scheme (RFC 3986)", () => {
    expect(httpsUrl.safeParse("HTTPS://example.com").success).toBe(true);
    expect(httpsUrl.safeParse("Https://example.com/image.jpg").success).toBe(true);
  });

  it("rejects HTTP URLs", () => {
    const result = httpsUrl.safeParse("http://example.com/image.jpg");
    expect(result.success).toBe(false);
  });

  it("rejects FTP URLs", () => {
    const result = httpsUrl.safeParse("ftp://example.com/file.txt");
    expect(result.success).toBe(false);
  });

  it("rejects file:// URLs", () => {
    const result = httpsUrl.safeParse("file:///etc/passwd");
    expect(result.success).toBe(false);
  });

  it("rejects data: URLs", () => {
    const result = httpsUrl.safeParse("data:text/plain;base64,SGVsbG8=");
    expect(result.success).toBe(false);
  });

  it("rejects non-URL strings", () => {
    const result = httpsUrl.safeParse("not-a-url");
    expect(result.success).toBe(false);
  });

  it("rejects empty strings", () => {
    const result = httpsUrl.safeParse("");
    expect(result.success).toBe(false);
  });

  it("works with .optional()", () => {
    const optionalHttpsUrl = httpsUrl.optional();
    expect(optionalHttpsUrl.safeParse(undefined).success).toBe(true);
    expect(optionalHttpsUrl.safeParse("https://example.com").success).toBe(true);
    expect(optionalHttpsUrl.safeParse("http://example.com").success).toBe(false);
  });
});

describe("metaId schema", () => {
  it("accepts purely numeric IDs (typical Meta media/post IDs)", () => {
    expect(metaId.safeParse("17889615324123").success).toBe(true);
    expect(metaId.safeParse("0").success).toBe(true);
    expect(metaId.safeParse("123").success).toBe(true);
  });

  it("accepts compound numeric IDs joined by underscore (carousel container IDs)", () => {
    expect(metaId.safeParse("17841405822304914_17889615324123").success).toBe(true);
  });

  it("accepts alphanumeric and hyphenated IDs (future-proof)", () => {
    expect(metaId.safeParse("aBcXyZ123").success).toBe(true);
    expect(metaId.safeParse("foo_bar-baz").success).toBe(true);
    expect(metaId.safeParse("ABC-123_DEF").success).toBe(true);
  });

  it("rejects empty strings", () => {
    expect(metaId.safeParse("").success).toBe(false);
  });

  it("rejects path traversal sequences", () => {
    expect(metaId.safeParse("..").success).toBe(false);
    expect(metaId.safeParse("../v24.0/me").success).toBe(false);
    expect(metaId.safeParse("..%2Fv24.0%2Fme").success).toBe(false);
  });

  it("rejects query-string injection", () => {
    expect(metaId.safeParse("123?fields=access_token").success).toBe(false);
    expect(metaId.safeParse("123&access_token=foo").success).toBe(false);
    expect(metaId.safeParse("123=value").success).toBe(false);
  });

  it("rejects path-segment injection", () => {
    expect(metaId.safeParse("123/comments").success).toBe(false);
    expect(metaId.safeParse("/123").success).toBe(false);
    expect(metaId.safeParse("123/").success).toBe(false);
  });

  it("rejects dot characters (would enable .. traversal patterns)", () => {
    expect(metaId.safeParse("foo.bar").success).toBe(false);
    expect(metaId.safeParse(".").success).toBe(false);
    expect(metaId.safeParse("123.456").success).toBe(false);
  });

  it("rejects whitespace and control characters", () => {
    expect(metaId.safeParse(" 123").success).toBe(false);
    expect(metaId.safeParse("123 ").success).toBe(false);
    expect(metaId.safeParse("123 456").success).toBe(false);
    expect(metaId.safeParse("123\n").success).toBe(false);
    expect(metaId.safeParse("123\t").success).toBe(false);
  });

  it("rejects non-ASCII characters", () => {
    expect(metaId.safeParse("123ñ").success).toBe(false);
    expect(metaId.safeParse("文字").success).toBe(false);
  });

  it("works with .optional()", () => {
    const optionalMetaId = metaId.optional();
    expect(optionalMetaId.safeParse(undefined).success).toBe(true);
    expect(optionalMetaId.safeParse("17889615324123").success).toBe(true);
    expect(optionalMetaId.safeParse("../v24.0/me").success).toBe(false);
  });

  it("error message is descriptive", () => {
    const result = metaId.safeParse("../v24.0/me");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/letters, numbers, underscores, and hyphens/);
    }
  });
});
