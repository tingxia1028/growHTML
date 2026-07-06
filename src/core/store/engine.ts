import type { z } from "zod";
import type { StorageAdapter } from "../storage/adapter";
import type { SnapshotRecord, SnapshotStore } from "./snapshotStore";

/**
 * A hidden close hook on each sqlite-backed store. A DB connection is a process-lifetime
 * resource (like node-pty) — production never closes it — but tests and teardown need to
 * release the file handle (Windows can't unlink an open `.db`/`-wal`). Kept off the public
 * 8-method {@link SnapshotStore} contract via a symbol so the interface stays exactly 8 methods.
 *
 * DECOUPLED from `sqliteEngine.ts` on purpose: `closeSqliteStore` must be importable
 * (by `vault.ts`, `dataTrust.ts`, tests) WITHOUT eagerly loading the better-sqlite3 native
 * binary. `engine.ts` imports NO better-sqlite3, so a jsonl-only user whose native module
 * isn't built for their runtime never trips an ABI-mismatch just by importing the release
 * hook. The symbol is a GLOBAL-registry `Symbol.for(...)`, so sqliteEngine.ts installs the
 * hook under the SAME key and the read here matches.
 *
 * Exported so `sqliteEngine.ts` INSTALLS the hook under the shared constant rather than a
 * duplicate `Symbol.for(...)` — one source of truth for the key.
 */
export const CLOSE = Symbol.for("growhtml.sqliteEngine.close");

/**
 * A hidden dump hook on each sqlite-backed store (STORE-SQL Stage-2, §Stage-2). The `.db` is the
 * RUNTIME truth, but the PACK's source of truth is the `*.jsonl` dumps (spec R2). This lets the
 * data-trust export MATERIALIZE the sqlite rows to their jsonl file BEFORE the whole-dir zip walk.
 * Kept off the public 8-method {@link SnapshotStore} contract via a symbol — same idiom as CLOSE.
 * DECOUPLED from the native module for the same reason as {@link CLOSE} (see above); the actual
 * jsonl WRITE lives INSIDE the hook that sqliteEngine.ts installs, so this module needs no
 * `writeJsonlAtomic` import.
 *
 * Exported so `sqliteEngine.ts` INSTALLS the hook under the shared constant (see {@link CLOSE}).
 */
export const DUMP = Symbol.for("growhtml.sqliteEngine.dump");

/**
 * A hidden LOAD hook on each sqlite-backed store (STORE-SQL Stage-3, §Stage-3). The SYMMETRIC
 * inverse of {@link DUMP}: the pack's source of truth is the `*.jsonl` dumps (spec R2), so on a
 * sqlite-TARGET vault import the swapped-in jsonl must be PUMPED into the fresh (empty) `.db`,
 * else a freshly-opened sqlite store reads an empty cache and the imported data is invisible.
 * The installed hook reads the jsonl file and `upsert`s each record — which for notes rebuilds
 * the note_anchors/note_concepts/note_layers junctions (+ any FTS) from the record arrays FOR
 * FREE (the engine-owned upsert transaction). Kept off the public 8-method {@link SnapshotStore}
 * contract via a symbol — same idiom as CLOSE/DUMP.
 *
 * DECOUPLED from the native module for the same reason as {@link CLOSE}/{@link DUMP} (see above):
 * the actual jsonl READ + upsert loop lives INSIDE the hook that sqliteEngine.ts installs, so this
 * native-free module needs no `readJsonl` import. On a JSONL-backed store there is NO hook → LOAD
 * is a NO-OP: the jsonl file IS the store (already read directly), and a redundant rewrite would
 * trip the byte-identical-backup guard.
 *
 * Exported so `sqliteEngine.ts` INSTALLS the hook under the shared constant (see {@link CLOSE}).
 */
export const LOAD = Symbol.for("growhtml.sqliteEngine.load");

/**
 * A hidden FTS-MATCH hook on each sqlite-backed store (STORE-SQL Stage-5, §Stage-5). Runs a
 * candidate PRE-FILTER against the store's `<table>_fts` virtual table and returns the ids of
 * LIVE (non-tombstoned) records whose FTS document matches — the search service then LOADS + SCORES
 * those with the tiered ranker in code. Returns `null` (NOT an empty array) when the store has no
 * FTS table (jsonl engine, or a store without `fts` config) so the caller can fall back to a full
 * scan; an empty array means "FTS ran and matched nothing". Kept off the public 8-method
 * {@link SnapshotStore} contract via a symbol — same idiom as CLOSE/DUMP/LOAD.
 *
 * DECOUPLED from the native module for the same reason as CLOSE/DUMP/LOAD: the actual FTS `MATCH`
 * query lives INSIDE the hook the sqlite engine installs, so this native-free module needs no
 * better-sqlite3 import.
 */
