// Tool registry — the §4.3 slice of the multi-provider AI agent design
// (docs/design/multi-provider-ai-agent.md): a vault-side tool is a zod-schema'd,
// named, async function, defined ONCE and adapted to whichever provider runs it
// (toSdkTools in the http engine today; the deferred MCP server would export the
// same set later). Same registry idiom as registry.ts: a module-scope Map behind
// plain functions, replace-on-re-register, dependency-light and pure — this file
// imports nothing but zod (the iron rule: src/ai never imports core/kits/server).
//
// Injection contract: the CONCRETE tools live server-side (src/server/agentTools)
// and receive their vault capabilities by closure at registration time. The `ctx`
// parameter stays an OPAQUE generic here — reserved for per-call context (current
// focus/source, an approval token, …); the A4a loop driver passes `undefined`.

import type { z } from "zod";

export type ToolDefinition<I = unknown, O = unknown, C = unknown> = {
  /** Wire name the model calls, e.g. "search_notes". Unique per registry. */
  name: string;
  /** What the tool does + when to use it — the model reads this verbatim. */
  description: string;
  /** zod schema for the tool input; the loop driver validates before execute. */
  inputSchema: z.ZodType;
  // Method (not property) syntax on purpose: methods are bivariant, so a typed
  // ToolDefinition<{query: string}, Rows, Ctx> stays assignable to the erased
  // ToolDefinition the registry stores.
  execute(input: I, ctx: C): Promise<O>;
};

// Keyed by EXACT name — tool names come from the model echoing our definitions,
// never from arbitrary-case env values (unlike provider ids).
const tools = new Map<string, ToolDefinition>();

/**
 * Register (or re-register) a tool. Idempotent: registering the same name again
 * REPLACES the previous entry (re-install / test re-import must not duplicate —
 * same motivation as registerProvider).
 */
export function registerTool(definition: ToolDefinition): void {
  tools.set(definition.name, definition);
}

/** All registered tools, in registration order (what the agent route passes to runAgent). */
export function listTools(): ToolDefinition[] {
  return [...tools.values()];
}

/** Look one tool up by exact name. */
export function getTool(name: string): ToolDefinition | undefined {
  return tools.get(name);
}

/** Test-only reset — the registry is module-global, so suites clear between cases. */
export function clearToolsForTests(): void {
  tools.clear();
}
