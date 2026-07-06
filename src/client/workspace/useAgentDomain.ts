// PLAT-LAYER Part-2 Slice 7c — the AGENT domain hook (the THIRD + FINAL of Slice 7's
// three sub-slices; it FLIPS the "WorkspaceContext only-composes" acceptance row
// RED → GREEN). Extracted VERBATIM from WorkspaceContext.tsx (no functional change):
// the A4b agent-loop transcript state (agentTurn) + the ACTIVE-provider capability
// readouts (agentAvailable / visionAvailable / offlineMock), the agent-turn runner
// (runAgentTurn) + the §10 chat-card regenerate (regenerateChatReply), and — the BRIDGE
// — buildChatContext + resolveAttachmentBundles (whose runtime consumers are runAgentTurn
// AND the coordinator's commandContext, which awaits them for anchor.ask-ai). The LAST 3
// provider-body entityClient sites move in with them: aiProviders (the mount availability
// effect), agentStream (runAgentTurn), and sourceBundle (resolveAttachmentBundles — the
// LAST provider-body entityClient call, whose relocation empties the provider of
// entityClient CALL sites → the acceptance flip).
//
// THE CRUX — the trampoline seam (docs/implementation/part-2-slice7-build-plan.md §CRUX):
// this hook reads the coordinator's `dispatch` (regenerateChatReply dispatches
// anchor.ask-ai) AND the coordinator's commandContext reads THIS hook's bridge
// (agent.buildChatContext / agent.resolveAttachmentBundles). The apparent cycle is
// resolved exactly as 7a resolved it: `dispatch` is handed in as a STABLE ([]-deps)
// trampoline (backed by dispatchRef), so this hook's callback identities don't churn; and
// the bridge is declared HERE (before commandContext, which is declared after this hook in
// the provider) — commandContext reads the bridge off the `agent` surface directly, no
// trampoline needed (agent is declared after docs/chat so it reads their outputs directly).
//
// THE SURFACE is a `useMemo`-wrapped object keyed on EVERY field it exposes — the
// memoized-surface contract the whole Part-2 split depends on: a fresh object literal each
// render would bust the provider's value memo and re-render all 25 consumers. Follows the
// proven useGenerationDomain / useComposerDomain reference. The public WorkspaceContextValue
// agent fields ride on it (agentTurn / agentAvailable / visionAvailable / offlineMock /
// runAgentTurn / regenerateChatReply) plus two coordinator-only riders (buildChatContext /
// resolveAttachmentBundles) — harmless extras no context consumer reads (mirroring
// generation's parkDraft rider + composer's resetReaderDraftInputs rider).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  entityClient,
  chatContentText,
  type ChatContext,
  type ChatMessage
} from "../data/entityClient";
import type { FocusContextValue } from "../focus/FocusContext";
import type { SourceRecord } from "../data/entityClient";
// A4b: the agent-loop transcript — a render-only turn state accumulated from the agent
// SSE (entityClient.agentStream). Distinct from the persisted chat log; only done.message
// becomes a real assistant turn (via the existing appendAssistant seam).
import { initialAgentTurn, reduceAgentEvent, type AgentTurnState } from "./agentTurnReducer";
// W2 (ai-workspace §W2): the PURE assembly of the chat's source-context set (focused
// source ∪ session attachments, deduped + capped). The bundle fetch lives here (the
// resolveAttachmentBundles resolver); the merge/cap stays pure and unit-tested next door.
import { assembleContextSources, type ResolvedBundle } from "../chat/chatContextAssembly";
import type { ChatSessionDomain } from "../chat/useChatSessions";
import type { Dispatch } from "./useGenerationDomain";

/** The precise slice of the chat-session domain surface this hook consumes: the visible
    transcript (`messages`), the two persistence seams runAgentTurn drives (recordHistory
    on the user turn, appendAssistant on the final answer), and the W2 attachment set
    resolveAttachmentBundles reads (sessions.attachments). Injecting the exact slice keeps
    the hook's contract narrow (no reach-around into unrelated chat state). */
export type AgentChatSurface = Pick<ChatSessionDomain, "messages" | "recordHistory" | "appendAssistant"> & {
  sessions: Pick<ChatSessionDomain["sessions"], "attachments">;
};

