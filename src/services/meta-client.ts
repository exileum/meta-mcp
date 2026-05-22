import { MetaConfig } from "../config.js";
import { MetaApiError } from "../utils/errors.js";

// Default Meta Graph API and Threads API versions — last verified 2026-05-06.
// The Graph API ships a new minor version every ~4 months and supports each
// for ~2 years; Threads runs a separate single-major-version track (v1.0 since
// launch) and is intentionally not bumped in lockstep with the Graph API.
// Operators can override either default at runtime via `META_API_VERSION` /
// `THREADS_API_VERSION` to buy time when Meta deprecates a version before a
// new meta-mcp release ships. OAuth token endpoints
// (`graph.instagram.com/access_token`, `graph.threads.net/refresh_access_token`,
// etc.) are unversioned by Meta — `IG_TOKEN_BASE` / `THREADS_TOKEN_BASE` stay
// unversioned regardless of the version env vars.
export const DEFAULT_META_API_VERSION = "v25.0";
export const DEFAULT_THREADS_API_VERSION = "v1.0";

const API_VERSION_PATTERN = /^v\d+\.\d+$/;

// Unversioned bases for OAuth token endpoints (deliberate — Meta's OAuth
// surface has no version segment; piping META_API_VERSION here would 404).
const IG_TOKEN_BASE = "https://graph.instagram.com";
const THREADS_TOKEN_BASE = "https://graph.threads.net";

function resolveApiVersion(
  envName: string,
  fallback: string,
  explicit?: string
): string {
  // Explicit MetaClientOptions value, if any, takes precedence over the env
  // var; both go through the same regex check + warn-fallback so a malformed
  // option (e.g., `{ metaApiVersion: "v25-0" }`) can't silently build a
  // broken URL. Empty string on either path falls through to the default.
  const source = explicit !== undefined ? `MetaClientOptions.${envName}` : envName;
  const raw = explicit ?? process.env[envName];
  if (!raw) return fallback;
  if (!API_VERSION_PATTERN.test(raw)) {
    console.error(
      `[meta-mcp] Warning: ${source}="${raw}" is not in vX.Y format — falling back to ${fallback}.`
    );
    return fallback;
  }
  return raw;
}

export interface MetaClientOptions {
  metaApiVersion?: string;
  threadsApiVersion?: string;
}

export interface RateLimit {
  callCount?: number;
  totalCpuTime?: number;
  totalTime?: number;
}

// Pre-request throttle thresholds — Meta throttles at 100% usage on any of
// callCount / totalCpuTime / totalTime per
// https://developers.facebook.com/docs/graph-api/overview/rate-limiting/,
// so we back off well before the cliff.
export const RATE_LIMIT_SLOWDOWN_THRESHOLD = 80;
export const RATE_LIMIT_BACKOFF_THRESHOLD = 90;
export const RATE_LIMIT_SLOWDOWN_MS = 1000;
export const RATE_LIMIT_BACKOFF_MS = 5000;
// Meta's rate-limit window is rolling 1h — discard the snapshot after that so
// a long-idle client doesn't pay a spurious backoff on its first post-idle call.
export const RATE_LIMIT_SNAPSHOT_TTL_MS = 60 * 60 * 1000;

export interface ClientResponse {
  data: Record<string, unknown>;
  rateLimit?: RateLimit;
}

/**
 * Allowed value types for form-encoded query string and request body parameters.
 * Non-primitive values (arrays, objects) must be serialized by the caller (JSON.stringify, .join(",") etc.)
 * before being assigned — the form-encoded path uses String(v) which produces "[object Object]" / "1,2,3"
 * for objects/arrays and silently corrupts the request.
 */
export type FormParamValue = string | number | boolean | undefined | null;
export type FormParams = Record<string, FormParamValue>;

