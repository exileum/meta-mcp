import { describe, it, expect } from "vitest";
import { MetaApiError, formatErrorResponse, validationError, sanitizeRaw } from "./errors.js";

interface ErrorPayload {
  error: true;
  error_type: string;
  http_status?: number;
  code?: number;
  subcode?: number;
  type?: string;
  message: string;
  remediation?: string;
  fbtrace_id?: string;
  raw?: string;
}

function parsePayload(result: { content: { type: string; text: string }[] }): ErrorPayload {
  return JSON.parse(result.content[0].text) as ErrorPayload;
}

describe("formatErrorResponse — Meta API errors", () => {
  it("categorizes 401 HTTP status as auth", () => {
    const error = new MetaApiError({
      message: "Meta API GET /me (401): OAuthException",
      httpStatus: 401,
      apiType: "OAuthException",
      apiCode: 190,
      apiSubcode: 463,
      endpoint: "/me",
      method: "GET",
    });
    const result = formatErrorResponse(error, "Get profile");
    const payload = parsePayload(result);

    expect(result.isError).toBe(true);
    expect(payload.error_type).toBe("auth");
    expect(payload.http_status).toBe(401);
    expect(payload.code).toBe(190);
    expect(payload.subcode).toBe(463);
    expect(payload.type).toBe("OAuthException");
    expect(payload.message).toBe("Get profile failed: Meta API GET /me (401): OAuthException");
    expect(payload.remediation).toContain("meta_exchange_token");
  });

  it("categorizes by OAuthException type even without 401", () => {
    const error = new MetaApiError({
      message: "Meta API error: Invalid token (code ?)",
      apiType: "OAuthException",
      endpoint: "/me",
      method: "GET",
    });
    expect(parsePayload(formatErrorResponse(error, "X")).error_type).toBe("auth");
  });

  it("categorizes 429 as rate_limit", () => {
    const error = new MetaApiError({
      message: "Meta API POST /media (429): rate limit",
      httpStatus: 429,
      apiCode: 17,
      endpoint: "/media",
      method: "POST",
    });
    const payload = parsePayload(formatErrorResponse(error, "Publish"));
    expect(payload.error_type).toBe("rate_limit");
    expect(payload.code).toBe(17);
    expect(payload.remediation).toContain("backoff");
  });

  it("categorizes business-use-case rate limit codes (80001-80008)", () => {
    const error = new MetaApiError({
      message: "Meta API error",
      apiCode: 80004,
      endpoint: "/media",
      method: "POST",
    });
    expect(parsePayload(formatErrorResponse(error, "X")).error_type).toBe("rate_limit");
  });

  it("categorizes 400 with code 100 as validation", () => {
    const error = new MetaApiError({
      message: "Meta API POST /media (400): Invalid parameter",
      httpStatus: 400,
      apiCode: 100,
      endpoint: "/media",
      method: "POST",
    });
    const payload = parsePayload(formatErrorResponse(error, "Publish"));
    expect(payload.error_type).toBe("validation");
    expect(payload.remediation).toBeUndefined();
  });

  it("categorizes 5xx as server", () => {
    const error = new MetaApiError({
      message: "Meta API GET /me (500): server error",
      httpStatus: 500,
      apiCode: 1,
      endpoint: "/me",
      method: "GET",
    });
    const payload = parsePayload(formatErrorResponse(error, "Get profile"));
    expect(payload.error_type).toBe("server");
    expect(payload.remediation).toContain("retry");
  });

  it("includes fbtrace_id when present", () => {
    const error = new MetaApiError({
      message: "Meta API error",
      apiCode: 100,
      fbtraceId: "Abc123FbTrace",
      endpoint: "/me",
      method: "GET",
    });
    expect(parsePayload(formatErrorResponse(error, "X")).fbtrace_id).toBe("Abc123FbTrace");
  });

  it("omits optional fields when not provided", () => {
    const error = new MetaApiError({
      message: "Meta API error",
      endpoint: "/me",
      method: "GET",
    });
    const payload = parsePayload(formatErrorResponse(error, "X"));
    expect(payload.http_status).toBeUndefined();
    expect(payload.code).toBeUndefined();
    expect(payload.subcode).toBeUndefined();
    expect(payload.type).toBeUndefined();
    expect(payload.fbtrace_id).toBeUndefined();
  });

  it("categorizes unmatched 4xx (403 Forbidden) as validation, not server", () => {
    const error = new MetaApiError({
      message: "Meta API GET /me (403): permission denied",
      httpStatus: 403,
      endpoint: "/me",
      method: "GET",
    });
    const payload = parsePayload(formatErrorResponse(error, "X"));
    expect(payload.error_type).toBe("validation");
    expect(payload.remediation).toBeUndefined();
  });

  it("categorizes 404 Not Found as validation", () => {
    const error = new MetaApiError({
      message: "Meta API GET /missing (404): not found",
      httpStatus: 404,
      endpoint: "/missing",
      method: "GET",
    });
    expect(parsePayload(formatErrorResponse(error, "X")).error_type).toBe("validation");
  });

  it("categorizes unmatched 5xx (502 Bad Gateway) as server", () => {
    const error = new MetaApiError({
      message: "Meta API POST /media (502): bad gateway",
      httpStatus: 502,
      endpoint: "/media",
      method: "POST",
    });
    expect(parsePayload(formatErrorResponse(error, "X")).error_type).toBe("server");
  });

  it("categorizes MetaApiError without httpStatus or recognized code as internal", () => {
    const error = new MetaApiError({
      message: "Meta API error: weird error (code 99999)",
      apiCode: 99999,
      endpoint: "/me",
      method: "GET",
    });
    const payload = parsePayload(formatErrorResponse(error, "X"));
    expect(payload.error_type).toBe("internal");
    expect(payload.remediation).toBeUndefined();
  });
});

