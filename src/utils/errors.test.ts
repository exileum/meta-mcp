import { describe, it, expect } from "vitest";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { MetaApiError, MetaNetworkError, formatErrorResponse, toMcpResourceError, validationError, sanitizeRaw } from "./errors.js";

interface ErrorPayload {
  error: true;
  error_type: string;
  http_status?: number;
  code?: number;
  subcode?: number;
  type?: string;
  step?: string;
  container_id?: string;
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

  it("categorizes OAuthException with rate-limit code 4 as rate_limit, not auth", () => {
    // Meta returns "Application request limit reached" as type=OAuthException
    // with code 4 — must classify as rate_limit, not auth (no token-refresh hint)
    const error = new MetaApiError({
      message: "Meta API POST /media (400): Application request limit reached",
      httpStatus: 400,
      apiType: "OAuthException",
      apiCode: 4,
      endpoint: "/media",
      method: "POST",
    });
    const payload = parsePayload(formatErrorResponse(error, "X"));
    expect(payload.error_type).toBe("rate_limit");
    expect(payload.remediation).toContain("backoff");
    expect(payload.remediation).not.toContain("meta_exchange_token");
  });

  it("categorizes OAuthException with user rate-limit code 17 as rate_limit", () => {
    const error = new MetaApiError({
      message: "Meta API GET /me (400): User request limit reached",
      httpStatus: 400,
      apiType: "OAuthException",
      apiCode: 17,
      endpoint: "/me",
      method: "GET",
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

describe("MetaNetworkError", () => {
  it("builds the timeout message with endpoint, method, and configured timeout", () => {
    const cause = new Error("The operation was aborted");
    cause.name = "TimeoutError";
    const err = new MetaNetworkError({
      kind: "timeout",
      endpoint: "/me",
      method: "GET",
      cause,
      timeoutMs: 30000,
    });
    expect(err.message).toBe("Meta API GET /me: request timed out after 30s");
    expect(err.name).toBe("MetaNetworkError");
    expect(err.kind).toBe("timeout");
    expect(err.endpoint).toBe("/me");
    expect(err.method).toBe("GET");
    expect(err.timeoutMs).toBe(30000);
  });

  it("derives the timeout seconds from the configured timeoutMs (not a hardcoded 30s)", () => {
    const err = new MetaNetworkError({
      kind: "timeout",
      endpoint: "/me",
      method: "GET",
      cause: new Error("aborted"),
      timeoutMs: 60_000,
    });
    expect(err.message).toBe("Meta API GET /me: request timed out after 60s");
    expect(err.timeoutMs).toBe(60_000);
  });

  it("builds the network message with cause.message included", () => {
    const cause = new TypeError("fetch failed");
    const err = new MetaNetworkError({
      kind: "network",
      endpoint: "/123/media",
      method: "POST",
      cause,
      timeoutMs: 30000,
    });
    expect(err.message).toBe("Meta API POST /123/media: network error — fetch failed");
    expect(err.kind).toBe("network");
  });

  it("preserves the original error on .cause", () => {
    const cause = new TypeError("fetch failed");
    const err = new MetaNetworkError({
      kind: "network",
      endpoint: "/x",
      method: "GET",
      cause,
      timeoutMs: 30000,
    });
    expect(err.cause).toBe(cause);
  });

  it("stringifies a non-Error cause when building the message", () => {
    const err = new MetaNetworkError({
      kind: "network",
      endpoint: "/x",
      method: "GET",
      cause: "raw string failure",
      timeoutMs: 30000,
    });
    expect(err.message).toBe("Meta API GET /x: network error — raw string failure");
    expect(err.cause).toBe("raw string failure");
  });

  it("is both an Error and a MetaNetworkError", () => {
    const err = new MetaNetworkError({
      kind: "timeout",
      endpoint: "/x",
      method: "GET",
      cause: new Error("boom"),
      timeoutMs: 30000,
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(MetaNetworkError);
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

  it("categorizes MetaNetworkError (timeout) as network and surfaces normalized message", () => {
    const cause = new Error("The operation was aborted");
    cause.name = "TimeoutError";
    const error = new MetaNetworkError({
      kind: "timeout",
      endpoint: "/123/media",
      method: "POST",
      cause,
      timeoutMs: 30000,
    });
    const payload = parsePayload(formatErrorResponse(error, "Publish photo"));
    expect(payload.error_type).toBe("network");
    expect(payload.message).toBe(
      "Publish photo failed: Meta API POST /123/media: request timed out after 30s"
    );
    expect(payload.remediation).toContain("Retry");
  });

  it("categorizes MetaNetworkError (network) as network with cause message included", () => {
    const cause = new TypeError("fetch failed");
    const error = new MetaNetworkError({
      kind: "network",
      endpoint: "/me",
      method: "GET",
      cause,
      timeoutMs: 30000,
    });
    const payload = parsePayload(formatErrorResponse(error, "Get profile"));
    expect(payload.error_type).toBe("network");
    expect(payload.message).toBe(
      "Get profile failed: Meta API GET /me: network error — fetch failed"
    );
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

describe("formatErrorResponse — context (step / containerId)", () => {
  it("omits step and container_id when no context is passed (back-compat)", () => {
    const payload = parsePayload(formatErrorResponse(new Error("boom"), "Publish photo"));
    expect(payload.message).toBe("Publish photo failed: boom");
    expect(payload.step).toBeUndefined();
    expect(payload.container_id).toBeUndefined();
  });

  it("adds 'at <step>' suffix to message and exposes payload.step", () => {
    const payload = parsePayload(
      formatErrorResponse(new Error("boom"), "Publish photo", { step: "processing" })
    );
    expect(payload.message).toBe("Publish photo failed at processing: boom");
    expect(payload.step).toBe("processing");
    expect(payload.container_id).toBeUndefined();
  });

  it("adds '(container: <id>)' suffix to message and exposes payload.container_id", () => {
    const payload = parsePayload(
      formatErrorResponse(new Error("boom"), "Publish photo", { containerId: "17889615324" })
    );
    expect(payload.message).toBe("Publish photo failed (container: 17889615324): boom");
    expect(payload.step).toBeUndefined();
    expect(payload.container_id).toBe("17889615324");
  });

  it("combines step + containerId in message and exposes both payload fields", () => {
    const payload = parsePayload(
      formatErrorResponse(
        new Error("Container processing timed out after 30s"),
        "Publish photo",
        { step: "processing", containerId: "17889615324" }
      )
    );
    expect(payload.message).toBe(
      "Publish photo failed at processing (container: 17889615324): Container processing timed out after 30s"
    );
    expect(payload.step).toBe("processing");
    expect(payload.container_id).toBe("17889615324");
  });

  it("preserves MetaApiError categorization when context is supplied", () => {
    const error = new MetaApiError({
      message: "Meta API POST /media_publish (400): bad request",
      httpStatus: 400,
      apiCode: 100,
      endpoint: "/123/media_publish",
      method: "POST",
    });
    const payload = parsePayload(
      formatErrorResponse(error, "Publish photo", { step: "publishing", containerId: "abc" })
    );
    expect(payload.error_type).toBe("validation");
    expect(payload.http_status).toBe(400);
    expect(payload.code).toBe(100);
    expect(payload.step).toBe("publishing");
    expect(payload.container_id).toBe("abc");
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

describe("toMcpResourceError", () => {
  it("returns an McpError with InternalError code for any input", () => {
    const error = new Error("boom");
    const result = toMcpResourceError(error, "Get Instagram profile");
    expect(result).toBeInstanceOf(McpError);
    expect(result.code).toBe(ErrorCode.InternalError);
  });

  it("prefixes the message with the label and sanitizes access_token", () => {
    const error = new Error("Failed: https://example.com/?access_token=EAAB_secret_xyz");
    const result = toMcpResourceError(error, "Get Instagram profile");
    expect(result.message).toContain("Get Instagram profile failed:");
    expect(result.message).toContain("access_token=***");
    expect(result.message).not.toContain("EAAB_secret_xyz");
  });

  it("categorizes MetaApiError 401 as auth and includes remediation in data", () => {
    const error = new MetaApiError({
      message: "Meta API GET /me (401): OAuthException",
      httpStatus: 401,
      apiType: "OAuthException",
      apiCode: 190,
      apiSubcode: 463,
      fbtraceId: "Abc123FbTrace",
      endpoint: "/me",
      method: "GET",
    });
    const result = toMcpResourceError(error, "Get Threads profile");
    const data = result.data as Record<string, unknown>;
    expect(data.error_type).toBe("auth");
    expect(data.http_status).toBe(401);
    expect(data.code).toBe(190);
    expect(data.subcode).toBe(463);
    expect(data.type).toBe("OAuthException");
    expect(data.fbtrace_id).toBe("Abc123FbTrace");
    expect(data.remediation).toContain("meta_exchange_token");
  });

  it("categorizes 429 MetaApiError as rate_limit with backoff hint", () => {
    const error = new MetaApiError({
      message: "Meta API GET /me (429): rate limit",
      httpStatus: 429,
      apiCode: 17,
      endpoint: "/me",
      method: "GET",
    });
    const data = toMcpResourceError(error, "X").data as Record<string, unknown>;
    expect(data.error_type).toBe("rate_limit");
    expect(data.remediation).toContain("backoff");
  });

  it("categorizes MetaNetworkError as network with the normalized message preserved", () => {
    const cause = new TypeError("fetch failed");
    const error = new MetaNetworkError({
      kind: "network",
      endpoint: "/me",
      method: "GET",
      cause,
      timeoutMs: 30000,
    });
    const result = toMcpResourceError(error, "Get Instagram profile");
    const data = result.data as Record<string, unknown>;
    expect(data.error_type).toBe("network");
    expect(data.remediation).toContain("Retry");
    expect(result.message).toContain(
      "Get Instagram profile failed: Meta API GET /me: network error — fetch failed"
    );
  });

  it("categorizes plain Error as internal and omits MetaApiError-only fields", () => {
    const data = toMcpResourceError(new Error("oops"), "X").data as Record<string, unknown>;
    expect(data.error_type).toBe("internal");
    expect(data.http_status).toBeUndefined();
    expect(data.code).toBeUndefined();
    expect(data.fbtrace_id).toBeUndefined();
    expect(data.remediation).toBeUndefined();
  });

  it("handles non-Error thrown values", () => {
    const result = toMcpResourceError("string thrown", "X");
    expect(result.message).toContain("X failed: string thrown");
    expect((result.data as Record<string, unknown>).error_type).toBe("internal");
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

  it("scrubs client_secret query param (token exchange URLs)", () => {
    expect(sanitizeRaw("https://graph.instagram.com/access_token?client_secret=app_secret_xyz&grant_type=ig_exchange_token"))
      .toContain("client_secret=***");
    expect(sanitizeRaw("client_secret=secret123")).toBe("client_secret=***");
  });

  it("scrubs input_token query param (debug_token URLs)", () => {
    expect(sanitizeRaw("/debug_token?input_token=tok_to_inspect&access_token=app_token"))
      .toBe("/debug_token?input_token=***&access_token=***");
  });

  it("scrubs JSON client_secret and input_token fields", () => {
    expect(sanitizeRaw('{"client_secret":"abc","input_token":"def"}'))
      .toBe('{"client_secret":"***","input_token":"***"}');
  });

  it("scrubs all sensitive params in a single string", () => {
    const input = "access_token=A&client_secret=B&input_token=C&fields=id";
    expect(sanitizeRaw(input)).toBe("access_token=***&client_secret=***&input_token=***&fields=id");
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