export interface AgentDomain {
  // —— A4b agent loop (tool-calling) ——
  /** The in-flight/last agent turn's render-only transcript (tool cards + streamed text),
      null when no agent turn is active. Distinct from the persisted chat log. */
  agentTurn: AgentTurnState | null;
  /** Whether the ACTIVE provider advertises app-defined tool calling — gates the 🛠 button. */
  agentAvailable: boolean;
  /** V-2: whether the ACTIVE provider advertises IMAGE input — a UI HINT only (the 拍错题
      affordance stays visible regardless; a non-vision send surfaces the clean 400). */
  visionAvailable: boolean;
  /** Alpha polish: the ACTIVE AI provider is the offline `mock` — its chat replies are
      canned placeholder echoes. Drives a dismissible honesty hint in the chat surface. */
  offlineMock: boolean;
  /** Run ONE agent turn on `text` (records the user turn once, streams tool cards, then
      persists the final answer as a normal assistant reply). */
  runAgentTurn(text: string): Promise<void>;
  /** §10 chat card "Regenerate": re-ask the most recent user question, appending a fresh
      assistant reply to the thread. A no-op when there is no prior user prompt. */
  regenerateChatReply(): void;
  // —— coordinator-only riders (not on the public value surface) ——
  /** The chat context (source location + focused passage) the assistant answers against.
      Consumed by runAgentTurn AND the coordinator's commandContext (anchor.ask-ai). */
  buildChatContext(): ChatContext;
  /** W2: resolve the chat's source-context set — the FOCUSED source ∪ the session's
      explicit attachments, deduped + capped (owns the LAST provider-body sourceBundle
      site). Consumed by runAgentTurn AND commandContext (anchor.ask-ai feature-detects it). */
  resolveAttachmentBundles(): Promise<ChatContext["sources"]>;
}

