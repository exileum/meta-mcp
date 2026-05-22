import type { RateLimit } from "../services/meta-client.js";

export interface McpToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export function formatResponse(
  data: Record<string, unknown>,
  rateLimit?: RateLimit
): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ ...data, _rateLimit: rateLimit }, null, 2) }],
  };
}
