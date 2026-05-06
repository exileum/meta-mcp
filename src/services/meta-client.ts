import { MetaConfig } from "../config.js";
import { MetaApiError } from "../utils/errors.js";

const IG_BASE = "https://graph.instagram.com/v25.0";
const FB_BASE = "https://graph.facebook.com/v25.0";
const THREADS_BASE = "https://graph.threads.net/v1.0";

// Unversioned bases for OAuth token endpoints
const IG_TOKEN_BASE = "https://graph.instagram.com";
const THREADS_TOKEN_BASE = "https://graph.threads.net";

export interface RateLimit {
  callCount?: number;
  totalCpuTime?: number;
  totalTime?: number;
}

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

  constructor(config: MetaConfig) {
    this.config = config;
  }

  private parseRateLimit(headers: Headers): RateLimit | undefined {
    const usage = headers.get("x-app-usage");
    if (!usage) return undefined;
    try {
      const raw = JSON.parse(usage);
      return {
        callCount: raw.call_count,
        totalCpuTime: raw.total_cpu_time,
        totalTime: raw.total_time,
      };
    } catch {
      return undefined;
    }
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
    const init: RequestInit = { method, signal: AbortSignal.timeout(30_000) };

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

    const res = await fetch(url, init);

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

    const rateLimit = this.parseRateLimit(res.headers);
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
    return this.request(IG_BASE, this.config.instagramAccessToken, method, path, params, options);
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
    return this.request(THREADS_BASE, this.config.threadsAccessToken, method, path, params, options);
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
    return this.request(FB_BASE, appToken, method, path, params, options);
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
    return this.request(FB_BASE, appToken, "GET", "/debug_token", {
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
