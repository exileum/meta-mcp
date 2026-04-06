import { describe, it, expect } from "vitest";
import { httpsUrl } from "./schemas.js";

describe("httpsUrl schema", () => {
  it("accepts valid HTTPS URLs", () => {
    expect(httpsUrl.safeParse("https://example.com/image.jpg").success).toBe(true);
    expect(httpsUrl.safeParse("https://cdn.example.com/path/to/video.mp4").success).toBe(true);
    expect(httpsUrl.safeParse("https://example.com").success).toBe(true);
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
