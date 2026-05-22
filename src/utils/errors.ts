import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { HttpMethod } from "../services/meta-client.js";

export type ErrorType = "auth" | "validation" | "rate_limit" | "server" | "network" | "internal";

interface MetaApiErrorInit {
  message: string;
  httpStatus?: number;
  apiCode?: number;
  apiSubcode?: number;
  apiType?: string;
  fbtraceId?: string;
  endpoint: string;
  method: HttpMethod;
  body?: string;
}

export class MetaApiError extends Error {
  readonly httpStatus?: number;
  readonly apiCode?: number;
  readonly apiSubcode?: number;
  readonly apiType?: string;
  readonly fbtraceId?: string;
  readonly endpoint: string;
  readonly method: HttpMethod;
  readonly body?: string;

  constructor(init: MetaApiErrorInit) {
    super(init.message);
    this.name = "MetaApiError";
    this.httpStatus = init.httpStatus;
    this.apiCode = init.apiCode;
    this.apiSubcode = init.apiSubcode;
    this.apiType = init.apiType;
    this.fbtraceId = init.fbtraceId;
    this.endpoint = init.endpoint;
    this.method = init.method;
    this.body = init.body;
  }
}

export type NetworkErrorKind = "timeout" | "network";

interface MetaNetworkErrorInit {
  kind: NetworkErrorKind;
  endpoint: string;
  method: HttpMethod;
  cause: unknown;
}

export class MetaNetworkError extends Error {
  readonly kind: NetworkErrorKind;
  readonly endpoint: string;
  readonly method: HttpMethod;

  constructor(init: MetaNetworkErrorInit) {
    const causeMessage =
      init.cause instanceof Error ? init.cause.message : String(init.cause);
    const message =
      init.kind === "timeout"
        ? `Meta API ${init.method} ${init.endpoint}: request timed out after 30s`
        : `Meta API ${init.method} ${init.endpoint}: network error — ${causeMessage}`;
    super(message, { cause: init.cause });
    this.name = "MetaNetworkError";
    this.kind = init.kind;
    this.endpoint = init.endpoint;
    this.method = init.method;
  }
}

const AUTH_CODES = new Set([10, 102, 190]);
const RATE_LIMIT_CODES = new Set([4, 17, 32, 341, 613]);
const VALIDATION_CODES = new Set([100, 200, 803]);
const SERVER_CODES = new Set([1, 2]);

function isBusinessUseCaseRateLimit(code?: number): boolean {
  return typeof code === "number" && code >= 80001 && code <= 80008;
}

function categorize(error: unknown): ErrorType {
  // Must run before the `instanceof Error` block — MetaNetworkError.name is
  // "MetaNetworkError", so the AbortError/TimeoutError checks below would
  // otherwise miss it and fall through to "internal".
  if (error instanceof MetaNetworkError) return "network";
  if (error instanceof MetaApiError) {
    const { httpStatus, apiCode, apiType } = error;
    // Check rate_limit before auth: Meta returns rate-limit errors as
    // type="OAuthException" with code 4/17 (Application/User request
    // limit reached). The apiType check below would otherwise route
    // those to "auth" with a token-refresh remediation hint.
    if (
      httpStatus === 429 ||
      (apiCode !== undefined && RATE_LIMIT_CODES.has(apiCode)) ||
      isBusinessUseCaseRateLimit(apiCode)
    ) {
      return "rate_limit";
    }
    if (
      httpStatus === 401 ||
      apiType === "OAuthException" ||
      (apiCode !== undefined && AUTH_CODES.has(apiCode))
    ) {
      return "auth";
    }
    if (apiCode !== undefined && VALIDATION_CODES.has(apiCode)) {
      return "validation";
    }
    if (apiCode !== undefined && SERVER_CODES.has(apiCode)) {
      return "server";
    }
    if (httpStatus !== undefined) {
      if (httpStatus >= 400 && httpStatus < 500) return "validation";
      if (httpStatus >= 500) return "server";
    }
    return "internal";
  }
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") return "network";
    if (error.name === "TypeError" && /fetch failed|network/i.test(error.message)) return "network";
    if (/fetch failed/i.test(error.message)) return "network";
  }
  return "internal";
}

const REMEDIATION: Partial<Record<ErrorType, string>> = {
  auth: "Refresh the access token via meta_exchange_token (short→long) or meta_refresh_token (long→long), or generate a new token from the Meta App dashboard. The token may be expired, revoked, or scoped incorrectly.",
  rate_limit: "Retry after a delay with exponential backoff. Inspect the _rateLimit field on prior successful responses to gauge headroom; consider reducing call volume or batching.",
  server: "Transient Meta server issue — retry with exponential backoff. If it persists, check status.dev.facebook.com.",
  network: "Network error or timeout reaching the Meta API. Retry with exponential backoff; verify outbound connectivity.",
};

const SENSITIVE_PARAMS = ["access_token", "client_secret", "input_token"];

export function sanitizeRaw(text: string): string {
  let result = text;
  for (const param of SENSITIVE_PARAMS) {
    const queryRegex = new RegExp(`${param}=[^&"\\s]+`, "gi");
    const jsonRegex = new RegExp(`"${param}"\\s*:\\s*"[^"]*"`, "gi");
    result = result.replace(queryRegex, `${param}=***`);
    result = result.replace(jsonRegex, `"${param}":"***"`);
  }
  return result;
}

interface ErrorPayload {
  error: true;
  error_type: ErrorType;
  http_status?: number;
  code?: number;
  subcode?: number;
  type?: string;
  message: string;
  remediation?: string;
  fbtrace_id?: string;
  raw?: string;
}

export interface McpErrorResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError: true;
}

function assignMetaApiFields(target: Record<string, unknown>, error: MetaApiError): void {
  if (error.httpStatus !== undefined) target.http_status = error.httpStatus;
  if (error.apiCode !== undefined) target.code = error.apiCode;
  if (error.apiSubcode !== undefined) target.subcode = error.apiSubcode;
  if (error.apiType) target.type = error.apiType;
  if (error.fbtraceId) target.fbtrace_id = error.fbtraceId;
}

export function formatErrorResponse(error: unknown, label: string): McpErrorResult {
  const errorType = categorize(error);
  const original = error instanceof Error ? error.message : String(error);
  const payload: ErrorPayload = {
    error: true,
    error_type: errorType,
    message: `${label} failed: ${original}`,
  };
  if (error instanceof MetaApiError) {
    assignMetaApiFields(payload as unknown as Record<string, unknown>, error);
  }
  const remediation = REMEDIATION[errorType];
  if (remediation) payload.remediation = remediation;
  payload.raw = sanitizeRaw(original);
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    isError: true,
  };
}

export function toMcpResourceError(error: unknown, label: string): McpError {
  const errorType = categorize(error);
  const original = error instanceof Error ? error.message : String(error);
  const message = sanitizeRaw(`${label} failed: ${original}`);
  const data: Record<string, unknown> = { error_type: errorType };
  if (error instanceof MetaApiError) {
    assignMetaApiFields(data, error);
  }
  const remediation = REMEDIATION[errorType];
  if (remediation) data.remediation = remediation;
  return new McpError(ErrorCode.InternalError, message, data);
}

export function validationError(message: string): McpErrorResult {
  const payload: ErrorPayload = {
    error: true,
    error_type: "validation",
    message,
  };
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    isError: true,
  };
}
