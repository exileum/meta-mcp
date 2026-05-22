import { describe, it, expect } from "vitest";
import { formatResponse } from "./response.js";

interface ParsedPayload {
  [key: string]: unknown;
  _rateLimit?: { callCount?: number; totalCpuTime?: number; totalTime?: number };
}

function parsePayload(result: { content: { type: string; text: string }[] }): ParsedPayload {
  return JSON.parse(result.content[0].text) as ParsedPayload;
}

describe("formatResponse", () => {
  it("matches the legacy inline JSON.stringify shape byte-for-byte", () => {
    const data = { id: "17841405822304914", name: "test" };
    const rateLimit = { callCount: 5, totalCpuTime: 1, totalTime: 2 };
    const legacy = {
      content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }],
    };

    const result = formatResponse(data, rateLimit);

    expect(result).toEqual(legacy);
    expect(result.content[0].text).toBe(legacy.content[0].text);
  });

  it("omits _rateLimit when rateLimit is undefined", () => {
    const data = { id: "abc", text: "hello" };

    const result = formatResponse(data);
    const payload = parsePayload(result);

    expect(payload).toEqual({ id: "abc", text: "hello" });
    expect(Object.prototype.hasOwnProperty.call(payload, "_rateLimit")).toBe(false);
  });

  it("preserves prefixed synthetic fields before spreading data", () => {
    const data = { id: "reply-1", text: "ok" };
    const rateLimit = { callCount: 1 };

    const result = formatResponse({ success: true, hidden: true, ...data }, rateLimit);
    const payload = parsePayload(result);

    expect(payload.success).toBe(true);
    expect(payload.hidden).toBe(true);
    expect(payload.id).toBe("reply-1");
    expect(payload.text).toBe("ok");
    expect(payload._rateLimit).toEqual({ callCount: 1 });

    const keys = Object.keys(payload);
    expect(keys).toEqual(["success", "hidden", "id", "text", "_rateLimit"]);
  });

  it("lets data fields override earlier prefix fields", () => {
    const data = { success: false, id: "x" };

    const result = formatResponse({ success: true, ...data });
    const payload = parsePayload(result);

    expect(payload.success).toBe(false);
    expect(payload.id).toBe("x");
  });

  it("handles empty data with only _rateLimit", () => {
    const result = formatResponse({}, { callCount: 99 });
    const payload = parsePayload(result);

    expect(payload).toEqual({ _rateLimit: { callCount: 99 } });
  });

  it("handles empty data without rateLimit", () => {
    const result = formatResponse({});
    const payload = parsePayload(result);

    expect(payload).toEqual({});
  });

  it("pretty-prints with 2-space indent", () => {
    const result = formatResponse({ a: 1 }, { callCount: 0 });
    expect(result.content[0].text).toBe("{\n  \"a\": 1,\n  \"_rateLimit\": {\n    \"callCount\": 0\n  }\n}");
  });

  it("does not set isError on the result", () => {
    const result = formatResponse({ id: "x" });
    expect(result.isError).toBeUndefined();
  });
});