export const FTS_SEARCH = Symbol.for("growhtml.sqliteEngine.ftsSearch");

/**
 * Run the FTS5 candidate pre-filter over a store, returning the ids of live records whose FTS
 * document matches `query` — or `null` when the store is not FTS-backed (jsonl / no fts config),
 * signalling the caller to fall back to the in-memory scan. See {@link FTS_SEARCH}.
 *
 * Lives here (not in `sqliteEngine.ts`) so importing it does NOT load better-sqlite3 — it is a pure
 * symbol-dispatcher; the FTS query happens inside the hook the sqlite engine installs.
 */
export function ftsSearchStore(store: SnapshotStore<SnapshotRecord>, query: string): string[] | null {
  const hook = (store as Record<symbol, unknown>)[FTS_SEARCH];
  if (typeof hook !== "function") return null; // not FTS-backed → caller falls back to the scan
  return (hook as (query: string) => string[])(query);
}

/**
 * Cross-store FTS wiring hooks (STORE-SQL Stage-5). Anchor quotes are DENORMALIZED into each note's
 * FTS document, but notes + anchors are SEPARATE sqlite `.db` connections — so the notes store needs
 * a SYNCHRONOUS quote reader from the anchors store (better-sqlite3 transactions are sync, no await
 * inside them), and the anchors store needs a fan-out callback to refresh the notes referencing an
 * edited anchor. {@link wireFtsAnchorNotes} installs both after the stores are built. On non-sqlite
 * (jsonl) stores the hooks are absent → wiring is a safe no-op (jsonl has no FTS to keep in sync).
 */
export const FTS_QUOTE_READER = Symbol.for("growhtml.sqliteEngine.ftsQuoteReader");
export const FTS_SET_QUOTE_RESOLVER = Symbol.for("growhtml.sqliteEngine.ftsSetQuoteResolver");
export const FTS_REFRESH_FOR_ANCHOR = Symbol.for("growhtml.sqliteEngine.ftsRefreshForAnchor");
export const FTS_SET_NOTE_REFRESHER = Symbol.for("growhtml.sqliteEngine.ftsSetNoteRefresher");

/**
 * Wire the anchor-quote denormalization between an FTS-backed notes store and its anchors store
 * (STORE-SQL Stage-5). Idempotent + engine-agnostic: if either store lacks the hooks (jsonl, or a
 * store without `fts`), the missing side is skipped. Called once per vault after `createEntityStores`.
 *   • notes ← anchors: the notes store's FTS doc-builder resolves each anchorId → its quote via the
 *     anchors store's SYNC reader.
 *   • anchors → notes: an anchor upsert fans out to refresh the FTS doc of every note referencing it.
 */
export function wireFtsAnchorNotes(
  notesStore: SnapshotStore<SnapshotRecord>,
  anchorsStore: SnapshotStore<SnapshotRecord>
): void {
  const quoteReader = (anchorsStore as Record<symbol, unknown>)[FTS_QUOTE_READER];
  const setQuoteResolver = (notesStore as Record<symbol, unknown>)[FTS_SET_QUOTE_RESOLVER];
  if (typeof quoteReader === "function" && typeof setQuoteResolver === "function") {
    (setQuoteResolver as (fn: (anchorId: string) => string) => void)(quoteReader as (anchorId: string) => string);
  }
  const refreshForAnchor = (notesStore as Record<symbol, unknown>)[FTS_REFRESH_FOR_ANCHOR];
  const setNoteRefresher = (anchorsStore as Record<symbol, unknown>)[FTS_SET_NOTE_REFRESHER];
  if (typeof refreshForAnchor === "function" && typeof setNoteRefresher === "function") {
    (setNoteRefresher as (fn: (anchorId: string) => void) => void)(refreshForAnchor as (anchorId: string) => void);
  }
}

/**
 * Close a sqlite-backed store's DB connection if it has one (no-op for other engines).
 *
 * Lives here (not in `sqliteEngine.ts`) so importing it does NOT load better-sqlite3 — it
 * is a pure symbol-dispatcher that reads the hidden {@link CLOSE} hook the sqlite engine
 * installs and calls it. For a jsonl-backed store there is no hook → safe no-op.
 */
