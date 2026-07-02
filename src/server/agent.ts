// server-only — the A4a agent-loop route (docs/design/multi-provider-ai-agent.md
// §4.1(2)/§4.3): POST /api/agent/stream, SSE, modeled on /api/chat/stream but
// emitting the RICHER AgentStepEvent set (text-delta / tool-call / tool-result /
// step / done, + error) so the client can render a transcript with tool cards
// (A4b). Capability-gated: providers without `runAgent` (mock, cli-agent,
// managed today) answer 501 agent_unsupported and the UI falls back to plain
// chat. Module pattern mirrors registerMemoryRoutes (the F2 extraction shape).

import type { Express } from "express";
import { z } from "zod";
import { chatRequestSchema, type AgentStepEvent, type ModelProvider } from "../ai";
import type { StudyVault } from "../core/vault";
import { registerAgentTools } from "./agentTools";

/** Serialized args/result cap per SSE frame — a runaway tool payload must not flood the wire. */
export const AGENT_EVENT_PAYLOAD_CHAR_CAP = 4000;
/** Request-side ceiling on the step budget (the provider defaults when unset). */
export const AGENT_MAX_STEPS_LIMIT = 32;

// Body = a chat request plus an optional step budget. Validated BEFORE any byte
// is written (mirroring /api/chat/stream), so bad input is still a plain 400.
const agentStreamRequestSchema = chatRequestSchema.extend({
  maxSteps: z.number().int().min(1).max(AGENT_MAX_STEPS_LIMIT).optional()
});

// `getProvider` resolves PER REQUEST (A3b: the active provider is stored config,
// not a boot-time constant) — the same seam the chat routes consume in app.ts.
export type AgentDeps = { vault: StudyVault; getProvider: () => Promise<ModelProvider> };

/**
 * JSON-serialize an arbitrary tool payload safely: non-serializable values
 * (circular, BigInt) degrade to their String() form, and anything over the cap
 * is sliced with a truncation flag. Truncated JSON no longer parses, so the
 * wire field is ALWAYS a string (argsJson/resultJson) rather than a value.
 */
export function serializePayload(value: unknown): { json: string; truncated: boolean } {
  let json: string;
  try {
    json = JSON.stringify(value) ?? "null"; // undefined has no JSON form
  } catch {
    json = JSON.stringify(String(value));
  }
  if (json.length <= AGENT_EVENT_PAYLOAD_CHAR_CAP) return { json, truncated: false };
  return { json: json.slice(0, AGENT_EVENT_PAYLOAD_CHAR_CAP), truncated: true };
}

export function registerAgentRoutes(app: Express, deps: AgentDeps): void {
  // Register the read-only vault tools once per app and keep THIS app's
  // instances in the closure: the src/ai registry is module-global (last
  // registration wins), so with several apps alive (tests spin publisher +
  // recipient pairs) passing listTools() could cross-wire another app's vault.
  const tools = registerAgentTools({ vault: deps.vault });

  app.post("/api/agent/stream", async (req, res, next) => {
    let input: z.infer<typeof agentStreamRequestSchema>;
    try {
      input = agentStreamRequestSchema.parse(req.body);
    } catch (error) {
      next(error); // ZodError → 400 via the shared handler, headers untouched
      return;
    }
    let provider: ModelProvider;
    try {
      provider = await deps.getProvider();
    } catch (error) {
      next(error); // resolution is designed not to throw; belt for the seam
      return;
    }
    // Capability gate (§4.3): feature-detect runAgent exactly like /api/chat/stream
    // feature-detects stream(). Also pre-headers, so it is a real status code.
    if (typeof provider.runAgent !== "function") {
      res.status(501).json({
        code: "agent_unsupported",
        provider: provider.id,
        error: `Provider "${provider.id}" does not support the agent loop`
      });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const sendEvent = (event: AgentStepEvent) => {
      switch (event.type) {
        case "text-delta":
          send("text-delta", { delta: event.delta });
          break;
        case "tool-call": {
          const args = serializePayload(event.args);
          send("tool-call", { id: event.id, toolName: event.toolName, argsJson: args.json, truncated: args.truncated });
          break;
        }
        case "tool-result": {
          const result = serializePayload(event.result);
          send("tool-result", { id: event.id, resultJson: result.json, truncated: result.truncated });
          break;
        }
        case "step":
          send("step", { index: event.index });
          break;
        case "done":
          send("done", { message: event.message, provider: provider.id });
          break;
      }
    };

    try {
      for await (const event of provider.runAgent({
        messages: input.messages,
        context: input.context,
        tools,
        maxSteps: input.maxSteps
      })) {
        sendEvent(event);
      }
      res.end();
    } catch (error) {
      // Headers are already sent, so report the failure as a stream event.
      send("error", { error: error instanceof Error ? error.message : "agent stream failed" });
      res.end();
    }
  });
}
