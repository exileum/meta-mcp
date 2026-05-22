import type { ContainerProgressCallback } from "./container.js";

// Decoupled from the SDK's RequestHandlerExtra generics — we type only the
// fields we actually read so publish handlers can hand us the raw `extra`.
export interface ProgressExtra {
  _meta?: {
    progressToken?: string | number;
  };
  sendNotification: (notification: {
    method: "notifications/progress";
    params: {
      progressToken: string | number;
      progress: number;
      total?: number;
      message?: string;
    };
  }) => Promise<void>;
}

/**
 * Build a `ContainerProgressCallback` that forwards each poll-loop emission as
 * an MCP `notifications/progress` event, or `undefined` when no progressToken
 * was attached (lets callers pass the result straight to `{ onProgress }`
 * without null-checking).
 *
 * `mode: "shared"` replaces the caller-supplied `progress`/`total` with an
 * internal monotonically-increasing counter (and omits `total`) — required
 * when multiple `pollContainerStatus` calls run in parallel via `Promise.all`,
 * since MCP requires strictly increasing values per progressToken.
 */
export function makeProgressNotifier(
  extra: ProgressExtra | undefined,
  mode: "single" | "shared" = "single"
): ContainerProgressCallback | undefined {
  const token = extra?._meta?.progressToken;
  if (extra === undefined || token === undefined) return undefined;

  let counter = 0;
  return (progress, total, message) => {
    const params = mode === "shared"
      ? { progressToken: token, progress: ++counter, message }
      : { progressToken: token, progress, total, message };
    // Transport may have closed (client disconnect, request cancelled) —
    // a rejection must not propagate or it would fail a successful upload.
    void extra.sendNotification({ method: "notifications/progress", params })
      .catch(() => { /* swallow */ });
  };
}