export interface RequestOptions {
  /**
   * Sends the value as an `application/json` request body instead of the default
   * `application/x-www-form-urlencoded`. The `access_token` is moved to the query
   * string (never embedded in the JSON body) and `params` must be omitted —
   * combining them is rejected at runtime so callers don't accidentally route
   * data into both transports.
   *
   * **When to use:** only when Meta's documentation explicitly requires
   * `Content-Type: application/json` for the endpoint. Currently the
   * Instagram Messaging Send API (`POST /{ig-user-id}/messages`, used by
   * `ig_send_message`) is the only such endpoint — it accepts nested
   * `recipient` / `message` objects that would be flattened to
   * `[object Object]` if sent through the form path. See
   * https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api
   *
   * **When not to use:** every other Graph API endpoint (Threads publish,
   * Instagram media/comments/collaboration, Meta App Subscriptions, etc.)
   * accepts form-urlencoded with flat string/number/boolean parameters and
   * works correctly through the default path. Nested objects required by the
   * API (`poll_attachment`, `gif_attachment`, `text_attachment`, `user_tags`)
   * must be `JSON.stringify`-ed by the caller into a single form field — the
   * runtime guard in `appendFormParams` rejects raw objects/arrays so this
   * convention is enforced (see #81). Audited in #104.
   */
  jsonBody?: Record<string, unknown>;
}

interface ParsedMetaError {
  message?: string;
  code?: number;
  subcode?: number;
  type?: string;
  fbtraceId?: string;
}

function parseMetaErrorBody(text: string): ParsedMetaError | undefined {
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as { error?: Record<string, unknown> };
    const err = parsed.error;
    if (!err) return undefined;
    return {
      message: typeof err.message === "string" ? err.message : undefined,
      code: typeof err.code === "number" ? err.code : undefined,
      subcode: typeof err.error_subcode === "number" ? err.error_subcode : undefined,
      type: typeof err.type === "string" ? err.type : undefined,
      fbtraceId: typeof err.fbtrace_id === "string" ? err.fbtrace_id : undefined,
    };
  } catch {
    return undefined;
  }
}

export class MetaClient {
  private config: MetaConfig;
  private igBase: string;
  private fbBase: string;
  private threadsBase: string;
  private lastRateLimit?: RateLimit;
  private lastRateLimitAt?: number;

  constructor(config: MetaConfig, options?: MetaClientOptions) {
    this.config = config;
    const metaVersion = resolveApiVersion(
      "META_API_VERSION",
      DEFAULT_META_API_VERSION,
      options?.metaApiVersion
    );
    const threadsVersion = resolveApiVersion(
      "THREADS_API_VERSION",
      DEFAULT_THREADS_API_VERSION,
      options?.threadsApiVersion
    );
    this.igBase = `https://graph.instagram.com/${metaVersion}`;
    this.fbBase = `https://graph.facebook.com/${metaVersion}`;
    this.threadsBase = `https://graph.threads.net/${threadsVersion}`;
  }

  private parseRateLimit(headers: Headers): RateLimit | undefined {
    const usage = headers.get("x-app-usage");
    if (!usage) return undefined;
    try {
      const raw = JSON.parse(usage);
      // `Number(undefined)` is NaN, `Number("92")` is 92 — coerce defensively
      // so a future Meta API tweak (numbers shipped as strings) still produces
      // a usable RateLimit instead of silently leaving fields `undefined`.
      const num = (v: unknown): number | undefined => {
        if (v === undefined || v === null) return undefined;
        const n = Number(v);
        return Number.isFinite(n) ? n : undefined;
      };
      return {
        callCount: num(raw.call_count),
        totalCpuTime: num(raw.total_cpu_time),
        totalTime: num(raw.total_time),
      };
    } catch {
      return undefined;
    }
  }

  // Take `max(callCount, totalCpuTime, totalTime)` because Meta throttles on
  // whichever quota hits 100% first. Concurrent calls at high usage both
  // sleep their full delay and then fire together — acceptable for MCP's
  // typically sequential call pattern, still safer than no throttling.
  private async maybeThrottle(): Promise<void> {
    const rl = this.lastRateLimit;
    if (!rl) return;
    if (this.lastRateLimitAt !== undefined && Date.now() - this.lastRateLimitAt > RATE_LIMIT_SNAPSHOT_TTL_MS) {
      this.lastRateLimit = undefined;
      this.lastRateLimitAt = undefined;
      return;
    }
    const max = Math.max(rl.callCount ?? 0, rl.totalCpuTime ?? 0, rl.totalTime ?? 0);
    let delay: number;
    if (max >= RATE_LIMIT_BACKOFF_THRESHOLD) {
      delay = RATE_LIMIT_BACKOFF_MS;
    } else if (max >= RATE_LIMIT_SLOWDOWN_THRESHOLD) {
      delay = RATE_LIMIT_SLOWDOWN_MS;
    } else {
      return;
    }
    console.error(
      `[meta-mcp] x-app-usage at ${max}% (callCount=${rl.callCount ?? "?"}, ` +
      `totalTime=${rl.totalTime ?? "?"}, totalCpuTime=${rl.totalCpuTime ?? "?"}); ` +
      `delaying next request by ${delay}ms to stay under Meta's per-app quota.`
    );
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }

