// agentTranscript — the PURE reducer behind the A4b agent-loop transcript
// (docs/implementation/a4b-build-spec.md). The agent SSE (POST /api/agent/stream)
// forwards six typed events; this module folds them into a render-only
// `AgentTurnState` the chat panel shows as tool-call/result CARDS + the streamed
// answer. It is NOT a ChatMessage list — only the final `done.message` becomes a
// persisted assistant turn (the WorkspaceContext wiring does that). Keeping the fold
// pure makes accumulation / keyed tool transitions / truncated-payload guarding all
// unit-testable without the DOM.
//
// DELTA 3 (the review): the wire sends args/result as PRE-SERIALIZED JSON strings
// capped at AGENT_EVENT_PAYLOAD_CHAR_CAP (server agent.ts). A truncated payload no
// longer parses — so every JSON.parse here is GUARDED: on failure we keep the raw
// string and flip a `truncated`/parse-failed flag rather than throwing (which would
// sink the whole transcript).

import type { ChatMessage } from "../data/entityClient";

/** One rendered row of the transcript: streamed text, or one tool call+result. */
export type AgentTranscriptItem =
  | { kind: "text"; content: string }
  | {
      kind: "tool";
      /** Tool-call id — the key the tool-result is matched back onto. */
      id: string;
      toolName: string;
      /** Parsed args, or `undefined` when the argsJson didn't parse (truncated/bad). */
      args?: unknown;
      /** The raw argsJson string (always kept, so a non-parsing payload still renders). */
      argsRaw: string;
      /** Parsed result once it arrives (undefined while calling / on parse failure). */
      result?: unknown;
      /** The raw resultJson string once the result arrives. */
      resultRaw?: string;
      /** A human error string when the tool reported one (in-band tool-result{error}). */
      error?: string;
      /** Lifecycle: awaiting the result → resolved → the result carried an error. */
      state: "calling" | "done" | "error";
      /** The server flagged the args OR result JSON as capped (>4000 chars). */
      truncated: boolean;
    };

/** The whole agent turn as the panel renders it. */
export type AgentTurnState = {
  items: AgentTranscriptItem[];
  status: "running" | "done" | "error";
  /** The `done.message` once the turn completes — the ONE turn that persists. */
  message?: ChatMessage;
  /** A hard-error string (SSE `error` event or a rejected stream). */
  error?: string;
};

/** The six agent SSE events, in the client-side shapes entityClient.agentStream hands us. */
export type AgentEvent =
  | { type: "step"; index: number }
  | { type: "text-delta"; delta: string }
  | { type: "tool-call"; id: string; toolName: string; argsJson: string; truncated: boolean }
  | { type: "tool-result"; id: string; resultJson: string; truncated: boolean }
  | { type: "done"; message: ChatMessage; provider: string }
  | { type: "error"; error: string };

/** A fresh, empty running turn. */
export function initialAgentTurn(): AgentTurnState {
  return { items: [], status: "running" };
}

/** Guarded JSON.parse: returns the value, or `undefined` when it doesn't parse. */
function tryParse(json: string): { value: unknown; ok: boolean } {
  try {
    return { value: JSON.parse(json), ok: true };
  } catch {
    return { value: undefined, ok: false };
  }
}

/**
 * Fold one agent event into the turn (pure — returns a NEW state, never mutates).
 * - text-delta: append to the trailing text item (or start one) so consecutive
 *   deltas coalesce into one bubble.
 * - tool-call: push a `calling` tool item keyed by id (guarded arg parse).
 * - tool-result: find the item by id, attach the parsed result, and settle to
 *   `error` when the parsed result is a `{ error }` object, else `done`.
 * - step: no visible row (a loop boundary) — state is unchanged.
 * - done / error: terminal status (+ the persisted message on done).
 */
export function reduceAgentEvent(state: AgentTurnState, event: AgentEvent): AgentTurnState {
  switch (event.type) {
    case "step":
      // A loop boundary — no transcript row of its own; leaves items untouched.
      return state;

    case "text-delta": {
      const items = [...state.items];
      const last = items[items.length - 1];
      if (last && last.kind === "text") {
        items[items.length - 1] = { kind: "text", content: last.content + event.delta };
      } else {
        items.push({ kind: "text", content: event.delta });
      }
      return { ...state, items };
    }

    case "tool-call": {
      const parsed = tryParse(event.argsJson);
      const item: AgentTranscriptItem = {
        kind: "tool",
        id: event.id,
        toolName: event.toolName,
        args: parsed.ok ? parsed.value : undefined,
        argsRaw: event.argsJson,
        state: "calling",
        // Server-flagged cap OR a locally non-parsing payload both mark truncation.
        truncated: event.truncated || !parsed.ok
      };
      return { ...state, items: [...state.items, item] };
    }

    case "tool-result": {
      const parsed = tryParse(event.resultJson);
      // A parsed result that is a plain `{ error: string }` means the tool failed
      // (kept in-band by the loop) — surface it as the item's error + `error` state.
      const errorMessage =
        parsed.ok && parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)
          ? (parsed.value as { error?: unknown }).error
          : undefined;
      const items = state.items.map((item) => {
        if (item.kind !== "tool" || item.id !== event.id) return item;
        return {
          ...item,
          result: parsed.ok ? parsed.value : undefined,
          resultRaw: event.resultJson,
          error: typeof errorMessage === "string" ? errorMessage : item.error,
          state: typeof errorMessage === "string" ? ("error" as const) : ("done" as const),
          // A cap OR a non-parsing result adds to the item's truncation flag.
          truncated: item.truncated || event.truncated || !parsed.ok
        };
      });
      return { ...state, items };
    }

    case "done":
      return { ...state, status: "done", message: event.message };

    case "error":
      // Keep the items accumulated so far (a partial transcript still informs the user).
      return { ...state, status: "error", error: event.error };

    default:
      return state;
  }
}