export function useAgentDomain({
  chat,
  focus,
  activeSource,
  activeSourceId,
  dispatch,
  onStatus,
  onError
}: {
  /** The precise chat-session surface slice (messages + recordHistory/appendAssistant +
      sessions.attachments) runAgentTurn/resolveAttachmentBundles need. */
  chat: AgentChatSurface;
  /** The shared kernel focus (from the provider's useFocus()). Read-only here —
      buildChatContext reads focus.draft/anchor for the passage context. */
  focus: FocusContextValue;
  /** The focused/active source (documents surface) — buildChatContext reads its
      metadata/title/type/path for the source context. */
  activeSource: SourceRecord | null;
  /** The focused/active source id (documents surface) — resolveAttachmentBundles's
      focused-first de-dup key. */
  activeSourceId: string;
  /** The coordinator's dispatch — handed in as a STABLE trampoline (never the real one) so
      regenerateChatReply's identity stays stable. */
  dispatch: Dispatch;
  /** Decoupled busy-state sink (the documents surface's setStatus). */
  onStatus: (status: "idle" | "loading" | "saving" | "error") => void;
  /** Decoupled error sink (the documents surface's setError). */
  onError: (message: string) => void;
}): AgentDomain {
  // A4b: the in-flight/last agent turn's render-only transcript (tool cards + streamed
  // text), null when no agent turn has run this session. `agentAvailable` is a mount
  // read of the ACTIVE provider's `tools` capability — the gated 🛠 button shows only
  // when true (a provider that lacks runAgent would 501).
  const [agentTurn, setAgentTurn] = useState<AgentTurnState | null>(null);
  const [agentAvailable, setAgentAvailable] = useState(false);
  // V-2 (拍错题): a mount read of the ACTIVE provider's `vision` capability. The 拍错题
  // capture affordance stays visible regardless (degrade-not-disappear); this flag only
  // lets the UI HINT when a non-vision provider would surface the clean 400 on send.
  const [visionAvailable, setVisionAvailable] = useState(false);
  // Offline-Mock honesty (alpha polish): the ACTIVE provider is the deterministic offline
  // `mock` (fresh install, no real provider configured) — its replies are canned echoes.
  // Read once from the SAME aiProviders() mount effect (active.kind === "mock"); the chat
  // surface shows a dismissible hint pointing at AI 提供方 settings. Best-effort: any read
  // failure leaves it false (no banner — the pre-existing silent behavior).
  const [offlineMock, setOfflineMock] = useState(false);

  const messages = chat.messages;
  const attachments = chat.sessions.attachments;

  // A4b: read the ACTIVE provider's tool capability once on mount so the gated 🛠 button
  // knows whether the agent loop is available. The GET returns the descriptor list with
  // capabilities; match the active id and read `tools`. Best-effort — any failure leaves
  // the button hidden (plain chat still works).
  useEffect(() => {
    // Feature-detect the readout (tests stub a partial entityClient without it) so a
    // missing method never throws inside the effect — the button just stays hidden.
    if (typeof entityClient.aiProviders !== "function") return;
    let cancelled = false;
    void Promise.resolve()
      .then(() => entityClient.aiProviders())
      .then((info) => {
        if (cancelled) return;
        const active = info.providers.find((provider) => provider.id === info.active.id);
        setAgentAvailable(active?.capabilities?.tools === true);
        // V-2: the same readout feeds the 拍错题 vision hint (degrade-not-disappear).
        setVisionAvailable(active?.capabilities?.vision === true);
        // Offline-Mock honesty: the server reports the active provider's capability kind
        // (aiProviders.ts → active.kind = capabilities.kind), which is "mock" for BOTH the
        // mock and mock-agent providers — a keyless/offline default. The chat surface hints.
        setOfflineMock(info.active.kind === "mock");
      })
      .catch(() => {
        if (!cancelled) {
          setAgentAvailable(false);
          setVisionAvailable(false);
          setOfflineMock(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Where the active source lives + the focused passage, so the assistant knows
  // exactly which source + passage a question is about.
  const buildChatContext = useCallback((): ChatContext => {
    const meta = (activeSource?.metadata ?? {}) as Record<string, unknown>;
    const url = (meta.sourceUrl ?? meta.normalizedUrl) as string | undefined;
    const filePath = meta.originalPath as string | undefined;
    const draft = focus.draft;
    const quoteDraft = draft?.mode === "quote" ? draft : null;
    const anchorLike = focus.anchor as { contextBefore?: string; contextAfter?: string; page?: number } | null;
    const page = (draft && "page" in draft ? draft.page : undefined) ?? anchorLike?.page;
    const locationParts: string[] = [];
    if (url) locationParts.push(url);
    else if (filePath) locationParts.push(filePath);
    else if (activeSource?.path) locationParts.push(activeSource.path);
    if (page) locationParts.push(`page ${page}`);
    return {
      sourceTitle: activeSource?.title,
      sourceType: activeSource?.sourceType,
      location: locationParts.join(" · ") || undefined,
      quote: quoteDraft?.quote ?? focus.anchor?.quote,
      contextBefore: quoteDraft?.prefix ?? anchorLike?.contextBefore,
      contextAfter: quoteDraft?.suffix ?? anchorLike?.contextAfter
    };
  }, [activeSource, focus.draft, focus.anchor]);

  // W2 (ai-workspace §W2): resolve the chat's source-context set — the FOCUSED source
  // (passage-level, keyed by activeSourceId) UNION the session's explicit attachments
  // (source-level), de-duped by sourceId (focused-first). Fetch each source's bundle
  // (bounded excerpt + sealed-filtered notes) then hand the PURE assembler the union +
  // the cross-source cap. CHAT-ONLY: awaited by anchor.ask-ai via the feature-detected
  // resolveAttachmentBundles seam; nothing else calls it. Bundle-fetch failures degrade
  // to skipping that source (a broken read must not sink the whole ask). Owns the LAST
  // provider-body entityClient site (sourceBundle) — its relocation flips the acceptance row.
  const resolveAttachmentBundles = useCallback(async (): Promise<ChatContext["sources"]> => {
    const focusedId = activeSourceId || "";
    // The de-dup KEY set: focused source first, then each attached source not equal to it.
    const attachedIds = attachments.map((item) => item.sourceId);
    const orderedIds = [focusedId, ...attachedIds].filter(Boolean);
    if (orderedIds.length === 0) return undefined;
    const includeNotesById = new Map(attachments.map((item) => [item.sourceId, item.includeNotes]));
    const seen = new Set<string>();
    const resolved: ResolvedBundle[] = [];
    for (const sourceId of orderedIds) {
      if (seen.has(sourceId)) continue;
      seen.add(sourceId);
      const focused = sourceId === focusedId;
      // Focused source: always include its notes; an attachment honors its includeNotes flag.
      const includeNotes = focused ? true : includeNotesById.get(sourceId) ?? true;
      try {
        const { bundle } = await entityClient.sourceBundle(sourceId, includeNotes);
        resolved.push({ sourceId, focused, bundle });
      } catch {
        // Skip a source whose bundle can't be read — the rest of the context still helps.
      }
    }
    const sources = assembleContextSources(resolved);
    return sources.length > 0 ? sources : undefined;
  }, [activeSourceId, attachments]);

  // §10 chat card "Regenerate": re-ask the most recent user question, appending a fresh
  // assistant reply to the thread (the streaming ask path handles the rest). A no-op if
  // there is no prior user prompt.
  const regenerateChatReply = useCallback(() => {
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    if (!lastUser) return;
    // V-1: collapse a multimodal turn to text for the re-ask (image → `[image]`).
    void dispatch("anchor.ask-ai", { text: chatContentText(lastUser.content) });
  }, [messages, dispatch]);

  // A4b: run ONE agent turn (the 🛠 用工具 button). Invoked DIRECTLY here — not through
  // the command registry — because the tool cards are render-only state with no
  // persistence contract until `done` (DELTA 4). Mirrors askAi's context assembly:
  //   • record the user turn EXACTLY ONCE via the existing recordHistory seam (DELTA 5);
  //     the SSE `done` must NOT re-append it.
  //   • reuse buildChatContext() + resolveAttachmentBundles() exactly as askAi does.
  //   • fold each SSE event into agentTurn via the pure reducer; on `done` persist the
  //     final message as the ONE real assistant turn (appendAssistant), then clear the
  //     transcript; on reject keep the accumulated items in an error state.
  const runAgentTurn = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text) return;
      const history: ChatMessage[] = [...messages, { role: "user", content: text }];
      // Record the user turn ONCE (the visible transcript + persistence seam).
      chat.recordHistory(history);
      onStatus("saving");
      onError("");
      setAgentTurn(initialAgentTurn());
      try {
        const sources = await resolveAttachmentBundles();
        const context: ChatContext | undefined =
          sources && sources.length > 0 ? { ...buildChatContext(), sources } : buildChatContext();
        const { message } = await entityClient.agentStream(
          { messages: history, context },
          {
            onStep: () => setAgentTurn((turn) => reduceAgentEvent(turn ?? initialAgentTurn(), { type: "step", index: 0 })),
            onTextDelta: (delta) =>
              setAgentTurn((turn) => reduceAgentEvent(turn ?? initialAgentTurn(), { type: "text-delta", delta })),
            onToolCall: (call) =>
              setAgentTurn((turn) => reduceAgentEvent(turn ?? initialAgentTurn(), { type: "tool-call", ...call })),
            onToolResult: (result) =>
              setAgentTurn((turn) => reduceAgentEvent(turn ?? initialAgentTurn(), { type: "tool-result", ...result }))
          }
        );
        // The final answer becomes the ONE real assistant turn — appended to the visible
        // chat log AND persisted via appendAssistant (Add-as-note / regenerate keep
        // working). Unlike the streaming ask path there were no applyChunk deltas
        // building a visible bubble (the transcript did), so append (not persist) here.
        // Mark the transcript done, then drop the tool cards.
        setAgentTurn((turn) => reduceAgentEvent(turn ?? initialAgentTurn(), { type: "done", message, provider: "" }));
        chat.appendAssistant(message);
        setAgentTurn(null);
        onStatus("idle");
      } catch (err) {
        const messageText = err instanceof Error ? err.message : "工具调用失败";
        // Keep the accumulated tool cards but flip the turn to error so the user sees why.
        setAgentTurn((turn) => reduceAgentEvent(turn ?? initialAgentTurn(), { type: "error", error: messageText }));
        onError(messageText);
        onStatus("error");
      }
    },
    [messages, chat, buildChatContext, resolveAttachmentBundles, onStatus, onError]
  );

  return useMemo<AgentDomain>(
    () => ({
      agentTurn,
      agentAvailable,
      visionAvailable,
      offlineMock,
      runAgentTurn,
      regenerateChatReply,
      // coordinator-only riders
      buildChatContext,
      resolveAttachmentBundles
    }),
    [
      agentTurn,
      agentAvailable,
      visionAvailable,
      offlineMock,
      runAgentTurn,
      regenerateChatReply,
      buildChatContext,
      resolveAttachmentBundles
    ]
  );
}
