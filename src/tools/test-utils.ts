import { z } from "zod";
import { vi } from "vitest";

export type ZodShape = Record<string, z.ZodTypeAny>;
export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export interface MockServer {
  tools: Map<string, { schema: ZodShape; handler: ToolHandler }>;
  descriptions: Map<string, string>;
  tool: ReturnType<typeof vi.fn>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

// Mirrors what the MCP SDK does at request time: parse the incoming args
// through the registered Zod schema (which applies `.default()` values),
// then invoke the tool handler with the parsed result.
export function makeMockServer(): MockServer {
  const tools = new Map<string, { schema: ZodShape; handler: ToolHandler }>();
  const descriptions = new Map<string, string>();
  const tool = vi.fn((name: string, desc: string, schema: ZodShape, handler: ToolHandler) => {
    tools.set(name, { schema, handler });
    descriptions.set(name, desc);
  });
  return {
    tools,
    descriptions,
    tool,
    async callTool(name: string, args: Record<string, unknown>) {
      const t = tools.get(name);
      if (!t) throw new Error(`Tool ${name} not registered`);
      const parsed = z.object(t.schema).parse(args) as Record<string, unknown>;
      return t.handler(parsed);
    },
  };
}
