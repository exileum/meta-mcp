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
 * `ContainerProgressCallback` with an attached `.stop()` for lifecycle control.
 * Calling `.stop()` makes subsequent invocations no-ops — required for the
 * `Promise.all`-parallel carousel case, where a rejected child can leave its
 * sibling polls running and emitting `notifications/progress` after the tool
 * call has already returned (MCP forbids progress after request completion).
 */
export type ProgressNotifier = ContainerProgressCallback & { stop: () => void };

/**
 * Build a `ProgressNotifier` that forwards each poll-loop emission as an MCP
 * `notifications/progress` event, or `undefined` when no progressToken was
 * attached (lets callers pass the result straight to `{ onProgress }` without
 * null-checking).
 *
 * `mode: "shared"` replaces the caller-supplied `progress`/`total` with an
 * internal monotonically-increasing counter (and omits `total`) — required
 * when multiple `pollContainerStatus` calls run in parallel via `Promise.all`,
 * since MCP requires strictly increasing values per progressToken.
 *
 * Callers should invoke `.stop()` in a `finally` block once the tool call has
 * completed (success or failure). For sequential single-poll tools this is a
 * defensive no-op; for parallel carousel flows it prevents leaked emissions.
 */
export function makeProgressNotifier(
  extra: ProgressExtra | undefined,
  mode: "single" | "shared" = "single"
): ProgressNotifier | undefined {
  const token = extra?._meta?.progressToken;
  if (extra === undefined || token === undefined) return undefined;

  let counter = 0;
  let alive = true;
  const emit: ContainerProgressCallback = (progress, total, message) => {
    if (!alive) return;
    const params = mode === "shared"
      ? { progressToken: token, progress: ++counter, message }
      : { progressToken: token, progress, total, message };
    // Transport may have closed (client disconnect, request cancelled) —
    // a rejection must not propagate or it would fail a successful upload.
    void extra.sendNotification({ method: "notifications/progress", params })
      .catch(() => { /* swallow */ });
  };
  return Object.assign(emit, { stop: () => { alive = false; } });
}
