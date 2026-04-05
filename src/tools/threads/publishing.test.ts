import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { waitForThreadsContainer } from "./publishing.js";
import { MetaClient } from "../../services/meta-client.js";

// Mirror the gif_provider schema used in threads_publish_text
const gifProviderSchema = z.enum(["GIPHY"]).optional();

function makeMockClient(statusSequence: string[]): MetaClient {
  let callIndex = 0;
  return {
    threads: vi.fn(async () => {
      const status = statusSequence[callIndex++];
      if (status === undefined) {
        throw new Error(`makeMockClient: statusSequence exhausted at call ${callIndex}`);
      }
      return { data: { status }, rateLimit: undefined };
    }),
  } as unknown as MetaClient;
}

describe("gif_provider schema", () => {
  it("accepts GIPHY", () => {
    expect(gifProviderSchema.parse("GIPHY")).toBe("GIPHY");
  });

  it("rejects TENOR (sunset March 31, 2026)", () => {
    expect(() => gifProviderSchema.parse("TENOR")).toThrow();
  });

  it("accepts undefined (optional)", () => {
    expect(gifProviderSchema.parse(undefined)).toBeUndefined();
  });
});

describe("waitForThreadsContainer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns immediately when status is FINISHED on first poll", async () => {
    const client = makeMockClient(["FINISHED"]);
    await waitForThreadsContainer(client, "container-1", 30);
    expect(client.threads).toHaveBeenCalledTimes(1);
  });

  it("throws on ERROR status", async () => {
    const client = makeMockClient(["ERROR"]);
    await expect(waitForThreadsContainer(client, "container-1", 30)).rejects.toThrow(
      "Threads container processing failed (ERROR status)"
    );
  });

  it("throws on EXPIRED status", async () => {
    const client = makeMockClient(["EXPIRED"]);
    await expect(waitForThreadsContainer(client, "container-1", 30)).rejects.toThrow(
      "Threads container expired — it was not published within 24 hours and must be recreated"
    );
  });

  it("throws on PUBLISHED status", async () => {
    const client = makeMockClient(["PUBLISHED"]);
    await expect(waitForThreadsContainer(client, "container-1", 30)).rejects.toThrow(
      "Threads container already published"
    );
  });

  it("throws on unexpected status", async () => {
    const client = makeMockClient(["SOMETHING_NEW"]);
    await expect(waitForThreadsContainer(client, "container-1", 30)).rejects.toThrow(
      "Unexpected Threads container status: SOMETHING_NEW"
    );
  });

  it("includes last status in timeout message", async () => {
    const client = makeMockClient(Array(20).fill("IN_PROGRESS"));
    const promise = waitForThreadsContainer(client, "container-1", 4);
    // Attach rejection handler before advancing timers to avoid unhandled rejection
    const rejection = expect(promise).rejects.toThrow(
      "Threads container processing timed out after 4s (last status: IN_PROGRESS)"
    );
    // maxWait=4s, interval=2s → 2 attempts, each with a 2s sleep
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
  });

  it("polls multiple times before FINISHED", async () => {
    const client = makeMockClient(["IN_PROGRESS", "IN_PROGRESS", "FINISHED"]);
    const promise = waitForThreadsContainer(client, "container-1", 30);
    // Advance past the two IN_PROGRESS sleeps
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    expect(client.threads).toHaveBeenCalledTimes(3);
  });

  it("passes correct arguments to client.threads", async () => {
    const client = makeMockClient(["FINISHED"]);
    await waitForThreadsContainer(client, "abc-123", 30);
    expect(client.threads).toHaveBeenCalledWith("GET", "/abc-123", { fields: "status" });
  });

  it("throws when status field is missing from API response", async () => {
    const client = {
      threads: vi.fn(async () => ({ data: {}, rateLimit: undefined })),
    } as unknown as MetaClient;
    await expect(waitForThreadsContainer(client, "container-1", 30)).rejects.toThrow(
      "Threads container status field missing from API response"
    );
  });
});
