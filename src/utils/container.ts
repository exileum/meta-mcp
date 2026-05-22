import { MetaClient, ClientResponse, FormParams, HttpMethod } from "../services/meta-client.js";

type ApiCallFn = (method: HttpMethod, path: string, params?: FormParams) => Promise<ClientResponse>;

// Image containers typically finish in a single poll. Video containers can need
// up to 5 minutes — Meta recommends "querying a container's status once per minute,
// for no more than 5 minutes" per the Instagram content publishing docs.
export const IMAGE_PROCESSING_TIMEOUT = 30;
export const VIDEO_PROCESSING_TIMEOUT = 300;

// Backoff caps polls at ~11 over a 300s video budget (down from ~60 fixed-5s)
// and jitter spreads concurrent carousel-child polls (#48) off the same tick.
export const POLL_BACKOFF_FACTOR = 1.5;
export const MAX_POLL_INTERVAL_MS = 30_000;
export const POLL_JITTER_MS = 500;

// Kept MCP-agnostic so container.ts has no @modelcontextprotocol imports.
// Throwing implementations are safe — the poll loop catches and discards
// callback errors, and never awaits the callback.
export type ContainerProgressCallback = (progress: number, total: number, message?: string) => void;

export interface PollContainerOptions {
  apiCall: ApiCallFn;
  statusField: "status" | "status_code";
  label: string;
  maxWait?: number;
  interval?: number;
  maxInterval?: number;
  backoffFactor?: number;
  jitterMs?: number;
  random?: () => number;
  onProgress?: ContainerProgressCallback;
}

export interface ContainerWaitOptions {
  onProgress?: ContainerProgressCallback;
}

/** Poll container status until FINISHED or terminal status */
export async function pollContainerStatus(containerId: string, options: PollContainerOptions): Promise<void> {
  const {
    apiCall,
    statusField,
    label,
    maxWait = IMAGE_PROCESSING_TIMEOUT,
    interval = 5000,
    maxInterval = MAX_POLL_INTERVAL_MS,
    backoffFactor = POLL_BACKOFF_FACTOR,
    jitterMs = POLL_JITTER_MS,
    random = Math.random,
    onProgress,
  } = options;
  // Upper-bound denominator for `onProgress` — the fixed-interval count. Real
  // attempts trend much lower under backoff, so a determinate progress bar
  // completes early; harmless and avoids changing the callback signature.
  const maxAttempts = Math.ceil((maxWait * 1000) / interval);
  const deadline = Date.now() + maxWait * 1000;
  let lastStatus: string | undefined;
  let attempt = 0;
  while (true) {
    const { data } = await apiCall("GET", `/${containerId}`, { fields: statusField });
    const status = data[statusField] as string | undefined;
    lastStatus = status;
    // 1-based so the very first emission is already strictly > 0, satisfying
    // the MCP requirement that progress increases monotonically per token.
    if (onProgress) {
      try {
        onProgress(attempt + 1, maxAttempts, status ? `${label} status: ${status}` : undefined);
      } catch {
        // Callback failures must not break polling.
      }
    }
    if (status === "FINISHED") return;
    if (status === "ERROR") throw new Error(`${label} processing failed (ERROR status)`);
    if (status === "EXPIRED") throw new Error(`${label} expired — it was not published within 24 hours and must be recreated`);
    if (status === "PUBLISHED") throw new Error(`${label} already published`);
    if (!status) throw new Error(`${label} status field missing from API response`);
    if (status !== "IN_PROGRESS") throw new Error(`Unexpected ${label.toLowerCase()} status: ${status}`);
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`${label} processing timed out after ${maxWait}s (last status: ${lastStatus ?? "unknown"})`);
    }
    const baseDelay = Math.min(interval * Math.pow(backoffFactor, attempt), maxInterval);
    const delay = baseDelay + random() * jitterMs;
    // Clamp the sleep to the remaining budget so the next poll fires AT the
    // deadline rather than aborting early when the next backoff would overrun.
    await new Promise((r) => setTimeout(r, Math.min(delay, remaining)));
    attempt++;
  }
}

/** Instagram container polling — uses client.ig() and status_code field */
export async function waitForIgContainer(client: MetaClient, containerId: string, maxWait = IMAGE_PROCESSING_TIMEOUT, options: ContainerWaitOptions = {}): Promise<void> {
  return pollContainerStatus(containerId, {
    apiCall: client.ig.bind(client),
    statusField: "status_code",
    label: "Container",
    maxWait,
    onProgress: options.onProgress,
  });
}

/** Threads container polling — uses client.threads() and status field */
export async function waitForThreadsContainer(client: MetaClient, containerId: string, maxWait = IMAGE_PROCESSING_TIMEOUT, options: ContainerWaitOptions = {}): Promise<void> {
  return pollContainerStatus(containerId, {
    apiCall: client.threads.bind(client),
    statusField: "status",
    label: "Threads container",
    maxWait,
    onProgress: options.onProgress,
  });
}
