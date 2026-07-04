// useChatSessionDomain (ai-workspace.md §2.1/§2.2, W1) — the chat-session domain
// module: the FIRST F1 slice. The transcript state + session list/load/save leave
// the WorkspaceContext god object and live here; the provider delegates through a
// minimal surface (`messages` keeps the exact `chatMessages` shape, plus ONE
// bundled `ChatSessionsApi` field for the panel's switcher).
//
// Persistence model ("the current conversation auto-persists"):
//   • user turn on send      → recordHistory (the onChatHistory seam) appends the
//     new turns to the session — creating it lazily on the first turn, with the
//     active source recorded as the session's attachment ref (§2.1 context set);
//   • assistant turn         → appendAssistant (non-streamed fallback) or
//     persistAssistant (the onAssistantDone stream-end seam — chunks already built
//     the visible reply, so this only persists);
//   • streaming chunks       → applyChunk is LOCAL-only (no partial writes).
// Writes ride a FIFO promise queue per mount so create→append never race; each
// enqueued op binds the conversation TOKEN captured at enqueue time, so turns land
// in the conversation they were sent from even if the user switches mid-flight.
// Persistence failures degrade to console.warn — the in-memory chat keeps working.
//
// Resume: the last session id is kept in localStorage; on mount the list is loaded
// and the stored session (else the most recent) is reopened — app restart resumes
// the conversation. An explicit 新对话 stores the NONE sentinel so a fresh start
// stays a fresh start across restarts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getChatSessionIo,
  type ChatMessage,
  type ChatSessionAttachment,
  type ChatSessionRecord,
  type ChatSessionSummary
} from "./sessionClient";

export type { ChatSessionAttachment } from "./sessionClient";

export type { ChatSessionSummary } from "./sessionClient";

export const ACTIVE_SESSION_STORAGE_KEY = "sv-chat-active-session";
/** Stored when the user explicitly starts fresh — restart must NOT auto-resume. */
const NONE_SENTINEL = "__none__";

/** The switcher surface (ONE bundled field on the WorkspaceContext, not N). */
export type ChatSessionsApi = {
  /** Session summaries, newest first. */
  list: ChatSessionSummary[];
  /** The persisted session the panel is on (null = an unsaved fresh conversation). */
  activeId: string | null;
  /** Start a fresh conversation (the next send creates a new session). */
  startNew(): void;
  /** Resume a session: load its transcript into the panel. */
  select(sessionId: string): Promise<void>;
  /** Delete a session (the caller confirms); deleting the active one starts fresh. */
  remove(sessionId: string): Promise<void>;
  // —— W2 attachments (ai-workspace §W2): the session's explicit context set ——
  /** The active conversation's attachments (the chips the composer renders). */
  attachments: ChatSessionAttachment[];
  /** Attach a source (idempotent by sourceId); persists through the FIFO queue,
      lazily creating the session when attaching BEFORE the first turn. */
  addAttachment(sourceId: string, includeNotes?: boolean): void;
  /** Detach a source; persists the remaining set. */
  removeAttachment(sourceId: string): void;
};

export type ChatSessionDomain = {
  /** The visible transcript — the exact shape `chatMessages` consumers expect. */
  messages: ChatMessage[];
  /** onChatHistory seam: full history on send — sets state + persists the new turns. */
  recordHistory(history: ChatMessage[]): void;
  /** onAssistantMessage seam (non-streamed reply): append to state + persist. */
  appendAssistant(message: ChatMessage): void;
  /** onAssistantChunk seam: progressive render only — never persists partials. */
  applyChunk(delta: string): void;
  /** onAssistantDone seam: the stream finished — persist the completed turn
      (state already holds the accumulated text). */
  persistAssistant(message: ChatMessage): void;
  sessions: ChatSessionsApi;
};

