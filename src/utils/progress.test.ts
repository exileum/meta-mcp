import { describe, it, expect, vi } from "vitest";
import { makeProgressNotifier, ProgressExtra } from "./progress.js";

function makeExtra(progressToken: string | number | undefined): ProgressExtra & {
  sendNotification: ReturnType<typeof vi.fn>;
} {
  return {
    _meta: progressToken === undefined ? {} : { progressToken },
    sendNotification: vi.fn(async () => undefined),
  };
}

describe("makeProgressNotifier", () => {
  it("returns undefined when extra is missing", () => {
    expect(makeProgressNotifier(undefined)).toBeUndefined();
  });

  it("returns undefined when no progressToken is attached", () => {
    expect(makeProgressNotifier(makeExtra(undefined))).toBeUndefined();
  });

  it("single mode forwards the caller-supplied progress and total", async () => {
    const extra = makeExtra("token-1");
    const notify = makeProgressNotifier(extra)!;
    notify(2, 6, "Container status: IN_PROGRESS");
    await Promise.resolve();
    expect(extra.sendNotification).toHaveBeenCalledTimes(1);
    expect(extra.sendNotification).toHaveBeenCalledWith({
      method: "notifications/progress",
      params: {
        progressToken: "token-1",
        progress: 2,
        total: 6,
        message: "Container status: IN_PROGRESS",
      },
    });
  });

  it("shared mode uses a monotonic counter even under parallel emissions", async () => {
    const extra = makeExtra(42);
    const notify = makeProgressNotifier(extra, "shared")!;
    // Simulate Promise.all-style interleaving: three child polls each emit
    // two updates with the same caller-supplied (progress, total) numbers.
    notify(1, 3); notify(1, 3); notify(1, 3);
    notify(2, 3); notify(2, 3); notify(2, 3);
    await Promise.resolve();
    expect(extra.sendNotification).toHaveBeenCalledTimes(6);
    const progressValues = extra.sendNotification.mock.calls.map(
      (call) => (call[0] as { params: { progress: number } }).params.progress
    );
    expect(progressValues).toEqual([1, 2, 3, 4, 5, 6]);
    const params = (extra.sendNotification.mock.calls[0][0] as { params: Record<string, unknown> }).params;
    expect(params.progressToken).toBe(42);
    // `total` is intentionally omitted in shared mode — it cannot be known
    // ahead of time across parallel child polls.
    expect(params.total).toBeUndefined();
  });

  it("swallows sendNotification rejections so the publish handler is unaffected", async () => {
    const extra: ProgressExtra & { sendNotification: ReturnType<typeof vi.fn> } = {
      _meta: { progressToken: "tok" },
      sendNotification: vi.fn(async () => { throw new Error("transport closed"); }),
    };
    const notify = makeProgressNotifier(extra)!;
    expect(() => notify(1, 5)).not.toThrow();
    // Wait one microtask so the rejection is processed.
    await Promise.resolve();
    await Promise.resolve();
    expect(extra.sendNotification).toHaveBeenCalledTimes(1);
  });

  it("stop() makes subsequent emissions no-ops without throwing", async () => {
    const extra = makeExtra("tok-stop");
    const notify = makeProgressNotifier(extra, "shared")!;
    notify(1, 3);
    notify.stop();
    notify(2, 3);
    notify(3, 3);
    await Promise.resolve();
    // Only the pre-stop emission is forwarded.
    expect(extra.sendNotification).toHaveBeenCalledTimes(1);
  });

  it("stop() is idempotent", () => {
    const extra = makeExtra("tok-idem");
    const notify = makeProgressNotifier(extra, "single")!;
    expect(() => { notify.stop(); notify.stop(); }).not.toThrow();
    notify(99, 100);
    expect(extra.sendNotification).not.toHaveBeenCalled();
  });
});
