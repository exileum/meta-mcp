import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

// Every tool in this project calls the Meta Graph API (Instagram + Threads),
// so openWorldHint is always true. The four presets below cover every Meta
// endpoint shape we expose; see https://modelcontextprotocol.io for the
// canonical hint semantics.

export const READ_ONLY_TOOL: ToolAnnotations = {
  readOnlyHint: true,
  openWorldHint: true,
};

export const DESTRUCTIVE_TOOL: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

export const WRITE_TOOL: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

export const WRITE_IDEMPOTENT_TOOL: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
