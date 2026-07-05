// Chat-session IO (ai-workspace.md §2.1, W1) — the client edge of /api/chat/sessions.
// Lives in the chat domain module with its OWN transport instance (the dataTrust/
// speech carve-out idiom) instead of growing the contended entityClient; JSON rides
// the same VaultTransport fetch shape. Swappable via the test seam below (the
// userMenuIo/dataTrust idiom). Direct-transport (mobile X2) parity is deferred with
// the rest of the chat lane — these endpoints are HTTP for now.

import { createHttpTransport } from "../data/transport";

/** V-1 (vision-input.md §2): the WIRE multimodal content parts, mirrored client-side
    (the client never imports core/ai). An image part is a REF into the asset store
    (`GET /api/assets/:assetId`), never inline bytes. */
export type ContentPart = { type: "text"; text: string } | { type: "image"; assetId: string; mimeType?: string };

/** The ai ChatMessage shape (role/content), structurally compatible with
    entityClient's — defined here so the chat domain never imports the contended
    entityClient. Persisted messages additionally carry the server's `ts` stamp.
    V-1: `content` widens to `string | ContentPart[]` (an image message rides an array). */
export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
};

export type ChatSessionMessage = ChatMessage & { ts?: string };

export type ChatSessionAttachment = { sourceId: string; includeNotes: boolean };

/** One row of GET /api/chat/sessions — the transcript only rides the single GET. */
export type ChatSessionSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

export type ChatSessionRecord = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatSessionMessage[];
  attachments: ChatSessionAttachment[];
};

export type ChatSessionIo = {
  /** GET /api/chat/sessions — summaries, newest first. */
  list(): Promise<{ sessions: ChatSessionSummary[] }>;
  /** GET /api/chat/sessions/:id — the full transcript. */
  get(sessionId: string): Promise<{ session: ChatSessionRecord }>;
  /** POST /api/chat/sessions — title auto-derives server-side when omitted. */
  create(input: {
    title?: string;
    messages?: ChatMessage[];
    attachments?: ChatSessionAttachment[];
  }): Promise<{ session: ChatSessionRecord }>;
  /** POST /api/chat/sessions/:id/messages — append turns (server stamps `ts`). */
  append(sessionId: string, messages: ChatMessage[]): Promise<{ session: ChatSessionRecord }>;
  /** PATCH /api/chat/sessions/:id — rename. */
  rename(sessionId: string, title: string): Promise<{ session: ChatSessionRecord }>;
  /** PATCH /api/chat/sessions/:id — set the FULL attachment set (W2 write path). */
  setAttachments(sessionId: string, attachments: ChatSessionAttachment[]): Promise<{ session: ChatSessionRecord }>;
  /** DELETE /api/chat/sessions/:id. */
  remove(sessionId: string): Promise<{ ok: true }>;
};

const transport = createHttpTransport();

const defaultIo: ChatSessionIo = {
  list: () => transport.request("GET", "/api/chat/sessions"),
  get: (sessionId) => transport.request("GET", `/api/chat/sessions/${sessionId}`),
  create: (input) => transport.request("POST", "/api/chat/sessions", input),
  append: (sessionId, messages) =>
    transport.request("POST", `/api/chat/sessions/${sessionId}/messages`, { messages }),
  rename: (sessionId, title) => transport.request("PATCH", `/api/chat/sessions/${sessionId}`, { title }),
  setAttachments: (sessionId, attachments) =>
    transport.request("PATCH", `/api/chat/sessions/${sessionId}`, { attachments }),
  remove: (sessionId) => transport.request("DELETE", `/api/chat/sessions/${sessionId}`)
};

let io: ChatSessionIo = defaultIo;

export function getChatSessionIo(): ChatSessionIo {
  return io;
}

/** Test seam: override any subset of the IO edges (null restores the real ones). */
export function setChatSessionIoForTests(next: Partial<ChatSessionIo> | null): void {
  io = next ? { ...defaultIo, ...next } : defaultIo;
}