export function closeSqliteStore(store: SnapshotStore<SnapshotRecord>): void {
  const hook = (store as Record<symbol, unknown>)[CLOSE];
  if (typeof hook === "function") hook();
}

/**
 * Materialize a store's rows to its jsonl file (STORE-SQL Stage-2, §Stage-2). For a SQLITE-backed
 * store the `.db` is the runtime truth, so the installed {@link DUMP} hook writes
 * `(await store.readWithIssues()).records` (schema-validated, incl. tombstones — the S1 fold) via
 * `writeJsonlAtomic` so the export's whole-dir walk zips a CURRENT, complete jsonl. For any OTHER
 * engine (jsonl — today's default) it is a NO-OP: the jsonl file IS the store, already current — so
 * jsonl-vault backups stay BYTE-IDENTICAL (no surprise compaction / reordering from a redundant
 * rewrite).
 *
 * Lives here (not in `sqliteEngine.ts`) so importing it does NOT load better-sqlite3 — it is a
 * pure symbol-dispatcher; the actual jsonl write happens inside the hook the sqlite engine installs.
 */
export async function dumpStoreToJsonl(
  store: SnapshotStore<SnapshotRecord>,
  jsonlPath: string,
  storage?: StorageAdapter
): Promise<void> {
  const hook = (store as Record<symbol, unknown>)[DUMP];
  if (typeof hook !== "function") return; // not sqlite-backed → the jsonl file is already truth
  await (hook as (jsonlPath: string, storage?: StorageAdapter) => Promise<void>)(jsonlPath, storage);
}

/**
 * Pump a jsonl file into a store's backend (STORE-SQL Stage-3, §Stage-3) — the SYMMETRIC inverse of
 * {@link dumpStoreToJsonl}. For a SQLITE-backed store the installed {@link LOAD} hook reads every
 * record from `jsonlPath` and `upsert`s it into the (freshly-swapped-in, empty) `.db`, rebuilding
 * the note junction rows (note_anchors/note_concepts/note_layers) from each record's id arrays for
 * free. For any OTHER engine (jsonl — the reversibility fallback) it is a NO-OP: the jsonl file IS
 * the store, read directly on the next request — a redundant rewrite would break the byte-identical
 * jsonl-backup guarantee.
 *
 * Lives here (not in `sqliteEngine.ts`) so importing it does NOT load better-sqlite3 — it is a pure
 * symbol-dispatcher; the actual jsonl read + upsert loop happens inside the hook the sqlite engine
 * installs. Precondition: the store's backend already points at the swapped-in dir (the caller
 * `close()`d + `reopen()`ed the vault first).
 */
export async function loadStoreFromJsonl(
  store: SnapshotStore<SnapshotRecord>,
  jsonlPath: string,
  storage?: StorageAdapter
): Promise<void> {
  const hook = (store as Record<symbol, unknown>)[LOAD];
  if (typeof hook !== "function") return; // not sqlite-backed → the jsonl file is already the store
  await (hook as (jsonlPath: string, storage?: StorageAdapter) => Promise<void>)(jsonlPath, storage);
}

/**
 * STORE-SQL — the pluggable storage seam (docs/implementation/sqlite-migration-build-spec.md §The-seam).
 *
 * A `StoreEngine` builds a per-entity backend that IS the {@link SnapshotStore}
 * 8-method contract. Two engines exist: `jsonlEngine` (today's file-backed body,
 * behavior-identical) and `sqliteEngine` (better-sqlite3). Consumers only ever see
 * the 8-method interface, so the business-logic blast radius is ≈0.
 *
 * KEY CONSTRAINT (§The-seam #5): the engine OWNS its transactions. `upsert` promises
 * "write the row AND its junction rows atomically" and implements the transaction
 * INTERNALLY (sync on desktop better-sqlite3, async on the deferred mobile driver).
 * The interface therefore never exposes a `transaction()` primitive.
 */
export type StoreEngine = <T extends SnapshotRecord>(config: StoreConfig<T>) => SnapshotStore<T>;

/**
 * Everything an engine needs to back one entity store. The jsonl engine reads only
 * `filePath`/`schema`/`sort`/`storage`; the sqlite engine additionally reads `table`,
 * the extracted index `columns`, and any `junctions` (notes' many-to-many links).
 */
