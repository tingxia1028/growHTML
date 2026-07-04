# AI Workspace — sessions · file+note attachments · document synthesis

A Claude-workspace-shaped feature: a chat that maintains a **session list**, takes **dragged-in
files (with their notes)** as context, and can **synthesize a new document** (markdown, headings =
its table of contents). The *same* chat panel powers both the main workspace chat and a new
left-sidebar workspace page — so the existing chat gains sessions too. Visual language stays
`design.md`; only the layout/interaction borrows the Claude client shape.

Grounded in the tree on `codex/ai-study-vault-rework` (file:line below are real). Companion to
`architecture-review.md` (this is largely an **F1 slice**) and `roadmap.md` (sequenced as W1–W3).

---

## 0. Shipped substrate (what this builds on — read the code, not this summary)
- **Chat routes exist:** `/api/chat` (`app.ts:1487`) + streaming `/api/chat/stream` (SSE, `app.ts:1501`) over the `ModelProvider` abstraction (`src/ai/provider.ts:63-80`; claude-pty/cli/mock via `STUDY_VAULT_AI_PROVIDER`). Structured JSON generation with a re-prompt loop: `/api/kits/generate` → `src/ai/structured.ts:61-96`.
- **Chat context is SINGLE-anchor:** `ChatContext` carries one source's `{sourceTitle, sourceType, location, quote, contextBefore/After}` (`provider.ts:19-30`), assembled in `buildChatContext()` (`WorkspaceContext.tsx:922-943`). **No multi-file path.**
- **Chat has NO sessions:** `chatMessages` is a single ephemeral `useState<ChatMessage[]>([])` (`WorkspaceContext.tsx:516`), **cleared on every source switch** (`:772`). No persistence, no ids, no list.
- **The chat panel is inline, not a component:** `StudyView` (`views.tsx:337`) renders the whole chat (log + `GenerationPreview` + composer) inline, pulling ~18 ctx fields; only `ChatMessageBody.tsx` is extracted. (The file even notes it is "kept-as-one".)
- **Source creation from raw content EXISTS:** `ingestSource({title, content, sourceType})` writes html/**markdown** sources to the vault (`src/core/store/sources.ts:64-91`); `/api/sources/html` (`app.ts:421`) is the wired entry. 9 source kinds incl. `markdown` (`src/core/schema/source.ts:4-14`). **Not yet wired to AI output.**
- **Source + notes** is two calls today: the source load + `GET /api/sources/:id/notes` (`app.ts:791-804`, includes sealed). Layer-level bundling exists (`buildStudyPack`, `studyLayer.ts:98-153`) but is layer-scoped, not source/multi-source.
- **Library has folders + recency, no multi-select:** `folderRoots` (physical paths, localStorage, `WorkspaceContext.tsx:207`); `RECENT_SOURCE_IDS_KEY` 40-item LRU, persisted (`:185-225`). Source list is single-select — one `activeSourceId`, no Ctrl/Shift-click (`views.tsx:180-207`).
- **TOC today = user bookmarks** grouped by category (`BookmarkIndex.tsx:39-241`); there is no auto-outline.

## 1. Locked decisions
1. **Session store = a `chatSession` vault entity** (not `workspace.json`). The uniform entity store makes this ~one line + a schema, it's durable, and it's the only option that can later sync across ends / export. Messages can be largish; local jsonl handles that fine.
2. **"Generate TOC" V1 = markdown headings.** Synthesis emits `#`/`##` structure; the reader derives the outline for free. Materializing clickable bookmark-TOC (reuse `BookmarkIndex`) is a V2 add-on, not V1.
3. **One `<ChatPanel session>` for both chats.** Extracting it from `StudyView` + moving chat state into a chat/session store **is an F1 down-payment** (decompose the `WorkspaceContext` god object). We do it here, deliberately, as the first F1 slice.

## 2. The model

### 2.1 `chatSession` vault entity (new)
```ts
// src/core/schema/chatSession.ts — recordEnvelopeSchema, id via createEntityId("chatSession")
chatSession = {
  id, type: "chatSession", schemaVersion, createdAt, updatedAt,
  title: string,                                   // auto from first msg, user-renamable
  messages: ChatMessage[],                         // reuse the existing ChatMessage type
  attachments: { sourceId: string; includeNotes: boolean }[],  // the session's context set
}
```
- Store = `createEntityStores` line + `/api/chat/sessions` CRUD (mirrors the concepts/operations routes; **land it as a `registerChatRoutes` module = an F2 slice**, not more `app.ts` bloat).
- The main workspace chat becomes "the session bound to the current context"; the sidebar workspace is a **list** of sessions over the same panel.

### 2.2 `<ChatPanel session>` (extracted, shared)
- Move the `StudyView` chat block into `ChatPanel.tsx`; its state (`messages`, `input`, `submit`, `regenerate`, `addReplyAsNote`, streaming status) moves into a **`useChatSession(sessionId)`** hook backed by the entity store. `StudyView` and the new `WorkspacePage` both render `<ChatPanel session={…}/>`.
- **This is the F1 slice**: `chatMessages` + ~6 chat methods leave the 79-field `WorkspaceContext`.

### 2.3 Multi-file context (extends single-anchor)
- Widen `ChatContext` (`provider.ts:19-30`) from one source to `sources: { sourceId, title, type, location, quote?, notes?: NoteDigest[] }[]`. `buildChatContext` gathers each attachment.
- **Attachment bundle** = source text (bounded) + its notes/anchors. New thin primitive `GET /api/sources/:id/bundle` → `{ source, anchors, notes }` (or reuse `buildStudyPack` adapted to a source). Notes are the compact, high-signal part; the source body is capped / "load-more" to stay within a **token budget (W2 decision)**.

### 2.4 Synthesis → a real new source (+ TOC)
- Synthesis command sends the assembled multi-file context + instruction → provider (`completeStructured` for a titled doc, or `complete` + markdown) → **`ingestSource({ sourceType:"markdown", title, content })`** → a first-class new source in the library (annotatable like any other). Wire it through `/api/sources/html`'s sibling (add `/api/sources/markdown` or reuse with a `sourceType` param).
- **TOC = the `#`/`##` headings** the model emits. No schema change.

### 2.5 Library: multi-select + Ctrl+C / Ctrl+V → attach
- Add `selectedSourceIds: Set<string>` + Ctrl/Shift-click + a per-item checkbox to the library list (`views.tsx:180-207`).
- **Ctrl+C** writes the selection to the clipboard under a private mime (`application/x-growte-sources`, ids only). **Ctrl+V inside `<ChatPanel>`** resolves that payload into `attachments` (with `includeNotes: true` by default). Drag-drop of a file onto the panel does the same.

### 2.6 The left-sidebar workspace page
- A new shell page/tab: **session list** (left) + `<ChatPanel>` (main) + an attachments strip. Default landing = **last-used folder** (fold folder id into the existing recency) → else first-opened folder → else recent sources. Pure layout in `design.md` tokens.

## 3. Phasing (each wave ships something usable)
- **W1 — sessions + one template. ✅ SHIPPED 2026-07-04 (W1-001).** `chatSession` entity (`src/core/schema/chatSession.ts`, `chat-sessions.jsonl` via `entityFileNames` — rides vault open + data-trust backup; kept OUT of `vaultEntitySchema` like memory/operation, conversations are private) + `registerChatRoutes` CRUD+append (`src/server/chatSessions.ts` over `services/chatSessions.ts` — the F2 slice) + the client session DOMAIN module `src/client/chat/` (`useChatSessionDomain` + `sessionClient` + `ChatSessionSwitcher`): the F1 slice landed as *state relocation* — `chatMessages` + the chat action seams left the WorkspaceContext internals into the domain; the god object gained exactly ONE field (`chatSessions`). Turn persistence: user msg on send (lazy session create, active source recorded as the §2.1 attachment ref), assistant msg on reply / on stream end via the new `onAssistantDone` command action; chunks are render-only. Resume: last session id in localStorage (explicit 新对话 = NONE sentinel); source switch no longer wipes the chat (§5 risk closed). **No AI change.** *Deviation:* the full `<ChatPanel>` component extraction out of `StudyView` (§2.2) is deferred to the W3 workspace-page wave — StudyView was contended-adjacent this round; the switcher mounts inside its title row instead.
- **W2 — attach + bundle + multi-select.** `/api/sources/:id/bundle`; drag/Ctrl+V file→attachment (with notes); library multi-select + Ctrl+C; widen `ChatContext` to `sources[]`; token-budget strategy.
- **W3 — synthesize → new doc.** Synthesis command → markdown source via `ingestSource`; headings = TOC; the left-sidebar workspace page + default-directory landing.

## 4. Foundation ties
- **W1 = the first F1 slice** (chat leaves the god object) and **an F2 slice** (`registerChatRoutes`). Pays down foundation debt while shipping a feature — exactly the roadmap's "fuse, don't defer" rule.
- **Decoupled from P-A1 (multi-doc):** a session's *attachments* are a lightweight context list, **not** open panes — so multi-file chat context ships **before** the single→multi `activeSourceId` refactor. No dependency on multi-doc.
- **Reuses** the render contract (§ notes render via `getNoteType`), the entity store, the provider abstraction, and `ingestSource`. Net-new surface area is small: one entity, one panel extraction, one bundle route, multi-select, one synthesis command.

## 5. Risks / open calls
- **Token budget (W2):** many attachments × (text + notes) can overflow context. V1 = notes in full + capped source slices + explicit "add more". Revisit summarization later.
- **Session ↔ active source coupling:** the main chat today clears on source switch (`:772`); with sessions it must instead *switch/attach*, not wipe. Migration: the first load seeds a default session from the current ephemeral messages.
- **Clipboard mime** for Ctrl+C/V must not clobber normal text copy — scope to the library-focused case, fall back to plain text elsewhere.

## 6. Tests
- Unit: `chatSession` schema + store CRUD; `useChatSession` reducer (append/regenerate/rename); `buildChatContext` over multiple attachments; multi-select set logic; clipboard encode/decode.
- Server: `/api/chat/sessions` CRUD + consistency; `/api/sources/:id/bundle` returns source+anchors+notes (incl. sealed read-only); synthesis → `ingestSource` creates a markdown source that then lists via the normal source routes.
- e2e: create a session → attach two files (notes ride along) → synthesize → a new doc appears in the library with a heading outline; Ctrl+C in library → Ctrl+V in chat attaches; the main chat and the sidebar chat share the panel + persist across reload.
