# Performance & Storage — the snapshot-store scaling plan

Status: **assessment + staged plan (2026-07-05).** Not a current fire — personal vaults are small
(ms-level ops). This is a KNOWN scaling ceiling with a clear, staged, non-rearchitecture path that
PRESERVES the portable JSONL vault. Build when telemetry/scale demands; S1 (in-memory cache) is a
clean proactive win.

## TL;DR
Every entity read/write is **O(total records)** with **no cache and no index**, and writes **rewrite
the whole file**. Fine to a few thousand records; the sharp edges are (a) write-amplification (every
note create rewrites the entire file) and (b) `memoryEvents`, the fastest-growing store. The fix is a
staged path — measure → in-memory cache → incremental append writes → in-memory indexes → prune raw
events — all keeping the on-disk format human-readable JSONL. Embedded SQL is the last resort because
it breaks the portable-JSONL design value (TRUST export/import, svpack, backups all depend on it).

## 1. The current model (code-grounded)
All entities use `createSnapshotStore` (`src/core/store/entities.ts:70-83` — sources, anchors, notes,
patches, concepts, relations, assets, layers, operations, triggers, chatSessions, memoryEvents).

`createSnapshotStore` (`src/core/store/snapshotStore.ts`) has **NO in-memory cache and NO index**.
Every `list()`/`get()`/`upsert()`/`delete()` calls `dedupe()` (:63-78):
1. `readJsonl(filePath)` (`jsonl.ts:16-55`) — reads the WHOLE file (`storage.readText`), splits lines,
   `JSON.parse` **+ zod `safeParse` on EVERY line**.
2. Builds a `Map` deduping by id (latest `updatedAt` wins) + sorts.

Writes are **full-file rewrites**: `upsert`/`delete` (:102-120) call `writeJsonlAtomic` (`jsonl.ts:57`)
which serializes ALL records and atomically replaces the file. `appendJsonlRecord` (`jsonl.ts:67`)
EXISTS but the store does NOT use it — so there is no append-log fast path today.

Consequences (measured in Big-O over N = records in that store's file):
- `get(id)` = **O(N)** (no index — full read+parse to find one record).
- `list()` = **O(N)** read+parse+dedupe+sort. A note query (`listNotes`, `notes.ts:138`) = `list()` +
  a JS `.filter()` — source-scoped queries ALSO load all then filter (the `matches` predicate).
- `upsert`/`delete` = **O(N)** read + **O(N)** write. N sequential writes ⇒ **O(N²)**.
- Per-line zod `safeParse` on every read is a real constant-factor cost.

This is a property of the WHOLE snapshot-store pattern, not of "vault-level notes" — and
`memoryEvents` (one record per captured action) is the fastest-growing store, ahead of notes.

## 2. Assessment: where it bites
| Scale (records in a store) | Behavior |
|---|---|
| hundreds – few thousand | ms-level. **No problem (current reality).** |
| ~10k | ~tens of ms per op; tolerable. |
| 50k–100k+ | hundreds of ms – 1s+; **every create rewrites 100k lines ⇒ visibly laggy.** |

Sharpest edges, in order:
1. **Write-amplification** — every single note/anchor/event create or edit rewrites the entire store
   file. This bites earliest under high write volume (bulk import, capture-heavy sessions).
2. **`memoryEvents` unbounded growth** — one record per action; over years this is the largest store.
3. **Read-per-op with per-line validation** — no cache means every list/get re-reads + re-validates.

## 3. Invariant (the line we hold)
The vault stays **human-readable JSONL on disk**. TRUST-3 export/import, svpack sharing, backup
rotation, and "your data is portable text you own" all depend on it. Every stage below keeps the
on-disk contract identical — caches/indexes are IN-MEMORY derived state. Only S5 (embedded SQL) would
change the on-disk format, which is why it is the explicit last resort.

## 4. Staged plan
- **S0 — Measure + budgets (cheap, anytime).** Add lightweight timing/size probes to the store
  (per-op ms + record counts, dev-only or behind a flag). Set budgets, e.g. "note `list()` < 50ms up
  to 20k notes", "note create < 30ms". Learn the real per-user distribution (expect `memoryEvents` to
  dominate). Optimize against numbers, not guesses.
- **S1 — In-memory cache (highest leverage, lowest risk; do FIRST / proactively).** Load each store
  once and keep the deduped Map in memory; serve `list()`/`get()` from memory; invalidate/patch the
  cache on `upsert`/`delete` (the store already serializes writes via `withLock`, :50-58, so cache
  maintenance is race-free). Turns read-per-op O(N) into O(1) amortized. Single-process server (Electron
  main / the mobile direct-transport), so one cache is coherent — no cross-process invalidation needed.