function readStoredActiveSession(): string | null {
  try {
    return globalThis.localStorage?.getItem(ACTIVE_SESSION_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function storeActiveSession(id: string | null): void {
  try {
    globalThis.localStorage?.setItem(ACTIVE_SESSION_STORAGE_KEY, id ?? NONE_SENTINEL);
  } catch {
    // storage unavailable — resume just won't survive a restart
  }
}

/** Strip the persistence-side `ts` so the transcript matches ChatMessage exactly. */
const toChatMessages = (session: ChatSessionRecord): ChatMessage[] =>
  session.messages.map(({ role, content }) => ({ role, content }));

const toSummary = (session: ChatSessionRecord): ChatSessionSummary => ({
  id: session.id,
  title: session.title,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  messageCount: session.messages.length
});

// One conversation's identity across async persistence: ops bind the token at
// enqueue time; the lazy create fills `sessionId` in for the ops queued behind it.
type ConversationToken = { sessionId: string | null };

export function useChatSessionDomain({ activeSourceId }: { activeSourceId?: string } = {}): ChatSessionDomain {
  const [sessionList, setSessionList] = useState<ChatSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // W2: the active conversation's attachments (source refs). Loaded on resume/select,
  // mutated by add/remove, persisted through the same FIFO queue as the turns.
  const [attachments, setAttachments] = useState<ChatSessionAttachment[]>([]);
  /** Always-current attachments for the enqueued persist op (avoids stale closures). */
  const attachmentsRef = useRef<ChatSessionAttachment[]>([]);
  attachmentsRef.current = attachments;

  const tokenRef = useRef<ConversationToken>({ sessionId: null });
  /** How many of `messages` are (queued to be) persisted — the append diff base. */
  const persistedCountRef = useRef(0);
  /** Latches once the user takes an explicit session action (新对话 / open) — after
      which the resume-on-mount effect must NOT apply its late `get()`, even though
      startNew() resets tokenRef/persistedCountRef to the "fresh" shape (which would
      otherwise pass the clobber guard and overwrite the just-opened conversation). */
  const userActedRef = useRef(false);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const sourceIdRef = useRef<string | undefined>(activeSourceId || undefined);
  useEffect(() => {
    sourceIdRef.current = activeSourceId || undefined;
  }, [activeSourceId]);

  const upsertSummary = useCallback((session: ChatSessionRecord) => {
    setSessionList((items) => {
      const rest = items.filter((item) => item.id !== session.id);
      return [toSummary(session), ...rest].sort(
        (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id)
      );
    });
  }, []);

  /** FIFO write queue — a failed op is logged and never blocks the next one. */
  const enqueue = useCallback((op: () => Promise<void>) => {
    queueRef.current = queueRef.current.then(op).catch((error) => {
      console.warn("[chat-sessions] persist failed:", error instanceof Error ? error.message : error);
    });
  }, []);

  // Attachments to seed a lazily-created session: the EXPLICIT set (chips the user
  // attached) wins; when none, fall back to the focused source as the §2.1 auto ref.
  const seedAttachments = useCallback((): ChatSessionAttachment[] => {
    if (attachmentsRef.current.length > 0) return attachmentsRef.current;
    return sourceIdRef.current ? [{ sourceId: sourceIdRef.current, includeNotes: true }] : [];
  }, []);

  // Reflect a just-created session into the panel when it's still the active token.
  const adoptCreated = useCallback(
    (token: ConversationToken, session: ChatSessionRecord) => {
      token.sessionId = session.id;
      if (tokenRef.current === token) {
        setActiveSessionId(session.id);
        setAttachments(session.attachments);
        storeActiveSession(session.id);
      }
      upsertSummary(session);
    },
    [upsertSummary]
  );

  /** Persist turns into the token's conversation, creating the session lazily. */
  const persistTurns = useCallback(
    (token: ConversationToken, turns: ChatMessage[]) => {
      if (turns.length === 0) return;
      const attachments = seedAttachments();
      enqueue(async () => {
        const io = getChatSessionIo();
        if (!token.sessionId) {
          // First turn of a fresh conversation → create (title auto-derives; the
          // explicit attachments — else the active source — ride along as the §2.1
          // context set).
          const { session } = await io.create({ messages: turns, attachments });
          adoptCreated(token, session);
          return;
        }
        const { session } = await io.append(token.sessionId, turns);
        upsertSummary(session);
      });
    },
    [enqueue, upsertSummary, seedAttachments, adoptCreated]
  );

  /**
   * Persist the session's attachment set. LAZY-CREATE: attaching BEFORE the first turn
   * (no session yet) CREATES an empty session carrying the attachments — the queue only
   * created in persistTurns before, so this is the create-or-patch trigger W2 adds.
   * Otherwise it PATCHes the full set (full-replace, like note layerIds).
   */
  const persistAttachments = useCallback(
    (token: ConversationToken, next: ChatSessionAttachment[]) => {
      enqueue(async () => {
        const io = getChatSessionIo();
        if (!token.sessionId) {
          const { session } = await io.create({ attachments: next });
          adoptCreated(token, session);
          return;
        }
        const { session } = await io.setAttachments(token.sessionId, next);
        upsertSummary(session);
      });
    },
    [enqueue, upsertSummary, adoptCreated]
  );

  // —— resume-on-mount: the stored last session, else the most recent ——
  useEffect(() => {
    let alive = true;
    void (async () => {
      let list: ChatSessionSummary[];
      try {
        list = (await getChatSessionIo().list()).sessions;
      } catch {
        return; // offline/failed — the chat still works in-memory
      }
      if (!alive) return;
      setSessionList(list);
      const storedId = readStoredActiveSession();
      if (storedId === NONE_SENTINEL) return; // explicit fresh start last time
      const resume = list.find((item) => item.id === storedId) ?? list[0];
      if (!resume) return;
      try {
        const { session } = await getChatSessionIo().get(resume.id);
        if (!alive) return;
        // Don't clobber a conversation the user already started while loading — either
        // by typing (sessionId/persistedCount grew) or by an explicit 新对话/open that
        // reset those refs to the fresh shape (userActedRef is the only durable witness).
        if (userActedRef.current || tokenRef.current.sessionId !== null || persistedCountRef.current > 0) return;
        tokenRef.current = { sessionId: session.id };
        persistedCountRef.current = session.messages.length;
        setActiveSessionId(session.id);
        setMessages(toChatMessages(session));
        setAttachments(session.attachments);
        storeActiveSession(session.id);
      } catch (error) {
        console.warn("[chat-sessions] resume failed:", error instanceof Error ? error.message : error);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // —— the command-action seams ——————————————————————————————————————————————

  const recordHistory = useCallback(
    (history: ChatMessage[]) => {
      const token = tokenRef.current;
      const turns = history.slice(persistedCountRef.current);
      persistedCountRef.current = history.length;
      setMessages(history);
      persistTurns(token, turns);
    },
    [persistTurns]
  );

  const appendAssistant = useCallback(
    (message: ChatMessage) => {
      const token = tokenRef.current;
      persistedCountRef.current += 1;
      setMessages((items) => [...items, message]);
      persistTurns(token, [message]);
    },
    [persistTurns]
  );

  // Progressive streaming: append the delta to the trailing assistant message, or
  // start a new one if the last message is the user's prompt (moved verbatim from
  // the WorkspaceContext inline handler). Local-only — no partial writes.
  const applyChunk = useCallback((delta: string) => {
    setMessages((items) => {
      const last = items[items.length - 1];
      if (last && last.role === "assistant") {
        return [...items.slice(0, -1), { ...last, content: last.content + delta }];
      }
      return [...items, { role: "assistant", content: delta }];
    });
  }, []);

  const persistAssistant = useCallback(
    (message: ChatMessage) => {
      const token = tokenRef.current;
      persistedCountRef.current += 1; // the chunks' accumulated message is now durable
      persistTurns(token, [message]);
    },
    [persistTurns]
  );

  // —— the switcher surface ——————————————————————————————————————————————————

  const startNew = useCallback(() => {
    userActedRef.current = true;
    tokenRef.current = { sessionId: null };
    persistedCountRef.current = 0;
    setActiveSessionId(null);
    setMessages([]);
    setAttachments([]);
    storeActiveSession(null);
  }, []);

  const select = useCallback(
    async (sessionId: string) => {
      userActedRef.current = true;
      try {
        const { session } = await getChatSessionIo().get(sessionId);
        tokenRef.current = { sessionId: session.id };
        persistedCountRef.current = session.messages.length;
        setActiveSessionId(session.id);
        setMessages(toChatMessages(session));
        setAttachments(session.attachments);
        storeActiveSession(session.id);
        upsertSummary(session);
      } catch (error) {
        console.warn("[chat-sessions] open failed:", error instanceof Error ? error.message : error);
      }
    },
    [upsertSummary]
  );

  // —— W2 attachment ops (optimistic local state + FIFO-queued persistence) ——
  const addAttachment = useCallback(
    (sourceId: string, includeNotes = true) => {
      const token = tokenRef.current;
      // Idempotent by sourceId: a re-attach updates includeNotes but never duplicates.
      const next = [
        ...attachmentsRef.current.filter((item) => item.sourceId !== sourceId),
        { sourceId, includeNotes }
      ];
      setAttachments(next);
      persistAttachments(token, next);
    },
    [persistAttachments]
  );

  const removeAttachment = useCallback(
    (sourceId: string) => {
      const token = tokenRef.current;
      const next = attachmentsRef.current.filter((item) => item.sourceId !== sourceId);
      setAttachments(next);
      persistAttachments(token, next);
    },
    [persistAttachments]
  );

  const remove = useCallback(
    async (sessionId: string) => {
      try {
        await getChatSessionIo().remove(sessionId);
      } catch (error) {
        console.warn("[chat-sessions] delete failed:", error instanceof Error ? error.message : error);
        return;
      }
      setSessionList((items) => items.filter((item) => item.id !== sessionId));
      if (tokenRef.current.sessionId === sessionId) startNew();
    },
    [startNew]
  );

  const sessions = useMemo<ChatSessionsApi>(
    () => ({
      list: sessionList,
      activeId: activeSessionId,
      startNew,
      select,
      remove,
      attachments,
      addAttachment,
      removeAttachment
    }),
    [sessionList, activeSessionId, startNew, select, remove, attachments, addAttachment, removeAttachment]
  );

  return useMemo<ChatSessionDomain>(
    () => ({ messages, recordHistory, appendAssistant, applyChunk, persistAssistant, sessions }),
    [messages, recordHistory, appendAssistant, applyChunk, persistAssistant, sessions]
  );
}