  // Used for both form bodies (POST/PUT) and query strings (GET/DELETE) — every
  // entry ends up URL-encoded in `qs`. Skipping `""` must precede the typeof
  // check so the type narrowing below stays correct after the filter.
  private appendFormParams(qs: URLSearchParams, params: FormParams): void {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") {
        const kind = Array.isArray(v) ? "array" : typeof v;
        throw new Error(
          `MetaClient: form parameter "${k}" has unsupported type "${kind}". ` +
          `Form-encoded params must be string | number | boolean — serialize arrays/objects ` +
          `explicitly with JSON.stringify(...) or .join(",") before assigning.`
        );
      }
      qs.set(k, String(v));
    }
  }

  private async request(
    baseUrl: string,
    token: string,
    method: string,
    path: string,
    params?: FormParams,
    options?: RequestOptions
  ): Promise<ClientResponse> {
    let url = `${baseUrl}${path}`;
    const init: RequestInit = { method };

    const isWrite = method !== "GET" && method !== "DELETE";
    const useJson = isWrite && options?.jsonBody !== undefined;

    // `params` always lands in the URL query string (form body for POST/PUT,
    // query string for GET/DELETE/JSON-mode). Combining `params` with
    // `jsonBody` is rejected so that callers don't accidentally route data
    // intended for the body into the query string when the JSON-mode wrapper
    // overrides the body.
    if (useJson && params !== undefined) {
      throw new Error(
        "MetaClient: `params` cannot be combined with `options.jsonBody`. Pass either form-encoded `params` or a JSON `jsonBody`, not both."
      );
    }

    const qs = new URLSearchParams();
    qs.set("access_token", token);
    if (params) this.appendFormParams(qs, params);

    if (useJson) {
      url += (url.includes("?") ? "&" : "?") + qs.toString();
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(options!.jsonBody);
    } else if (isWrite) {
      init.headers = { "Content-Type": "application/x-www-form-urlencoded" };
      init.body = qs.toString();
    } else {
      url += (url.includes("?") ? "&" : "?") + qs.toString();
    }

    await this.maybeThrottle();
    // Arm the 30s abort timer *after* the throttle sleep so a backoff at high
    // x-app-usage doesn't eat into the actual network window (#60 review).
    init.signal = AbortSignal.timeout(30_000);
    const res = await fetch(url, init);

    // Parse rate-limit on every response (a 429 still carries `x-app-usage`);
    // header-less responses (OAuth token endpoints) leave state intact.
    const rateLimit = this.parseRateLimit(res.headers);
    if (rateLimit) {
      this.lastRateLimit = rateLimit;
      this.lastRateLimitAt = Date.now();
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const parsed = parseMetaErrorBody(text);
      const detail = parsed?.message ?? text;
      throw new MetaApiError({
        message: `Meta API ${method} ${path} (${res.status}): ${detail}`,
        httpStatus: res.status,
        apiCode: parsed?.code,
        apiSubcode: parsed?.subcode,
        apiType: parsed?.type,
        fbtraceId: parsed?.fbtraceId,
        endpoint: path,
        method,
        body: text,
      });
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = (await res.json()) as Record<string, unknown>;
      if (data.error) {
        const err = data.error as Record<string, unknown>;
        const apiCode = typeof err.code === "number" ? err.code : undefined;
        const apiSubcode = typeof err.error_subcode === "number" ? err.error_subcode : undefined;
        const apiType = typeof err.type === "string" ? err.type : undefined;
        const apiMessage = typeof err.message === "string" ? err.message : String(err.message ?? "");
        const fbtraceId = typeof err.fbtrace_id === "string" ? err.fbtrace_id : undefined;
        throw new MetaApiError({
          message: `Meta API error: ${apiMessage} (code ${apiCode ?? "?"})`,
          apiCode,
          apiSubcode,
          apiType,
          fbtraceId,
          endpoint: path,
          method,
          body: JSON.stringify(err),
        });
      }
      return { data, rateLimit };
    }
    const text = await res.text();
    return { data: { raw: text, success: true }, rateLimit };
  }

  async ig(
    method: string,
    path: string,
    params?: FormParams,
    options?: RequestOptions
  ): Promise<ClientResponse> {
    if (!this.config.instagramAccessToken) {
      throw new Error("INSTAGRAM_ACCESS_TOKEN is not configured.");
    }
    return this.request(this.igBase, this.config.instagramAccessToken, method, path, params, options);
  }

  async threads(
    method: string,
    path: string,
    params?: FormParams,
    options?: RequestOptions
  ): Promise<ClientResponse> {
    if (!this.config.threadsAccessToken) {
      throw new Error("THREADS_ACCESS_TOKEN is not configured.");
    }
    return this.request(this.threadsBase, this.config.threadsAccessToken, method, path, params, options);
  }

  async meta(
    method: string,
    path: string,
    params?: FormParams,
    options?: RequestOptions
  ): Promise<ClientResponse> {
    if (!this.config.appId || !this.config.appSecret) {
      throw new Error("META_APP_ID and META_APP_SECRET are required.");
    }
    const appToken = `${this.config.appId}|${this.config.appSecret}`;
    return this.request(this.fbBase, appToken, method, path, params, options);
  }

  /** Exchange short-lived Instagram token for long-lived token (60 days) */
  async igExchangeToken(shortToken: string): Promise<ClientResponse> {
    if (!this.config.appSecret) {
      throw new Error("META_APP_SECRET is required for token exchange.");
    }
    return this.request(IG_TOKEN_BASE, shortToken, "GET", "/access_token", {
      grant_type: "ig_exchange_token",
      client_secret: this.config.appSecret,
    });
  }

  /** Refresh a long-lived Instagram token (must be at least 24h old and not expired) */
  async igRefreshToken(longToken: string): Promise<ClientResponse> {
    return this.request(IG_TOKEN_BASE, longToken, "GET", "/refresh_access_token", {
      grant_type: "ig_refresh_token",
    });
  }

  /** Exchange short-lived Threads token for long-lived token (60 days) */
  async threadsExchangeToken(shortToken: string): Promise<ClientResponse> {
    if (!this.config.appSecret) {
      throw new Error("META_APP_SECRET is required for token exchange.");
    }
    return this.request(THREADS_TOKEN_BASE, shortToken, "GET", "/access_token", {
      grant_type: "th_exchange_token",
      client_secret: this.config.appSecret,
    });
  }

  /** Refresh a long-lived Threads token (must be at least 24h old and not expired) */
  async threadsRefreshToken(longToken: string): Promise<ClientResponse> {
    return this.request(THREADS_TOKEN_BASE, longToken, "GET", "/refresh_access_token", {
      grant_type: "th_refresh_token",
    });
  }

  /** Debug a token */
  async debugToken(inputToken: string): Promise<ClientResponse> {
    if (!this.config.appId || !this.config.appSecret) {
      throw new Error("META_APP_ID and META_APP_SECRET are required for token debug.");
    }
    const appToken = `${this.config.appId}|${this.config.appSecret}`;
    return this.request(this.fbBase, appToken, "GET", "/debug_token", {
      input_token: inputToken,
    });
  }

  get igUserId(): string {
    if (!this.config.instagramUserId) {
      throw new Error("INSTAGRAM_USER_ID is not configured.");
    }
    return this.config.instagramUserId;
  }

  get threadsUserId(): string {
    if (!this.config.threadsUserId) {
      throw new Error("THREADS_USER_ID is not configured.");
    }
    return this.config.threadsUserId;
  }
}