- **S2 — Incremental append writes + threshold compaction.** Replace full-file rewrite on `upsert`
  with `appendJsonlRecord` (append the new/updated record; `dedupe()`-on-read already keeps latest
  `updatedAt`, so an append log reads correctly). Compact (rewrite) only when dupes/tombstones exceed a
  threshold (e.g. >30% of lines). Kills write-amplification; the dedup-by-updatedAt design already
  supports reading an append log.
- **S3 — In-memory indexes on hot keys.** Alongside the S1 cache, maintain Maps by `sourceId`,
  `contentType`, `anchorId`, `conceptId`. Note queries become O(result) not O(all). This also closes a
  known gap: `GET /api/notes` ignores `?contentType=` today (`app.ts:697-708`, honors only
  conceptId/anchorId/sourceId) — every vault-level lens (report.list, mistake.book, a future calendar)
  loads all + filters client-side; an index (and a server-side contentType filter) makes those lenses
  O(their own type).
- **S4 — Bound `memoryEvents`.** Verify whether `consolidateMemory` already prunes raw events after
  digesting; if not, prune raw events older than the digest horizon (keep digests, drop raw). Bounds the
  fastest-growing store regardless of the above.
- **S5 — Embedded SQL (SQLite), LAST RESORT ONLY.** Only if S1–S3 are exhausted at real scale. Breaks
  the portable-JSONL invariant (§3) → would need an export/round-trip story. Avoid; prefer keeping JSONL
  as the source of truth with an optional derived index if ever needed.

## 5. Sequencing & triggers
1. **S0** now (cheap; gives the data to prioritize the rest).
2. **S1** proactively — it's a clean pure-win refactor, not scale-gated. Biggest bang.
3. **S2** when write-amplification shows in S0 telemetry (bulk import / capture-heavy users).
4. **S3** when a lens's load time crosses budget (or when the `?contentType=` gap needs closing for a
   heavy vault-level type).
5. **S4** when `memoryEvents` size crosses budget.
6. **S5** only if the above genuinely don't hold — expected to be never for personal-vault scale.

## 6. Related gaps (cross-refs)
- `GET /api/notes` contentType filter absence (§S3) — surfaced in REPORT-1 (the e2e read had to filter
  client-side); relevant to every vault-level (source-less) note lens.
- Vault-level (source-less) notes rely on per-kit lenses to be reachable (report.list, mistake.book, a
  future calendar) — see the note-anchoring model; the lens migration (2026-07-05) makes those lenses
  register-only kits. Their query pattern (`allNotes()` + client filter) is the direct beneficiary of
  S1/S3.

## 7. Mobile (Capacitor) — SAME pattern, WORSE constant factors, hits the ceiling earlier
Mobile Route A (core-logic-in-WebView + Capacitor-Filesystem vault, `x2a-build-spec.md`) runs the
**SAME** `createSnapshotStore` code, just with `CapacitorStorage` instead of `nodeStorage` behind the
`StorageAdapter` seam. So the O(N)-per-op algorithm is identical — but three things make each op more
expensive on a phone, so mobile crosses the "laggy" line at a LOWER N than desktop:
1. **Native-bridge overhead** — Capacitor FS `readFile`/`writeFile` cross the JS↔native bridge every
   call; reading/writing a whole store file is bridge-bound, not direct-syscall like Node.
2. **Weaker CPU** — the per-line `JSON.parse` + zod `safeParse` (`jsonl.ts:29-52`) runs on a phone core
   and in a mobile WebView JS engine (slower than desktop Chromium).
3. **No true atomic append** — on Capacitor FS, `writeTextAtomic` is emulated (write-temp + rename) and
   `appendText` is **read+concat+write** (`x2a-build-spec.md:26`). So **every write is O(N) on mobile**,
   and the S2 "append fast path" does NOT help here — appending is itself a full read+rewrite.

**What this changes for the plan on mobile:**
- **S1 (in-memory cache) matters MORE — it's the #1 mobile mitigation.** It turns bridge-slow reads into
  in-WebView memory reads. Because the cache lives ABOVE the `StorageAdapter` (inside `snapshotStore`),
  fixing it once benefits BOTH desktop and mobile — and mobile benefits more.
- **Write strategy differs: batch/debounce/flush-on-idle, not "cheap append."** Since every disk write
  is an O(N) full rewrite over the bridge (no atomic append), the mobile fix is to WRITE LESS OFTEN —
  keep the working set in the S1 cache and flush to disk on a debounce / on idle / on background, so a
  burst of captures is one rewrite, not N. (Desktop can additionally use S2 append; mobile relies on
  batching.)
- **S4 (bound `memoryEvents`) matters more** — smaller mobile storage budget + slower ops + WebView
  memory pressure if the whole event log is cached.

