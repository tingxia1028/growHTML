// Chat-session domain service (ai-workspace.md §2.1, W1) — the durable, resumable
// conversations behind the chat panel. Carries the envelope assembly (id/type/
// timestamps), the message `ts` stamping, and the auto-title rule (first user
// message, truncated); the routes in src/server/chatSessions.ts are thin edges
// over these functions (the F2 register-module shape). Streaming itself is
// untouched: /api/chat/stream stays the transport; the CLIENT appends the turns
// here (user message on send, assistant message on stream end).
import { z } from "zod";
import { createEntityId } from "../../core/ids";
import {
  chatSessionAttachmentSchema,
  chatSessionSchema,
  type ChatSessionMessage,
  type ChatSessionRecord
} from "../../core/schema";
import type { StudyVault } from "../../core/vault";
import { NotFoundError } from "./errors";

export type ChatSessionsDeps = { vault: StudyVault; now?: () => number };

const nowIso = (deps: ChatSessionsDeps) => new Date(deps.now ? deps.now() : Date.now()).toISOString();

/** How many characters of the first user message become the auto title. */
export const SESSION_TITLE_MAX_CHARS = 40;

// Wire-side message input: role/content are required (the ai ChatMessage shape);
// `ts` is optional — the server stamps arrival time when the client omits it.
const sessionMessageInputSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1),
  ts: z.string().optional()
});
export type SessionMessageInput = z.infer<typeof sessionMessageInputSchema>;

export const createChatSessionRequestSchema = z.object({
  title: z.string().optional(),
  messages: z.array(sessionMessageInputSchema).default([]),
  attachments: z.array(chatSessionAttachmentSchema).default([])
});
export type CreateChatSessionInput = z.infer<typeof createChatSessionRequestSchema>;

export const updateChatSessionRequestSchema = z.object({
  title: z.string().min(1)
});
export type UpdateChatSessionInput = z.infer<typeof updateChatSessionRequestSchema>;

export const appendChatMessagesRequestSchema = z.object({
  messages: z.array(sessionMessageInputSchema).min(1)
});
export type AppendChatMessagesInput = z.infer<typeof appendChatMessagesRequestSchema>;

/** The session list is summaries — the transcript only rides the single-session GET. */
export type ChatSessionSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

/** Auto title = the first USER message, whitespace-collapsed and truncated. */
export function deriveSessionTitle(messages: Array<{ role: string; content: string }>): string {
  const first = messages.find((message) => message.role === "user");
  if (!first) return "";
  const collapsed = first.content.replace(/\s+/g, " ").trim();
  return collapsed.length > SESSION_TITLE_MAX_CHARS ? `${collapsed.slice(0, SESSION_TITLE_MAX_CHARS)}…` : collapsed;
}

const stampMessages = (deps: ChatSessionsDeps, messages: SessionMessageInput[]): ChatSessionMessage[] =>
  messages.map((message) => ({ role: message.role, content: message.content, ts: message.ts ?? nowIso(deps) }));

export async function listChatSessions(deps: ChatSessionsDeps): Promise<ChatSessionSummary[]> {
  const sessions = await deps.vault.stores.chatSessions.list();
  return sessions
    .map((session) => ({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messages.length
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
}

export async function getChatSession(deps: ChatSessionsDeps, input: { sessionId: string }): Promise<ChatSessionRecord> {
  const session = await deps.vault.stores.chatSessions.get(input.sessionId);
  if (!session) throw new NotFoundError("Chat session not found");
  return session;
}

export async function createChatSession(deps: ChatSessionsDeps, input: CreateChatSessionInput): Promise<ChatSessionRecord> {
  const now = nowIso(deps);
  const messages = stampMessages(deps, input.messages);
  const session = chatSessionSchema.parse({
    id: createEntityId("chatSession"),
    type: "chatSession",
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: "user",
    title: input.title?.trim() || deriveSessionTitle(messages),
    messages,
    attachments: input.attachments
  });
  await deps.vault.stores.chatSessions.upsert(session);
  return session;
}

export async function updateChatSession(
  deps: ChatSessionsDeps,
  input: { sessionId: string } & UpdateChatSessionInput
): Promise<ChatSessionRecord> {
  const session = await getChatSession(deps, input);
  const next = chatSessionSchema.parse({ ...session, title: input.title.trim(), updatedAt: nowIso(deps) });
  await deps.vault.stores.chatSessions.upsert(next);
  return next;
}

/** Append turns (server stamps `ts`); the auto title fills in once a user turn exists. */
export async function appendChatMessages(
  deps: ChatSessionsDeps,
  input: { sessionId: string } & AppendChatMessagesInput
): Promise<ChatSessionRecord> {
  const session = await getChatSession(deps, input);
  const messages = [...session.messages, ...stampMessages(deps, input.messages)];
  const next = chatSessionSchema.parse({
    ...session,
    messages,
    title: session.title || deriveSessionTitle(messages),
    updatedAt: nowIso(deps)
  });
  await deps.vault.stores.chatSessions.upsert(next);
  return next;
}

export async function deleteChatSession(deps: ChatSessionsDeps, input: { sessionId: string }): Promise<void> {
  const removed = await deps.vault.stores.chatSessions.delete(input.sessionId);
  if (!removed) throw new NotFoundError("Chat session not found");
}
