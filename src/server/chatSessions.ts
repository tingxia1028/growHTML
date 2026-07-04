// server-only — /api/chat/sessions CRUD + append (ai-workspace.md §2.1 W1, landed
// as a register module = an F2 slice, NOT more app.ts bloat; pattern mirrors
// registerMemoryRoutes/registerAgentRoutes). The chat TRANSPORT is untouched:
// /api/chat and /api/chat/stream stay in app.ts; the client persists the turns
// through these routes (user message on send, assistant message on stream end —
// the client is where the completed assistant turn is known once `done` arrives).

import type { Express } from "express";
import * as chatSessionsService from "./services/chatSessions";
import { handleServiceError } from "./services/errors";
import type { ChatSessionsDeps } from "./services/chatSessions";

export function registerChatRoutes(app: Express, deps: ChatSessionsDeps): void {
  app.get("/api/chat/sessions", async (_req, res, next) => {
    try {
      res.json({ sessions: await chatSessionsService.listChatSessions(deps) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/chat/sessions", async (req, res, next) => {
    try {
      const input = chatSessionsService.createChatSessionRequestSchema.parse(req.body);
      res.status(201).json({ session: await chatSessionsService.createChatSession(deps, input) });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  app.get("/api/chat/sessions/:sessionId", async (req, res, next) => {
    try {
      res.json({ session: await chatSessionsService.getChatSession(deps, { sessionId: req.params.sessionId }) });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // PATCH: rename (title, W1) and/or set attachments (W2) — the merge is field-wise.
  app.patch("/api/chat/sessions/:sessionId", async (req, res, next) => {
    try {
      const input = chatSessionsService.updateChatSessionRequestSchema.parse(req.body);
      const session = await chatSessionsService.updateChatSession(deps, { sessionId: req.params.sessionId, ...input });
      res.json({ session });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // Append one-or-more turns; the server stamps `ts` and back-fills the auto title.
  app.post("/api/chat/sessions/:sessionId/messages", async (req, res, next) => {
    try {
      const input = chatSessionsService.appendChatMessagesRequestSchema.parse(req.body);
      const session = await chatSessionsService.appendChatMessages(deps, { sessionId: req.params.sessionId, ...input });
      res.json({ session });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  app.delete("/api/chat/sessions/:sessionId", async (req, res, next) => {
    try {
      await chatSessionsService.deleteChatSession(deps, { sessionId: req.params.sessionId });
      res.json({ ok: true });
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });
}
