import { z } from "zod";
import { vi } from "vitest";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

export type ZodShape = Record<string, z.ZodTypeAny>;
export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export interface RegisterToolConfig {
  description?: string;
  inputSchema?: ZodShape;
  annotations?: ToolAnnotations;
}

export interface MockServer {
  tools: Map<string, { schema: ZodShape; handler: ToolHandler }>;
  descriptions: Map<string, string>;
  annotations: Map<string, ToolAnnotations | undefined>;
  registerTool: ReturnType<typeof vi.fn>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

// Mirrors what the MCP SDK does at request time: parse the incoming args
// through the registered Zod schema (which applies `.default()` values),
// then invoke the tool handler with the parsed result.
export function makeMockServer(): MockServer {
  const tools = new Map<string, { schema: ZodShape; handler: ToolHandler }>();
  const descriptions = new Map<string, string>();
  const annotations = new Map<string, ToolAnnotations | undefined>();
  const registerTool = vi.fn((name: string, config: RegisterToolConfig, handler: ToolHandler) => {
    tools.set(name, { schema: config.inputSchema ?? {}, handler });
    descriptions.set(name, config.description ?? "");
    annotations.set(name, config.annotations);
  });
  return {
    tools,
    descriptions,
    annotations,
    registerTool,
    async callTool(name: string, args: Record<string, unknown>) {
      const t = tools.get(name);
      if (!t) throw new Error(`Tool ${name} not registered`);
      const parsed = z.object(t.schema).parse(args) as Record<string, unknown>;
      return t.handler(parsed);
    },
  };
}