describe("formatErrorResponse — non-MetaApiError", () => {
  it("categorizes AbortError as network", () => {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    expect(parsePayload(formatErrorResponse(error, "X")).error_type).toBe("network");
  });

  it("categorizes TimeoutError as network", () => {
    const error = new Error("timeout");
    error.name = "TimeoutError";
    expect(parsePayload(formatErrorResponse(error, "X")).error_type).toBe("network");
  });

  it("categorizes 'fetch failed' message as network", () => {
    const error = new Error("fetch failed");
    expect(parsePayload(formatErrorResponse(error, "X")).error_type).toBe("network");
  });

  it("categorizes plain Error as internal", () => {
    const error = new Error("Container creation did not return a valid id");
    const payload = parsePayload(formatErrorResponse(error, "Publish"));
    expect(payload.error_type).toBe("internal");
    expect(payload.remediation).toBeUndefined();
    expect(payload.message).toContain("Container creation did not return a valid id");
  });

  it("handles non-Error thrown values", () => {
    const payload = parsePayload(formatErrorResponse("string thrown", "X"));
    expect(payload.error_type).toBe("internal");
    expect(payload.message).toBe("X failed: string thrown");
  });
});

describe("formatErrorResponse — raw field & sanitization", () => {
  it("includes raw with original message", () => {
    const error = new Error("Meta API GET /me (401): bad token");
    expect(parsePayload(formatErrorResponse(error, "X")).raw).toBe("Meta API GET /me (401): bad token");
  });

  it("scrubs access_token query parameter from raw", () => {
    const error = new Error("Failed: https://example.com/?access_token=EAABwzLixnjYBO_secret&other=1");
    expect(parsePayload(formatErrorResponse(error, "X")).raw).toContain("access_token=***");
    expect(parsePayload(formatErrorResponse(error, "X")).raw).not.toContain("EAABwzLixnjYBO_secret");
  });

  it("scrubs JSON-style access_token from raw", () => {
    const error = new Error('error: {"access_token": "secret123"}');
    const raw = parsePayload(formatErrorResponse(error, "X")).raw;
    expect(raw).toContain('"access_token":"***"');
    expect(raw).not.toContain("secret123");
  });
});

describe("validationError", () => {
  it("returns validation payload without remediation", () => {
    const result = validationError("text_attachment cannot be combined with poll_options");
    const payload = parsePayload(result);
    expect(result.isError).toBe(true);
    expect(payload.error_type).toBe("validation");
    expect(payload.message).toBe("text_attachment cannot be combined with poll_options");
    expect(payload.remediation).toBeUndefined();
    expect(payload.raw).toBeUndefined();
  });
});

describe("sanitizeRaw", () => {
  it("scrubs single access_token query param", () => {
    expect(sanitizeRaw("access_token=ABC123&fields=id")).toBe("access_token=***&fields=id");
  });

  it("scrubs multiple access_token occurrences", () => {
    const input = "first access_token=AAA other text access_token=BBB end";
    expect(sanitizeRaw(input)).toBe("first access_token=*** other text access_token=*** end");
  });

  it("preserves text without tokens", () => {
    expect(sanitizeRaw("nothing to scrub here")).toBe("nothing to scrub here");
  });

  it("scrubs JSON access_token field", () => {
    expect(sanitizeRaw('{"access_token": "EAABwz"}')).toBe('{"access_token":"***"}');
  });
});

describe("MetaApiError", () => {
  it("preserves all init fields", () => {
    const error = new MetaApiError({
      message: "test",
      httpStatus: 400,
      apiCode: 100,
      apiSubcode: 33,
      apiType: "GraphMethodException",
      fbtraceId: "trace1",
      endpoint: "/me",
      method: "GET",
      body: '{"error":{}}',
    });
    expect(error.message).toBe("test");
    expect(error.httpStatus).toBe(400);
    expect(error.apiCode).toBe(100);
    expect(error.apiSubcode).toBe(33);
    expect(error.apiType).toBe("GraphMethodException");
    expect(error.fbtraceId).toBe("trace1");
    expect(error.endpoint).toBe("/me");
    expect(error.method).toBe("GET");
    expect(error.body).toBe('{"error":{}}');
    expect(error.name).toBe("MetaApiError");
    expect(error instanceof Error).toBe(true);
  });
});
