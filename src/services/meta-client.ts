import { MetaConfig } from "../config.js";
import { RateLimit } from "../types.js";

const IG_BASE = "https://graph.instagram.com/v25.0";
const FB_BASE = "https://graph.facebook.com/v25.0";
const THREADS_BASE = "https://graph.threads.net/v1.0";

// Unversioned bases for OAuth token endpoints
const IG_TOKEN_BASE = "https://graph.instagram.com";
const THREADS_TOKEN_BASE = "https://graph.threads.net";

interface ClientResponse {
  data: unknown;
  rateLimit?: RateLimit;
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

  private async request(
    baseUrl: string,
    token: string,
    method: string,
    path: string,
    params?: Record<string, unknown>
  ): Promise<ClientResponse> {
    let url = `${baseUrl}${path}`;
    const init: RequestInit = { method, signal: AbortSignal.timeout(30_000) };

    const qs = new URLSearchParams();
    qs.set("access_token", token);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== "") {
          qs.set(k, String(v));
        }
      }
    }

    if (method === "GET" || method === "DELETE") {
      url += `?${qs.toString()}`;
    } else {
      init.headers = { "Content-Type": "application/x-www-form-urlencoded" };
      init.body = qs.toString();
    }

    const res = await fetch(url, init);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Meta API ${method} ${path} (${res.status}): ${text}`);
    }

    const rateLimit = this.parseRateLimit(res.headers);
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = await res.json();
      if (data.error) {
        throw new Error(`Meta API error: ${data.error.message} (code ${data.error.code})`);
      }
      return { data, rateLimit };
    }
    const text = await res.text();
    return { data: text || { success: true }, rateLimit };
  }

  async ig(
    method: string,
    path: string,
    params?: Record<string, unknown>
  ): Promise<ClientResponse> {
    if (!this.config.instagramAccessToken) {
      throw new Error("INSTAGRAM_ACCESS_TOKEN is not configured.");
    }
    return this.request(IG_BASE, this.config.instagramAccessToken, method, path, params);
  }

  async threads(
    method: string,
    path: string,
    params?: Record<string, unknown>
  ): Promise<ClientResponse> {
    if (!this.config.threadsAccessToken) {
      throw new Error("THREADS_ACCESS_TOKEN is not configured.");
    }
    return this.request(THREADS_BASE, this.config.threadsAccessToken, method, path, params);
  }

  async meta(
    method: string,
    path: string,
    params?: Record<string, unknown>
  ): Promise<ClientResponse> {
    if (!this.config.appId || !this.config.appSecret) {
      throw new Error("META_APP_ID and META_APP_SECRET are required.");
    }
    const appToken = `${this.config.appId}|${this.config.appSecret}`;
    return this.request(FB_BASE, appToken, method, path, params);
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
