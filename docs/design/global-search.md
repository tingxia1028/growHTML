# Global Search — 全局搜索 / Cmd+K

> **Status: SEARCH-1 ✅ shipped 2026-07-04 (SEARCH-1-001).** Endpoint (`GET /api/search`
> in services + direct-transport parity) · Cmd/Ctrl+K palette (shell chrome, SC-0 idioms)
> · all three families (notes via `toSearchText`+anchor quotes / sources / navigation
> commands) · keyboard flow.
>
> **SEARCH-2 ✅ shipped 2026-07-04 (SEARCH-2-001).** Fuzzy tier (`RANK_FUZZY`, additive, below
> substring — Latin edit-distance + subsequence, CJK stays substring) · family/type/source/date
> filters (shared `parseSearchFilters`, transport parity, empty=SEARCH-1 byte-identical) + a
> bilingual family chip bar · localStorage recents in the empty state · **pinyin dependency-free**
> (reused `pinyin-pro` from SPEECH-3; 全拼+首字母 over CJK titles at `RANK_FUZZY`). The palette
> type/source/date filter UI is server-ready but ships family-only in V1 (type picker = follow-up).

Verified gap (2026-07-02): AI has `search_notes` (agentTools), readers have in-document find —
but the USER has no cross-vault search surface at all. Table stakes for a knowledge tool;
pain grows with every note. Grounded in what exists: `toSearchText` on every content spec,
SC-0's palette component + ranking engine, the services layer (X0a) for a search endpoint.

## 1. Shape: one Cmd+K surface, three result families
`Cmd/Ctrl+K` (and a topbar 搜索 affordance when TopBar frees) opens a palette (REUSE the SC-0
SlashPalette list/keyboard idiom, widened): query → grouped results —
- **笔记** (toSearchText match; contentType icon + title + source context; Enter opens the
  note's source focused on it — the focus mechanics exist for anchors)
- **文档** (title/metadata; Enter opens)
- **命令/视图** (the command registry + registered views — 打开复习/画像/设置… free navigation
  win, and `/` inside the palette = the slash composer's entries, one muscle memory)
Anchors surface through their notes (a bare anchor hit shows as its quote).

## 2. Engine
- Server: `GET /api/search?q=` in services (X0a idiom) — walks sources + notes via
  `toSearchText`, returns typed hits with context snippets; cap + rank (exact > prefix >
  substring > fuzzy-lite; recency tiebreak). CJK: plain substring is correct-enough V1
  (no tokenizer dep); pinyin/fuzzy = V2 with SC-3's pinyin work (shared table).
- Client: debounced palette query; direct-transport parity (mobile searches identically).
- Index: NONE for V1 — the vault fits in memory (linear scan with early-exit is fine at
  current scale; the services seam lets an index slot in later without API change). Honest
  perf gate: if scan > 50ms at real vault size, add an in-memory inverted map (still no dep).

## 3. Phasing
- **SEARCH-1 ✅ (2026-07-04, SEARCH-1-001):** endpoint + palette + notes/sources/commands
  families + keyboard flow. As built: pure rank core `src/core/search/rank.ts` (exact >
  prefix > word-boundary > substring; recency tiebreak; snippet) shared by the server
  engine (`src/server/services/search.ts`, cap 20/family, anchor quotes as note fields)
  and the client commands family; palette `src/client/search/` (GlobalSearchPalette +
  injected deps seam), mounted once in WorkspaceShell chrome — the hotkey lives in the
  palette component (one window listener via the single shell mount, no per-view wiring).
  Commands V1 = navigation targets only (navigateShell — 打开复习/画像/设置…, arg-free by
  construction); the "/"-passthrough to the slash composer's entries rides SC-1's mount.
  The Library header input stays a LOCAL section filter (seam comment updated in views.tsx).
- **SEARCH-2:** pinyin + fuzzy (SC-3 fusion) + per-type filters (`type:错题 浮力`) + recent
  searches (workspace prefs, field-group safe).

## 4. Tests
Rank order pinned; CJK substring; snippet extraction; empty/no-hit states; hotkey opens/closes
(jsdom); direct-transport parity; palette keyboard nav reuse (SC-0 tests as the model);
perf smoke on a seeded 1k-note vault.
