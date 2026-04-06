import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pollContainerStatus, waitForIgContainer, waitForThreadsContainer } from "./container.js";
import { MetaClient } from "../services/meta-client.js";

function makeApiCall(statusSequence: string[], statusField: "status" | "status_code") {
  let callIndex = 0;
  return vi.fn(async () => {
    const status = statusSequence[callIndex++];
    if (status === undefined) {
      throw new Error(`apiCall: statusSequence exhausted at call ${callIndex}`);
    }
    return { data: { [statusField]: status }, rateLimit: undefined };
  });
}

describe("pollContainerStatus", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const defaults = { statusField: "status" as const, label: "Container" };

  it("returns immediately when FINISHED on first poll", async () => {
    const apiCall = makeApiCall(["FINISHED"], "status");
    await pollContainerStatus("c-1", { ...defaults, apiCall });
    expect(apiCall).toHaveBeenCalledTimes(1);
  });

  it("throws on ERROR status", async () => {
    const apiCall = makeApiCall(["ERROR"], "status");
    await expect(pollContainerStatus("c-1", { ...defaults, apiCall })).rejects.toThrow(
      "Container processing failed (ERROR status)"
    );
  });

  it("throws on EXPIRED status", async () => {
    const apiCall = makeApiCall(["EXPIRED"], "status");
    await expect(pollContainerStatus("c-1", { ...defaults, apiCall })).rejects.toThrow(
      "Container expired — it was not published within 24 hours and must be recreated"
    );
  });

  it("throws on PUBLISHED status", async () => {
    const apiCall = makeApiCall(["PUBLISHED"], "status");
    await expect(pollContainerStatus("c-1", { ...defaults, apiCall })).rejects.toThrow(
      "Container already published"
    );
  });

  it("throws on unexpected status", async () => {
    const apiCall = makeApiCall(["SOMETHING_NEW"], "status");
    await expect(pollContainerStatus("c-1", { ...defaults, apiCall })).rejects.toThrow(
      "Unexpected container status: SOMETHING_NEW"
    );
  });

  it("includes last status in timeout message", async () => {
    const apiCall = makeApiCall(Array(20).fill("IN_PROGRESS"), "status");
    const promise = pollContainerStatus("c-1", { ...defaults, apiCall, maxWait: 4 });
    const rejection = expect(promise).rejects.toThrow(
      "Container processing timed out after 4s (last status: IN_PROGRESS)"
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
  });

  it("polls multiple times before FINISHED", async () => {
    const apiCall = makeApiCall(["IN_PROGRESS", "IN_PROGRESS", "FINISHED"], "status");
    const promise = pollContainerStatus("c-1", { ...defaults, apiCall });
    await vi.advanceTimersByTimeAsync(5_000);
    await promise;
    expect(apiCall).toHaveBeenCalledTimes(3);
  });

  it("passes correct fields param based on statusField", async () => {
    const apiCall = makeApiCall(["FINISHED"], "status_code");
    await pollContainerStatus("abc-123", { ...defaults, apiCall, statusField: "status_code" });
    expect(apiCall).toHaveBeenCalledWith("GET", "/abc-123", { fields: "status_code" });
  });

  it("throws when status field is missing from API response", async () => {
    const apiCall = vi.fn(async () => ({ data: {}, rateLimit: undefined }));
    await expect(pollContainerStatus("c-1", { ...defaults, apiCall })).rejects.toThrow(
      "Container status field missing from API response"
    );
  });

  it("uses custom label in error messages", async () => {
    const apiCall = makeApiCall(["ERROR"], "status");
    await expect(
      pollContainerStatus("c-1", { apiCall, statusField: "status", label: "Threads container" })
    ).rejects.toThrow("Threads container processing failed (ERROR status)");
  });

  it("uses custom interval", async () => {
    const apiCall = makeApiCall(["IN_PROGRESS", "FINISHED"], "status");
    const promise = pollContainerStatus("c-1", { ...defaults, apiCall, interval: 500 });
    await vi.advanceTimersByTimeAsync(1_000);
    await promise;
    expect(apiCall).toHaveBeenCalledTimes(2);
  });
});

describe("waitForIgContainer", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function makeMockClient(statusSequence: string[]): MetaClient {
    let callIndex = 0;
    return {
      ig: vi.fn(async () => {
        const status_code = statusSequence[callIndex++];
        if (status_code === undefined) {
          throw new Error(`makeMockClient: statusSequence exhausted at call ${callIndex}`);
        }
        return { data: { status_code }, rateLimit: undefined };
      }),
    } as unknown as MetaClient;
  }

  it("returns immediately when status_code is FINISHED", async () => {
    const client = makeMockClient(["FINISHED"]);
    await waitForIgContainer(client, "container-1", 30);
    expect(client.ig).toHaveBeenCalledTimes(1);
  });

  it("passes correct arguments to client.ig", async () => {
    const client = makeMockClient(["FINISHED"]);
    await waitForIgContainer(client, "abc-123", 30);
    expect(client.ig).toHaveBeenCalledWith("GET", "/abc-123", { fields: "status_code" });
  });

  it("throws on ERROR with correct label", async () => {
    const client = makeMockClient(["ERROR"]);
    await expect(waitForIgContainer(client, "c-1", 30)).rejects.toThrow(
      "Container processing failed (ERROR status)"
    );
  });

  it("includes last status in timeout message", async () => {
    const client = makeMockClient(Array(20).fill("IN_PROGRESS"));
    const promise = waitForIgContainer(client, "c-1", 4);
    const rejection = expect(promise).rejects.toThrow(
      "Container processing timed out after 4s (last status: IN_PROGRESS)"
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
  });
});

describe("waitForThreadsContainer", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

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

  it("returns immediately when status is FINISHED", async () => {
    const client = makeMockClient(["FINISHED"]);
    await waitForThreadsContainer(client, "container-1", 30);
    expect(client.threads).toHaveBeenCalledTimes(1);
  });

  it("passes correct arguments to client.threads", async () => {
    const client = makeMockClient(["FINISHED"]);
    await waitForThreadsContainer(client, "abc-123", 30);
    expect(client.threads).toHaveBeenCalledWith("GET", "/abc-123", { fields: "status" });
  });

  it("throws on ERROR with Threads label", async () => {
    const client = makeMockClient(["ERROR"]);
    await expect(waitForThreadsContainer(client, "c-1", 30)).rejects.toThrow(
      "Threads container processing failed (ERROR status)"
    );
  });

  it("includes last status in timeout message", async () => {
    const client = makeMockClient(Array(20).fill("IN_PROGRESS"));
    const promise = waitForThreadsContainer(client, "c-1", 4);
    const rejection = expect(promise).rejects.toThrow(
      "Threads container processing timed out after 4s (last status: IN_PROGRESS)"
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
  });
});
