# SQLite migration — BUILD SPEC (SQLite runtime + JSONL lossless export)

Status: **Review-final (2026-07-05).** Decision recorded in `docs/design/perf-and-storage.md` (DECISION
2026-07-05). Grounded in a code spike + a prior-art survey + an ADVERSARIAL REVIEW (verdict
APPROVE-WITH-CHANGES — its 5 blocking fixes are folded in below; see "Review corrections" at the end for
the record). Multi-week foundational migration — staged, desktop-first, mobile-binding deferred with the
PAUSED mobile track. Every stage guarded (guard set in §Guards, corrected per the review).

## The seam (verified signatures — the review corrected my remembered ones)
- **A new `StoreEngine` seam ABOVE `StorageAdapter`**, at the entity-store factory. A DB is NOT a bag of
  bytes — do NOT re-back SQLite through `StorageAdapter.readText/writeTextAtomic`.
- **Real signatures to thread** (verified): `createEntityStores(studyDir: string, storage = nodeStorage)`
  (`entities.ts:68`) gains an `engine` (or `driver`) param; the thread is
  `StartServerOptions` → `openVault({rootDir, name, storage})` (`vault.ts:82,110`) → `createEntityStores`.
  `createApp`/`createDirectTransport` receive the already-built `vault` → NO change. Both `jsonlEngine`
  (today's `createSnapshotStore` body, extracted unchanged) and `sqliteEngine` implement the SAME 8-method
  `SnapshotStore<T>` interface (`snapshotStore.ts:18-32`). Business-logic blast radius ≈ 0 — the review
  re-verified ~246 consumer call-sites, none rely on object identity or mutate-in-place; all `await`.
- **Transactions are OWNED BY THE ENGINE METHOD, never a leaked primitive (review #5, design-critical).**
  `better-sqlite3` transactions are SYNC (`db.transaction(fn)()`); `@capacitor-community/sqlite` are ASYNC
  (bridge). So the interface must NOT expose `transaction()`. `engine.upsert(record)` promises "write the
  row AND its junction rows atomically" and implements the transaction INTERNALLY (sync on desktop, async
  on mobile). This is the one place the deferred mobile driver constrains today's interface — pin it now.
- `StorageAdapter` STAYS the file backend for everything legitimately a file: sources HTML, assets, sealed
  `.svsealed` blobs, publish-ledger JSON, the sidecar JSON docs (`review-schedule.json`, `memory-*.json`,
  `trigger-fires.json`, `plugin-settings.json`, workspace prefs). NOT entity stores — leave them.

## Binding (review B5 — recommendation FLIPPED to better-sqlite3; add a go/no-go spike)
- **Recommend `better-sqlite3` for desktop** (native, synchronous, mainstream). NOT option (b)
  `@capacitor-community/sqlite`-everywhere: (b)'s Electron impl uses `better-sqlite3-multiple-ciphers`
  under the hood (same native binding) + extra deps — it buys the DEFERRED mobile driver at a desktop cost
  paid NOW; backwards for a desktop-first migration.
- **Do NOT use `node:sqlite`** — confirmed Release Candidate (Stability 1.2) through Node 26.x as of 2026;
  unsafe for a foundational store + lags Electron's bundled Node.
- **✅ Stage-0 GO/NO-GO SPIKE — DONE, verdict GO (2026-07-05).** `better-sqlite3@12.11.1` verified on BOTH
  ABIs on this machine: Node 22.17.1 (`npm rebuild better-sqlite3` → loads under node/vitest) AND Electron
  42.4.1 (`@electron/rebuild -o better-sqlite3` → "✔ Rebuild Complete"). The two overwrite the same `.node`
  (expected — identical to the existing node-pty operational model): `npm rebuild` for tests/dev, the
  extended `electron:rebuild` for packaging. FTS5 IS compiled in (virtual-table + `match` smoke passed) and
  WAL/transactions work. The round-1/2 "Electron 39+ won't build" risk did NOT materialize. Driver = option
  (a) `better-sqlite3`, confirmed.
- **✅ Build-config changes DONE:** `--external:better-sqlite3` added to `electron:build:main` (so the
  Electron-main esbuild bundle doesn't try to bundle the native `.node`); `-w better-sqlite3` added to
  `electron:rebuild`. `better-sqlite3` in `dependencies`, `@types/better-sqlite3` in `devDependencies`.
  Vitest (Node ABI) confirmed loading it.

## Schema (json blob + extracted index columns — note schema UNCHANGED, stored as blob)
The full record is a `json` blob (so the zod schemas never need a table migration); envelope/index columns
are DERIVED on write:
```
notes(id PK, updatedAt, deletedAt NULL, sourceId NULL, contentType, json)   -- status dropped as a column (N2)
   INDEX notes_source  ON (sourceId)    WHERE deletedAt IS NULL
   INDEX notes_type    ON (contentType) WHERE deletedAt IS NULL   -- closes the ?contentType= gap (§S3)
   INDEX notes_updated ON (updatedAt)
note_anchors(noteId, anchorId)   INDEX(anchorId)    -- many-to-many (note.anchorIds[], queried .includes())
note_concepts(noteId, conceptId) INDEX(conceptId)   -- many-to-many (note.conceptIds[])
note_layers(noteId, layerId)     INDEX(layerId)     -- many-to-many (note.layerIds[]) — id-match ONLY (N5)
anchors(id PK, updatedAt, deletedAt NULL, sourceId, anchorKind, json)   -- studyId etc. are kind-specific (N1)
   INDEX anchors_source ON (sourceId) WHERE deletedAt IS NULL
memoryEvents(id PK, createdAt, updatedAt, verb, sessionId NULL, json)
sources/concepts/relations/assets/layers/operations/triggers/chatSessions/patches:
   id PK + updatedAt + deletedAt + json + entity-specific FK columns as needed
```
Invariant mapping (must match `snapshotStore.ts` EXACTLY):
- **Soft-delete**: `list()` = `WHERE deletedAt IS NULL`; `listTrashed()` = `WHERE deletedAt IS NOT NULL`;
  `getAny()` = no filter; `get()` = by id AND `deletedAt IS NULL`. Partial indexes keep live queries fast.
- **Dedupe-by-latest-updatedAt DISAPPEARS** — `id` is a real PK; `upsert` = `INSERT … ON CONFLICT(id) DO
  UPDATE` (review confirmed no consumer depends on the dedupe quirk).
- **Junctions written atomically INSIDE `engine.upsert`** (delete-all-then-insert the child rows in the
  same transaction). **A soft-delete (upsert WITH `deletedAt`) KEEPS the junction rows** so restore
  resurrects the note↔anchor/concept/layer links (review B4 — this was undefined; PIN it: junctions
  persist through the tombstone, are only removed on a real `delete()` purge).
- **`readWithIssues()`**: rows already valid → `{records: all-incl-tombstones, issues: []}`.
- **Sealed-snapshot merge**: UNCHANGED, UNTOUCHED — sealed never enters the DB; `listNotes` merges
  `[...dbNotes, ...sealed.snapshot().notes]` in the SERVICE (`notes.ts:147-149`), engine-agnostic.
- **Layer-visibility (`notes.ts:238-255`): KEEP IN JS.** A note is visible iff `layerIds ∩ enabled ≠ ∅`
  OR `layerIds` is empty (empty = always visible). The empty-case means a `note_layers` JOIN can NEVER
  fully replace the JS filter (N5) — the junction is an id-match optimization only, not the visibility rule.
- **N1**: `anchorSchema` is a `discriminatedUnion` — `studyId`/`selector` (html_selection), `page`/`rect`
  (pdf), `filePath`/`startLine` (code) are kind-specific → their extracted columns are NULLABLE; the JSON
  blob is the only complete record. Never make them NOT NULL.
- **N2**: `note.status` = `z.literal("draft").optional()` — almost always absent → NOT a useful index
  column (dropped). Legacy `note.layerId`/`anchor.layerId` (singular, deprecated) still exist and MUST
  round-trip losslessly in the blob — the round-trip test carries one.
- **N3**: `concept.aliases`/`tags` are arrays but NO consumer filters by membership (verified) → they stay
  in the blob, NO junction. (Documented so nobody "helpfully" adds one.)

## Staged build (each stage: tsc 0 · full vitest green · the corrected guard set green)
**Stage 0 — go/no-go + (owner-pending) safety net.**
- The `better-sqlite3` Electron-42 prebuild spike (above) — GATE.
- **(Owner decision pending, review #6 strong-rec):** ship a minimal **S1 in-memory read-cache inside the
  existing JSONL `createSnapshotStore`** FIRST (1-2 days, pure win, localized, `withLock` already
  serializes writes) as insurance — if the multi-week SQLite migration stalls, read-amplification is
  already killed and it's the #1 mobile mitigation too. Retired with the JSONL engine when SQLite lands.
  Skipped only if the owner insists on zero interim code.

**Stage 1 — `sqliteEngine` behind the 8-method interface (desktop, better-sqlite3).**
- New `src/core/store/engine.ts` (`StoreEngine` type) + `src/core/store/sqliteEngine.ts` (schema bootstrap
  + the 8 methods + junction handling + engine-owned transactions). `jsonlEngine` = today's body extracted.
- Thread `engine` through the corrected signatures; DEFAULT stays `jsonlEngine` (no behavior change yet).
- Add the esbuild `--external` + `electron-rebuild -w` build-config changes.
- **GUARD (the REAL invariant guard — review B4): parameterize `snapshotStore.test.ts` over BOTH engines**
  (it already covers trash/tombstone/compaction/concurrent-upsert, `:65-135`). Add a **junction-integrity
  test**: upsert a note with anchor/concept/layer ids → soft-delete → restore → assert junction rows
  survive the tombstone and `listNotes`-by-anchor/concept/layer are correct at each step. Re-parameterize
  `directTransport.test.ts` to run one side over `sqliteEngine`. Full suite green (baseline 271f/2743t).
- **✅ LANDED (2026-07-05).** New `engine.ts` (`StoreEngine`/`StoreConfig`/`ExtractedColumn`/`JunctionSpec`),
  `jsonlEngine.ts` (today's body extracted verbatim), `sqliteEngine.ts` (generic backend + notes junctions).
  Seam shape = per-entity backend factory `<T>(config) => SnapshotStore<T>`; `createSnapshotStore` is now a
  one-line delegator (`input.engine ?? jsonlEngine`); `createEntityStores(studyDir, storage, engine=jsonlEngine)`
  carries per-entity sqlite config. Default = jsonl → app behavior unchanged. Build-config was already in place
  from Stage-0. **Adversarial CODE review (APPROVE-WITH-FIXES, 0 blocking; FK-cascade/junction-atomicity/
  soft-delete-survival/NULL/blob-fidelity/DDL empirically probed CLEAN). FOLDED this slice:** S1 — sqlite read
  paths now `schema.safeParse` every blob (parity with jsonl's readJsonl: invalid rows dropped from `records` +
  reported in `issues`; single-row reads → null) so the corruption/schema-drift detection isn't lost; a
  `config.sort` guard (throws — a JS comparator can't be pushed into `ORDER BY`, no entity uses one); explicit
  `COLLATE BINARY` on the order-by + comment (jsonl's `localeCompare` vs sqlite BINARY agree only for the
  ULID/ASCII id charset — made intentional); `deletedAt=""` + stale-comment nits. Guards: parameterized
  snapshotStore.test over both engines + junction-integrity + a new sqlite blob-validation test. tsc 0 · full
  vitest **272f/2769t** · build ✓.

**Stage 2 — JSONL is the source of truth IN THE PACK; import REBUILDS the `.db` (review R2 — FLIPPED).**
- **KEEP the verbatim whole-dir zip/swap architecture** (`dataTrust.ts` `walkVaultFiles`/`streamVaultZip`
  export + `doReplaceFromZip` two-rename swap). Non-entity files (HTML sources/assets/sealed blobs/
  sidecars) ride the walk unchanged. **My earlier "dump only entity tables to JSONL" plan was WRONG — it
  would drop every non-entity file (catastrophic loss).**
- **Source-of-truth: JSONL, NOT `.db` (round-2 decisive correction).** The `.db` is the RUNTIME truth, but
  IN THE PACK the `*.jsonl` dumps are authoritative and the `.db` rides ONLY as an optional fast-path cache
  that import MAY ignore. Rationale: a backup must be restorable as portable text even if the `.db` is
  corrupt / a future SQLite file-format bump / an unopenable schema — otherwise "portable text you own" is
  a derived, never-validated copy. This is ALSO smaller: the existing import already validates jsonl
  line-by-line (`validateVaultZip:325-343`), and that guard is meaningless against an opaque `.db` blob.
- What actually changes:
  1. **Export dumps `.db → *.jsonl`** (schema-COMPLETE/lossless — Logseq lesson) into the vault dir, then
     the existing walk zips the dir (jsonl + non-entity files + optionally the `.db` cache) verbatim.
  2. **WAL safety:** before dumping/walking, `PRAGMA wal_checkpoint(TRUNCATE)` + quiesce writes so the
     `.db` (if carried) is self-consistent. `walkVaultFiles` skips only `*.tmp` (`:195`) — it would happily
     zip a torn `-wal`; either checkpoint first or add `-wal`/`-shm` to the walk.
  3. **Import loads jsonl → staging → swap dir → REBUILD `.db` from jsonl on next open** (reuse the Stage-3
     `.jsonl→.db` builder). Manifest **counts STAY jsonl-line-counts** — NO `countVaultEntities`/validation
     change needed (a simplification the flip buys back vs the round-1 "counts→rows" plan).
  4. Two-rename rollback (`:564-573`) STAYS valid (swaps the DIR).
- **GUARD (updated):** the whole-vault round-trip must assert the REBUILT `.db` is QUERYABLE (junctions +
  FTS re-derived), not just that files survived.
- **GUARD:** a WHOLE-VAULT round-trip test (export→import a vault WITH sources/assets/sealed packs/sidecars
  → assert every non-entity file survives — the B1 loss guard) + a dump→load deep-equal per entity incl
  tombstones AND a note/anchor carrying the legacy `layerId` (N2) + the existing TRUST export/import e2e.

**Stage 3 — flip the default engine + one-time `.jsonl → .db` migration (review B3 — trigger fixed).**
- Trigger keys off **non-empty jsonl content OR a `manifest.json` migration-complete marker** — NOT file
  presence (`openVault` pre-creates empty jsonl every boot, `vault.ts:97-99`, so "present" is always true).
  Follow the `migrateStudyLayers(vault)` boot idiom (`start.ts:57`): idempotent, boot-time, marker-guarded;
  ensure the migration runs before/around `openVault`'s empty-file creation so it doesn't clobber real data.
  Keep the `.jsonl` as a backup for one release. Flip `createEntityStores` default to `sqliteEngine`.
- **MUST FOLD HERE (Stage-1 adversarial-review carry-overs — latent while jsonl is default, they BITE the
  moment this flip lands):**
  - **S2 — dispose path.** `StudyVault` has no `close()`; `createEntityStores` builds 12 stores and
    `closeSqliteStore` is called only from tests. Once sqlite is default, every `openVault`/test-vault leaks
    12 DB + WAL handles and Windows `EBUSY`-on-unlink bites e2e/dir-cleanup. Add `StudyVault.close()` that
    iterates `stores` → `closeSqliteStore`, wire it to server shutdown / vault teardown. **Decouple
    `closeSqliteStore` + the `CLOSE` symbol out of `sqliteEngine.ts` into `engine.ts` FIRST** (it needs no
    `better-sqlite3` import — `Symbol.for` is registry-global), so `vault.ts` importing it does NOT eager-load
    the native module on the jsonl path (an ABI-mismatch footgun for jsonl-only users).
  - **N-d — spec/code name alignment.** Junction owner column shipped as generic `ownerId` (spec said
    `noteId`); anchors extract only `sourceId` (spec listed an `anchorKind` column too). Both are internal
    (full record in the blob) — reconcile the §Schema text with the code, no behavior change.
- **GUARD:** a migration test (seed a NON-EMPTY jsonl vault → boot → assert every entity present +
  queryable + junctions built) + idempotency (run twice = no-op) + full suite + all e2e.

**Stage S5 — FTS (completes single-machine perf; desktop track). Smaller than it looks — the extractor exists.**
- The per-`contentType` searchable-text extractor ALREADY EXISTS: `NoteContentSpec.toSearchText(content)`
  (`core/notes/contentTypes.ts:17`, a registry contract; every note type implements it), used today by
  `server/services/search.ts:148-190`. S5 does NOT build one.
- **FTS row is JS-extracted in `engine.upsert`, NOT SQL triggers** (the blob is opaque to SQL — triggers
  can't run `toSearchText`). Compute the FTS text in JS at write time inside the engine-owned transaction.
- **MUST include ANCHOR QUOTES, not just note text + source title** — today's search indexes
  `[toSearchText(content), ...note.anchorIds.map(quoteByAnchorId)]` (`search.ts:190`); omitting quotes
  regresses quote-hit recall. Denormalize quotes into the note's FTS doc at write time; editing an anchor
  quote must refresh the FTS rows of every note referencing it (write-amplification — accept/note it).
- Repoint Cmd+K global search (notes + sources; **commands are client-side, NOT a gap**) at FTS5 for
  candidate FILTERING; the existing tiered ranker + **pinyin/CJK romanization tier** (`core/search/rank.ts`,
  `pinyin.ts`) still SCORES the candidates (FTS5 `bm25()` has no pinyin tier — a straight swap would
  regress CJK romanized queries, a first-class feature). "Ranking MATH stays in code" (Anki precedent).
- **Mobile caveat**: verify the `SQLITE_ENABLE_FTS5` compile-option on the capacitor driver when the mobile
  track resumes (SQLCipher builds sometimes omit it); fall back to the in-memory scan if absent.
- GUARD: a search test (seed → query → FTS hits match the old scan) run through BOTH the Express route AND
  `directTransport` (else mobile search diverges) + full suite.

**Stage S6 — `sync_ops` multi-device sync (same account). DEFERRED — needs its OWN spike AND an account subsystem.**
- **HARD DEPENDENCY the earlier draft missed: there is NO vault-level account/identity.** Only a walled-off
  billing gateway (`userId` = phone-derived credits key that never touches the vault) + local crypto keys
  (device key = at-rest encryption, publisher key = signing). The roadmap itself files "real sync =
  accounts" as UNBUILT (`multi-platform.md:65`); the Account menu item is hardcoded `disabled`. So S6 is
  blocked on building an identity subsystem, not just "a design pass."
- **Do NOT add the sync-aware change-marker column NOW (round-2 correction).** `updatedAt` is a wall-clock
  ISO string — NOT a skew-safe monotonic marker (slow-clock device → its edit looks older → silently
  dropped). Adding a real marker (HLC or per-device `usn`) later is an `ALTER TABLE ADD COLUMN` + backfill
  from the existing blob, handled idempotently by the Stage-3 boot-migration idiom → **NO second migration**.
  So defer the marker to S6 (when the spike picks HLC-vs-usn); don't freeze the wrong one now. Tombstones
  already exist (`deletedAt`). The marker is maintained in `engine.upsert` (the single write chokepoint).
- **`sync_ops` MUST be separate from `memoryEvents`** (which looks like an oplog but isn't usable): memory
  events are PRIVACY-excluded from export (pinned by a guard test, `schema/memory.ts:44-48`) and are PRUNED
  past a horizon (`consolidateMemory`) — a synced/pruned private-behavior log is both a leak and an
  unreliable cursor source.
- **`.svsealed` is OUT of sync scope** — device-key-encrypted, outside the entity stores; device B can't
  decrypt device A's sealed blob → cross-device sealed availability is a separate re-import/re-key problem.
- **Merge model (round-2 decisive): per-row LWW is UNSAFE for the note blob** — `anchorIds/conceptIds/
  layerIds` are arrays WELDED INTO the note JSON blob (`schema/note.ts:26-27,66`); the junction tables are
  derived projections, not independent rows. A whole-blob LWW overwrite loses a concurrently-added anchor.
  S6 needs **array-union + scalar-LWW merge** (app-level 3-way), NOT simple LWW. CRDT (Yjs/Automerge/
  cr-sqlite) only if real-time collab becomes first-class. Plus the server half (managed endpoint vs BYO
  cloud folder). Pairs with the MOBILE track = the "multi-device phase" after desktop.

**Stage 4 — mobile native binding. DEFERRED with the PAUSED mobile track.**
- Driver → `@capacitor-community/sqlite` native (its async transactions are why `engine.upsert` owns the
  tx internally — §seam). Interacts with X2 Route-A (core-in-WebView wants a native store) — a mobile-arch
  decision to make WITH the track. The engine abstraction keeps this ≈0 extra cost today.

## Guards (the corrected set — review B4; NOT `directTransport` alone)
1. `snapshotStore.test.ts` parameterized over BOTH engines — the REAL invariant guard (trash/tombstone/
   junction/concurrent-upsert). 2. Junction-integrity (soft-delete→restore keeps links). 3. Trash-surface
   parity (list/get/restore/purge — the `trash.ts` routes, untested in directTransport today). 4. Whole-
   vault round-trip (B1 loss guard) + dump/load deep-equal incl tombstones + legacy `layerId`. 5. Migration
   idempotency. All + tsc 0 + full vitest + `npm run build` + relevant e2e, EVERY stage.

## Blast radius
- TOUCH: `snapshotStore.ts` (split → engine + jsonlEngine), new `engine.ts`/`sqliteEngine.ts`,
  `entities.ts`/`vault.ts`/`start.ts` (thread engine via the real signatures), `dataTrust.ts` (Stage 2 —
  WAL checkpoint + `.db` in the walk + row counts + derived jsonl dump), `package.json` (dep + esbuild
  `--external` + `electron:rebuild -w`), plus `manifest.json` migration marker (Stage 3).
- LEAVE (engine-agnostic, above/beside the store): every `src/server/services/*` consumer, the sealed
  merge, svpack publish/portable (reads through `vault.stores.*`, emits its own schema — verified),
  `sourceAuthoring.ts` raw `fs` (legit publish-ledger, not an entity store), the sidecar JSON docs, the
  layer-visibility JS filter.
- CODEX-owned files (styles.css, SlashPalette.tsx, workspace/anchorViews.*, workspace/actionIcons.ts,
  FileTree.tsx): NOT in scope.

## Risks (review-updated)
1. **[Highest] Stage 2 `dataTrust.ts`** — data-safety code; the WAL-checkpoint + `.db`-in-walk + row-count
   changes must not drop non-entity files or zip a torn `-wal`. The whole-vault round-trip test is the guard.
2. **Lossless JSONL dump** — every field (incl legacy `layerId`, optional fields, tombstones) must round-trip.
3. **Junction transactional consistency** — atomic inside `engine.upsert`; soft-delete keeps junctions.
4. **better-sqlite3 on Electron 42** — the Stage-0 prebuild spike is go/no-go; may need from-source CI compile.
5. **Migration idempotency + openVault empty-file clobber** — marker-guarded, runs around empty-file creation.
6. **mem_created index has NO consumer through the 8-method interface (N4)** — realizing it needs a range/
   prune method = an interface-widening PERF FOLLOW-UP, not part of the parity-guaranteed migration. Drop it
   from Stage-1 scope; revisit as a separate task.

## Review corrections (for the record — folded in above)
Adversarial review verdict APPROVE-WITH-CHANGES. Blocking fixed: B1 (Stage 2 is verbatim dir-zip, not
per-store jsonl — preserve the dir, `.db` rides it, WAL-checkpoint); B2 (real signatures + thread);
B3 (migration trigger = non-empty content/marker + `migrateStudyLayers` idiom); B4 (guard set: parameterize
`snapshotStore.test.ts` over both engines + junction/trash/whole-vault round-trip, NOT directTransport
alone); B5 (recommend better-sqlite3 not (b), Electron-42 go/no-go spike, esbuild/rebuild config). Design:
#5 (engine owns the transaction; interface never exposes `transaction()`). Non-blocking N1-N5 documented in
§Schema. #6 (S1 cache-first safety net) → Stage-0, owner decision pending. Validated-correct by the review:
the 8-method seam is clean (~246 call-sites, no identity/mutate-in-place deps), svpack/sealed merge is
engine-agnostic, `node:sqlite`-is-RC rejection, dedupe-by-updatedAt quirk safely disappears with a real PK.

**Round 2 (verdict APPROVE-WITH-CHANGES; verified round-1 folded correctly; attacked the new FTS/sync).**
Folded above: Stage 2 source-of-truth FLIPPED to JSONL (rebuild `.db` on import — safer + smaller);
S5 FTS is JS-extracted in `engine.upsert` (blob opaque to triggers), reuses the existing `toSearchText`
extractor, MUST include anchor quotes, and keeps the pinyin ranker (FTS does filtering only); S6 LWW is
UNSAFE for the welded note blob → array-union + scalar-LWW merge; S6 blocked on a MISSING account/identity
subsystem; the sync-aware marker is DEFERRED (not added now — `updatedAt` isn't skew-safe, later `ALTER
ADD COLUMN` needs no second migration); `sync_ops` ≠ `memoryEvents` (privacy-excluded + pruned); `.svsealed`
out of sync scope (device-key encrypted). Confirmed buildable today: Stages 1-3 desktop path, the
StoreEngine seam, engine-owned transaction, the corrected guard set. (Minor: `perf-and-storage.md` §S3's
`app.ts:697-708` line ref for the `?contentType=` gap is stale — re-locate if reused.)