**Realistic verdict:** for a realistic phone vault (a student's data — hundreds of docs, low-thousands
of notes) WITH S1 cache + write-batching, mobile is fine. Shipping the NAIVE current pattern
(read+rewrite the whole file per op, over the bridge) to mobile UNCHANGED would feel sluggish at a lower
N than desktop, and capture-heavy sessions (each write a full rewrite) are the first thing to bite. So:
mobile is OK **provided S1 + write-batching are part of the mobile track** — and the `StorageAdapter`
seam already isolates the backend, so the cache/batching go in the shared `snapshotStore`, not in
mobile-specific code. (Mobile track is currently PAUSED; fold this into x2a when it resumes.)

## 8. "Open a document" read path + the no-streaming question
- **Opening one document READS the whole note+anchor store (server-side), but RENDERS only that
  source's few notes.** `GET /api/sources/:id/notes` → `listNotes` (`notes.ts:138`) calls
  `stores.notes.list()` — a FULL read+parse of the ENTIRE `notes.jsonl` (all notes across all documents)
  — THEN `.filter(note.sourceId === sourceId)`. Same for `stores.anchors.list()`. So a single document
  open does O(total notes) + O(total anchors) of work to return that source's (typically tens of) notes.
  You do NOT render all notes; you READ all of them to filter down. This is the O(N) tax made concrete,
  paid on EVERY document open.
- **No pagination, no streaming.** `ListNotesInput` has no limit/offset/cursor; the endpoint returns the
  full filtered array in one JSON response. That's fine at the payload level — one document's notes are
  few — so streaming the RESULT would buy nothing. The cost is the full-store READ, not the payload.
- **Streaming/pagination is the WRONG fix for per-document reads; S1 (cache) is the RIGHT one.** With an
  in-memory cache, opening a document filters the in-memory Map → O(that source's notes), not O(all).
  Pagination/streaming only becomes relevant for a **vault-level lens** (report.list, a calendar, "all
  notes of type X") IF a single type grows to thousands — then a cursor + the S3 index on that lens, not
  the reader. Net: fix the read amplification with S1/S3 (cache + index), not by streaming per-doc notes.

## 9. On-disk LAYOUT (per-document bundles) vs the QUERY index — separate axes, they compose
The pain is real (§8): opening one document reads ALL notes. A natural fix is to PARTITION storage
per-document — each source gets its own note file + asset folder (a self-contained bundle). This is a
GOOD idea, but it solves a DIFFERENT axis than perf, and the two compose:
- **What per-document bundles fix**: per-doc read locality (open a doc → read only its file), single-note
  write locality (rewrite a small per-doc file, not the global one), and — the STRONGEST argument —
  EXPORT / PORTABILITY / SHARING: a `<doc>/{notes,assets}/` folder is a self-contained movable unit
  (aligns with svpack sharing + TRUST export — "hand someone a document WITH its annotations + images").
- **What per-document bundles do NOT fix (and slightly HURT)**: the CROSS-cutting lenses — 错题本, the
  review queue (all DUE notes across all docs), report assembly, the concept graph (relations span docs),
  global search. These need ALL notes across ALL docs; with per-doc files they now read MANY files + merge
  — worse for exactly the lenses we just made cross-source kits (2026-07-05).
- **What fixes BOTH**: an in-memory INDEX (S1 cache + S3 indexes) ABOVE the file layout. Load once, index
  by sourceId + contentType + due/layer. Per-doc open = index lookup by sourceId; cross-cutting = index
  lookup by contentType/due — both O(result). Because queries go through the index, the on-disk layout
  (one global file OR per-doc bundles) becomes a **portability/locality** choice, NOT a query-perf choice.

**Recommendation (order matters):**
1. **S1 index/cache FIRST** — small, localized, low-risk; gets ~all the perf win (per-doc AND cross-cutting
   fast) WITHOUT re-layouting storage. The 80/20.
2. **Per-document bundles LATER, motivated by EXPORT/PORTABILITY/SHARING (not perf)** — the cache already
   fixed perf, so this is a portability play. BIG migration (every store consumer, the transport,
   migrations, TRUST export/import, svpack, the sealed runtime), so do it when the "move/share a
   self-contained document bundle" use case is prioritized — keeping the in-memory index on top.

**Two caveats on the layout:**
- **Vault-level (source-less) notes** (reports, a future calendar) have no doc folder → they need a
  `_vault/` bucket. So the layout is per-doc bundles + one vault-level bucket, not purely per-doc.
- **Layers as folders — NO.** A note has ONE `sourceId` (fits a folder tree) but MULTIPLE `layerIds` (a
  note can be in several layers — many-to-many). Folders are a tree; layer membership is a matrix, so
  layers-as-folders forces duplication/symlinks. Keep layers as a FIELD (the current `layerIds`) filtered
  in the index; docs-as-folders is the natural hierarchy, layers-as-tags the natural cross-cut.

## Backlog
- **PERF-0**: store timing/size probes + budgets (S0).
- **PERF-1**: snapshot-store in-memory cache (S1) — proactive, highest leverage.
- **PERF-2/3/4**: incremental append writes, hot-key indexes (+ server contentType filter), memoryEvents
  pruning — telemetry-gated.