export type StoreConfig<T extends SnapshotRecord> = {
  /** JSONL file path (jsonl engine). Also used to derive the sqlite `.db` sibling path if needed. */
  filePath: string;
  schema: z.ZodType<T>;
  sort?: (a: T, b: T) => number;
  storage?: StorageAdapter;

  // —— SQLite-only config (ignored by the jsonl engine) ——
  /** Table name for the sqlite backend (defaults to a slug derived from the file name). */
  table?: string;
  /**
   * Extracted index columns DERIVED from each record on write. The full record always
   * lives in the `json` blob (schemas never need a table migration); these columns only
   * exist to make the store's queries fast/possible. All are nullable (N1: anchor's
   * kind-specific columns; a note without a sourceId).
   */
  columns?: readonly ExtractedColumn<T>[];
  /**
   * Many-to-many junction tables (notes only — §Schema note_anchors/note_concepts/
   * note_layers). Written atomically INSIDE `upsert` (delete-all-then-insert in the same
   * transaction). A soft-delete (upsert WITH deletedAt) KEEPS the junction rows so a
   * restore resurrects the links; only a real `delete()` purge removes them.
   */
  junctions?: readonly JunctionSpec<T>[];
  /**
   * FTS5 full-text-search config (STORE-SQL Stage-5, notes + sources only). Ignored by the
   * jsonl engine; only the sqlite engine builds the `<table>_fts` virtual table. See {@link FtsSpec}.
   */
  fts?: FtsSpec<T>;
};

/** A DERIVED index column: extract the value for the row from the full record. */
export type ExtractedColumn<T extends SnapshotRecord> = {
  /** Column name (also the SQL identifier — keep it a plain identifier). */
  name: string;
  /** Pull the column value out of the record. Return null/undefined for absent. */
  value: (record: T) => string | number | null | undefined;
  /**
   * `WHERE deletedAt IS NULL` partial index over this column (live-query fast path).
   * `false` ⇒ a plain index (e.g. notes_updated indexes every row for ORDER BY).
   */
  partialLiveIndex?: boolean;
};

/** A many-to-many junction: fan `record[idsField]` out into `<name>(<ownerCol>, <refCol>)` rows. */
export type JunctionSpec<T extends SnapshotRecord> = {
  /** Junction table name (e.g. "note_anchors"). */
  table: string;
  /** The foreign-key column the junction indexes (e.g. "anchorId"). */
  refColumn: string;
  /** Pull the array of referenced ids from the record (e.g. note.anchorIds). */
  refIds: (record: T) => readonly string[] | undefined;
};

/**
 * STORE-SQL Stage-5 — the per-entity FTS5 config (docs/implementation/sqlite-migration-build-spec.md
 * §Stage-5). Declares how a record reduces to its full-text-search DOCUMENT. The sqlite engine
 * keeps ONE `<table>_fts` FTS5 virtual table in lockstep with the envelope row INSIDE the
 * engine-owned upsert transaction (insert/update on upsert, delete on purge) — the blob is opaque
 * to SQL so the document is computed HERE in JS at write time, never via SQL triggers.
 *
 * The FTS table is a candidate PRE-FILTER only ("ranking math stays in code", Anki precedent): a
 * `MATCH` returns candidate ids that the search service then LOADS + scores with the tiered ranker.
 * It uses the `trigram` tokenizer (true substring matching, incl. CJK — the default unicode61
 * tokenizer treats a CJK run as ONE token and would drop mid-string CJK hits).
 */
export type FtsSpec<T extends SnapshotRecord> = {
  /**
   * The record-OWNED half of the FTS document (e.g. a note's toSearchText + title, a source's
   * title + searchable text). Anchor quotes are appended SEPARATELY by the engine via
   * {@link anchorRefIds} + a quote resolver, so they can be refreshed when an anchor edits.
   */
  document: (record: T) => string;
  /**
   * (notes only) The anchor ids whose QUOTE text is denormalized into this record's FTS document.
   * The engine resolves each id → quote via the sibling anchors store at write time. When an
   * anchor's quote changes, every record referencing it has its FTS document refreshed
   * (write-amplification — accepted; the quote is denormalized into the note row).
   */
  anchorRefIds?: (record: T) => readonly string[] | undefined;
  /**
   * Marks THIS store as the anchors store: its upsert must fan out to refresh the FTS documents
   * of every note referencing the anchor (via the note_anchors junction). Set on the anchors
   * store only. The engine reads {@link anchorQuote} to get the fresh quote text.
   */
  isAnchor?: boolean;
  /** (anchors only) The quote text of an anchor record — what gets denormalized into note docs. */
  anchorQuote?: (record: T) => string;
};
