import Database from "better-sqlite3";
import type { z } from "zod";
import {
  CLOSE,
  DUMP,
  FTS_QUOTE_READER,
  FTS_REFRESH_FOR_ANCHOR,
  FTS_SEARCH,
  FTS_SET_NOTE_REFRESHER,
  FTS_SET_QUOTE_RESOLVER,
  LOAD,
  type FtsSpec,
  type StoreConfig,
  type StoreEngine
} from "./engine";
import { readJsonl, writeJsonlAtomic, type JsonlIssue, type JsonlReadResult } from "./jsonl";
import type { StorageAdapter } from "../storage/adapter";
import type { SnapshotRecord, SnapshotStore } from "./snapshotStore";

/**
 * STORE-SQL Stage-1 — the SQLite storage engine (better-sqlite3), behind the SAME
 * 8-method {@link SnapshotStore} contract as `jsonlEngine`
 * (docs/implementation/sqlite-migration-build-spec.md §Stage-1 / §Schema).
 *
 * GENERIC by design: `createEntityStores` builds all 12 stores identically, so this
 * engine is parameterized purely by {@link StoreConfig}. Every table has the same
 * envelope shape — `id PK, updatedAt, deletedAt NULL, json` — plus any DERIVED index
 * columns and (notes only) many-to-many junction tables the config declares. The full
 * record always lives in the `json` blob, so the zod schemas never force a table
 * migration (N1: anchor's discriminatedUnion → kind-specific columns are nullable;
 * N2: no `status` column, legacy singular `layerId` rides the blob losslessly;
 * N3: concept aliases/tags stay in the blob, no junction).
 *
 * Invariant mapping (matches `snapshotStore.ts` EXACTLY):
 * - list()        = WHERE deletedAt IS NULL
 * - listTrashed() = WHERE deletedAt IS NOT NULL
 * - getAny(id)    = by id, no delete filter
 * - get(id)       = by id AND deletedAt IS NULL
 * - upsert        = INSERT … ON CONFLICT(id) DO UPDATE (real PK; the jsonl
 *                   dedupe-by-updatedAt quirk disappears) + atomic junction rewrite.
 * - delete(id)    = real purge (also drops the row's junctions).
 * - readWithIssues() = {records: ALL incl tombstones, issues: []} (rows are already valid).
 *
 * TRANSACTIONS ARE ENGINE-OWNED (§The-seam #5): `upsert` writes the row and its junction
 * rows inside one `db.transaction()` — the interface never exposes a `transaction()`
 * primitive (the deferred mobile driver is async).
 */

/** Reserved column names the envelope owns (a config column must not collide). */
const ENVELOPE_COLUMNS = new Set(["id", "updatedAt", "deletedAt", "json"]);

// The hidden CLOSE / DUMP hook symbols + their pure symbol-dispatchers (closeSqliteStore /
// dumpStoreToJsonl) live in `./engine` (native-free) so importing the release/dump hook never
// eagerly loads better-sqlite3. This engine only INSTALLS the hooks under the shared symbols
// (Object.defineProperty below), reusing the SAME Symbol.for keys via the imported constants.

// A DB handle + its config, handed to bootstrap(). NOT memoized — sqliteEngine() opens a
// fresh connection per call (each store is built exactly once per openVault, so memoization
// would buy nothing). Note: two `new Database(":memory:")` calls are SEPARATE private DBs.
type Backend<T extends SnapshotRecord> = {
  db: Database.Database;
  config: StoreConfig<T>;
};

function tableName(config: { table?: string; filePath: string }): string {
  if (config.table) return config.table;
  // Derive a plain identifier from the jsonl file name (e.g. "notes.jsonl" → "notes").
  const base = config.filePath.replace(/\\/g, "/").split("/").pop() ?? config.filePath;
  const slug = base.replace(/\.jsonl$/i, "").replace(/[^A-Za-z0-9_]/g, "_");
  return slug || "records";
}

/** Resolve where the `.db` lives: an in-memory sentinel, or the `.jsonl`'s `.db` sibling. */
function resolveDbPath(filePath: string): string {
  if (filePath === ":memory:" || filePath.startsWith("file::memory:")) return filePath;
  if (/\.jsonl$/i.test(filePath)) return filePath.replace(/\.jsonl$/i, ".db");
  return `${filePath}.db`;
}

function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`sqliteEngine: unsafe SQL identifier "${name}"`);
  }
  return `"${name}"`;
}

function bootstrap<T extends SnapshotRecord>(backend: Backend<T>): void {
  const { db, config } = backend;
  const table = tableName(config);
  const columns = config.columns ?? [];
  const junctions = config.junctions ?? [];

  for (const column of columns) {
    if (ENVELOPE_COLUMNS.has(column.name)) {
      throw new Error(`sqliteEngine: config column "${column.name}" collides with an envelope column`);
    }
  }

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const extraCols = columns.map((column) => `,\n  ${quoteIdent(column.name)}`).join("");
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (
  id TEXT PRIMARY KEY,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT${extraCols},
  json TEXT NOT NULL
);`
  );

  // ORDER BY updatedAt, id everywhere (replicates the jsonl default sort so consumers
  // relying on order don't break). Index (updatedAt, id) covers it.
  db.exec(
    `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${table}_order`)} ON ${quoteIdent(table)} (updatedAt, id);`
  );

  for (const column of columns) {
    const idxName = quoteIdent(`${table}_${column.name}`);
    const partial = column.partialLiveIndex === false ? "" : " WHERE deletedAt IS NULL";
    db.exec(`CREATE INDEX IF NOT EXISTS ${idxName} ON ${quoteIdent(table)} (${quoteIdent(column.name)})${partial};`);
  }

  for (const junction of junctions) {
    const jt = quoteIdent(junction.table);
    const ref = quoteIdent(junction.refColumn);
    // ownerId → the notes row; ref → the anchor/concept/layer id. Composite PK dedupes;
    // the ref index makes "notes referencing X" a fast lookup. FK to the owner table with
    // ON DELETE CASCADE so a real purge drops the junction rows for free.
    db.exec(
      `CREATE TABLE IF NOT EXISTS ${jt} (
  ownerId TEXT NOT NULL,
  ${ref} TEXT NOT NULL,
  PRIMARY KEY (ownerId, ${ref}),
  FOREIGN KEY (ownerId) REFERENCES ${quoteIdent(table)}(id) ON DELETE CASCADE
);`
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${junction.table}_ref`)} ON ${jt} (${ref});`
    );
  }

  // STORE-SQL Stage-5 — the FTS5 candidate-filter table (notes + sources). A contentless-style
  // external table keyed by the record id: `id` is UNINDEXED (returned, not searched) and `doc`
  // carries the whole FTS document. The `trigram` tokenizer does TRUE substring matching including
  // CJK (the default unicode61 treats a CJK run as one token → mid-string CJK hits would be lost).
  // The doc is JS-built at write time (the blob is opaque to SQL), so NO SQL triggers. The ANCHORS
  // store sets `fts.isAnchor` purely to expose its quote reader + note fan-out — it has NO own FTS
  // table (anchors surface through their notes), so it is skipped here.
  if (config.fts && !config.fts.isAnchor) {
    db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${quoteIdent(`${table}_fts`)} USING fts5(
  id UNINDEXED,
  doc,
  tokenize = 'trigram'
);`
    );
  }
}

type Row = { json: string };

// PARITY with jsonl's readJsonl (jsonl.ts:29-52): validate every blob against the schema on
// read. Invalid rows are EXCLUDED from `records` and surfaced as `issues` — preserving the
// persistence floor's corruption / schema-drift detection on the sqlite path (writes are
// schema-checked at the service boundary, but external tamper / bit-rot / a later schema
// change can still leave an invalid stored blob). Cost is bounded to the ROWS RETURNED
// (jsonl re-validated the whole file), so this keeps the sqlite read-path win.
function parseRows<T extends SnapshotRecord>(
  rows: Row[],
  schema: z.ZodType<T>
): { records: T[]; issues: JsonlIssue[] } {
  const records: T[] = [];
  const issues: JsonlIssue[] = [];
  rows.forEach((row, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.json);
    } catch (error) {
      issues.push({ line: index + 1, raw: row.json, reason: error instanceof Error ? error.message : "Invalid JSON" });
      return;
    }
    const result = schema.safeParse(parsed);
    if (result.success) records.push(result.data);
    else issues.push({ line: index + 1, raw: row.json, reason: result.error.issues.map((i) => i.message).join("; ") });
  });
  return { records, issues };
}

// Single-row read: an invalid blob resolves to null (jsonl drops it from dedupe → get() finds
// nothing → null), so callers can never receive an unvalidated record.
function parseOne<T extends SnapshotRecord>(row: Row | undefined, schema: z.ZodType<T>): T | null {
  if (!row) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.json);
  } catch {
    return null;
  }
  const result = schema.safeParse(parsed);
  return result.success ? result.data : null;
}

export const sqliteEngine: StoreEngine = <T extends SnapshotRecord>(
  config: StoreConfig<T>
): SnapshotStore<T> => {
  if (config.sort) {
    // The sqlite engine sorts via `ORDER BY updatedAt, id` (the jsonl DEFAULT). An arbitrary
    // JS comparator can't be pushed into SQL, so rather than silently diverge from a custom
    // jsonl sort, refuse it loudly. (No entity uses a custom sort today — entities.ts.)
    throw new Error("sqliteEngine: custom config.sort is not supported (ORDER BY updatedAt,id only)");
  }
  const db = new Database(resolveDbPath(config.filePath));
  const backend: Backend<T> = { db, config };
  bootstrap(backend);

  const table = tableName(config);
  const tbl = quoteIdent(table);
  const schema = config.schema;
  const columns = config.columns ?? [];
  const junctions = config.junctions ?? [];

  const columnNames = columns.map((c) => c.name);
  const insertCols = ["id", "updatedAt", "deletedAt", ...columnNames, "json"];
  const placeholders = insertCols.map((c) => `@${c}`).join(", ");
  const updateAssignments = insertCols
    .filter((c) => c !== "id")
    .map((c) => `${quoteIdent(c)} = excluded.${quoteIdent(c)}`)
    .join(", ");

  const upsertStmt = db.prepare(
    `INSERT INTO ${tbl} (${insertCols.map(quoteIdent).join(", ")}) VALUES (${placeholders})
     ON CONFLICT(id) DO UPDATE SET ${updateAssignments}`
  );

  // Junction statements: wipe-then-insert this owner's child rows in the same tx.
  const junctionStmts = junctions.map((junction) => ({
    junction,
    del: db.prepare(`DELETE FROM ${quoteIdent(junction.table)} WHERE ownerId = ?`),
    ins: db.prepare(
      `INSERT OR IGNORE INTO ${quoteIdent(junction.table)} (ownerId, ${quoteIdent(junction.refColumn)}) VALUES (?, ?)`
    )
  }));

  // —— STORE-SQL Stage-5: FTS5 candidate-filter row maintenance ————————————————————————————
  // The FTS row is kept in LOCKSTEP with the envelope row inside the SAME upsert transaction (below):
  // a LIVE record has exactly one FTS row (id → doc); a tombstoned (deletedAt) or purged record has
  // NONE (so a MATCH only ever returns live candidates and the tiered ranker never scores a deleted
  // row). The doc is JS-built here (`buildFtsDoc`) because the blob is opaque to SQL — no triggers.
  const fts = config.fts as FtsSpec<T> | undefined;
  // A store OWNS an FTS table only when it has an fts config that is NOT the anchor quote-source
  // (the anchors store's fts config exists solely for the quote reader + fan-out — no table).
  const hasFtsTable = !!fts && !fts.isAnchor;
  const ftsTable = hasFtsTable ? quoteIdent(`${table}_fts`) : "";
  const ftsDeleteStmt = hasFtsTable ? db.prepare(`DELETE FROM ${ftsTable} WHERE id = ?`) : null;
  const ftsInsertStmt = hasFtsTable ? db.prepare(`INSERT INTO ${ftsTable} (id, doc) VALUES (?, ?)`) : null;
  // Live-only row read for the fan-out re-index (a tombstoned note gets no FTS row anyway).
  const ftsGetJsonStmt = hasFtsTable ? db.prepare(`SELECT json FROM ${tbl} WHERE id = ? AND deletedAt IS NULL`) : null;
  // (notes only) owner ids of every note whose note_anchors row references a given anchor — the
  // write-amplification lookup that drives the anchor-quote fan-out.
  const anchorJunction = junctions.find((j) => j.refColumn === "anchorId");
  const notesForAnchorStmt =
    hasFtsTable && anchorJunction
      ? db.prepare(`SELECT ownerId FROM ${quoteIdent(anchorJunction.table)} WHERE anchorId = ?`)
      : null;

  // Injected by wireFtsAnchorNotes (createEntityStores) AFTER both stores exist:
  //   • resolveQuote — the notes store reads an anchor's quote from the sibling anchors store's
  //     connection SYNCHRONOUSLY (better-sqlite3 tx are sync → no await inside upsertTxn). Absent
  //     before wiring / for a source store → quotes resolve to "" (note text + title still index).
  //   • refreshNote — the anchors store fans out to re-extract a note's FTS doc (write-amplification).
  let resolveQuote: ((anchorId: string) => string) | null = null;
  let refreshNoteFts: ((noteId: string) => void) | null = null;

  // Build a record's FTS document: the record-OWNED text (toSearchText + title | source title+text)
  // PLUS its denormalized anchor QUOTES (notes only), newline-joined. Blank quotes are dropped.
  function buildFtsDoc(record: T): string {
    if (!hasFtsTable || !fts) return "";
    const parts: string[] = [fts.document(record)];
    const anchorIds = fts.anchorRefIds?.(record) ?? [];
    for (const anchorId of anchorIds) {
      const quote = resolveQuote ? resolveQuote(anchorId) : "";
      if (quote) parts.push(quote);
    }
    return parts.filter((p) => p && p.length > 0).join("\n");
  }

  // Rewrite one record's FTS row (delete-then-insert; a LIVE record gets a row, a tombstoned one
  // does NOT). Runs inside the caller's transaction. `record` is the fresh envelope row.
  function writeFtsRow(record: T): void {
    if (!hasFtsTable || !ftsDeleteStmt || !ftsInsertStmt) return;
    ftsDeleteStmt.run(record.id);
    if (!record.deletedAt) ftsInsertStmt.run(record.id, buildFtsDoc(record));
  }

  // Re-extract a single note's FTS doc from its CURRENT stored row (used by the anchor-quote fan-out).
  // Reads the live blob, re-parses, rebuilds the doc with the now-current quote. Own transaction.
  const refreshNoteFtsById = db.transaction((noteId: string) => {
    if (!hasFtsTable || !ftsGetJsonStmt) return;
    const row = ftsGetJsonStmt.get(noteId) as Row | undefined;
    const record = parseOne<T>(row, schema);
    if (record) writeFtsRow(record);
  });

  // FTS candidate MATCH: id of every LIVE record whose FTS doc matches. Belt-and-braces JOIN to the
  // envelope with `deletedAt IS NULL` (the FTS row is dropped on tombstone anyway). The trigram
  // tokenizer needs ≥3 chars; the search SERVICE gates on query shape (CJK ≥3) and never calls this
  // for the query classes trigram can't reproduce (short / roman → pinyin+fuzzy scan fallback).
  const ftsMatchStmt =
    hasFtsTable
      ? db.prepare(
          `SELECT f.id AS id FROM ${ftsTable} f
             JOIN ${tbl} e ON e.id = f.id
            WHERE f.doc MATCH ? AND e.deletedAt IS NULL`
        )
      : null;

  // Explicit COLLATE BINARY = SQLite's default TEXT collation AND the (updatedAt, id) index's
  // collation, so ORDER BY stays index-covered. jsonl's default sort uses String.localeCompare
  // (ICU); the two AGREE for the charset entity ids actually use (lowercase prefix + "_" +
  // UPPERCASE ULID; ASCII-numeric ISO timestamps — ids.ts). Made explicit so a future id
  // charset with mixed case / high-ASCII can't silently reorder one engine vs the other.
  const orderBy = "ORDER BY updatedAt COLLATE BINARY ASC, id COLLATE BINARY ASC";
  const listLiveStmt = db.prepare(`SELECT json FROM ${tbl} WHERE deletedAt IS NULL ${orderBy}`);
  const listTrashedStmt = db.prepare(`SELECT json FROM ${tbl} WHERE deletedAt IS NOT NULL ${orderBy}`);
  const listAllStmt = db.prepare(`SELECT json FROM ${tbl} ${orderBy}`);
  const getStmt = db.prepare(`SELECT json FROM ${tbl} WHERE id = ? AND deletedAt IS NULL`);
  const getAnyStmt = db.prepare(`SELECT json FROM ${tbl} WHERE id = ?`);
  const deleteStmt = db.prepare(`DELETE FROM ${tbl} WHERE id = ?`);

  // The engine-owned transaction (§The-seam #5): write the row AND its junction rows atomically.
  // A soft-delete (record.deletedAt set) STILL rewrites the junctions from the record's arrays —
  // which for a normal soft-delete are unchanged, so the links SURVIVE the tombstone and a later
  // restore resurrects them. Only a real delete() purge (below) removes junction rows.
  // Read the CURRENT anchor quote for an anchor record's id, so the fan-out only fires when the
  // quote actually CHANGED (an anchor moves / re-anchors far more often than its quote text edits).
  const anchorPrevQuoteStmt =
    fts?.isAnchor ? db.prepare(`SELECT json FROM ${tbl} WHERE id = ?`) : null;

  const upsertTxn = db.transaction((record: T) => {
    // (anchors only) capture the pre-upsert quote to decide whether note FTS docs must refresh.
    let anchorQuoteChanged = false;
    if (fts?.isAnchor && anchorPrevQuoteStmt && fts.anchorQuote) {
      const prevRow = anchorPrevQuoteStmt.get(record.id) as Row | undefined;
      const prev = parseOne<T>(prevRow, schema);
      const prevQuote = prev && fts.anchorQuote ? fts.anchorQuote(prev) : undefined;
      // `fts.anchorQuote(record)` is the RAW quote (present even on a trashed record), but the quote
      // actually written into a note's FTS doc comes from the note-side reader, which returns "" for a
      // TRASHED anchor. So a referencing note's doc depends on this anchor's LIVENESS, not just its
      // quote TEXT — refresh on any liveness transition too. Else soft-delete → note re-save → restore
      // (quote unchanged) leaves the note doc permanently blank of the quote: a silent search
      // false-negative the scan would still find (S5 adversarial review).
      const prevLive = !!prev && !prev.deletedAt;
      const nowLive = !record.deletedAt;
      anchorQuoteChanged = prevQuote !== fts.anchorQuote(record) || prevLive !== nowLive;
    }

    const params: Record<string, unknown> = {
      id: record.id,
      updatedAt: record.updatedAt,
      // undefined/null → SQL NULL (live). An empty-string "" would store as a non-null value →
      // TRASHED, which DIVERGES from jsonl's `!deletedAt` (live) — harmless in practice because
      // isoDateTimeSchema.optional() rejects "" at the write boundary.
      deletedAt: record.deletedAt ?? null,
      json: JSON.stringify(record)
    };
    for (const column of columns) {
      const value = column.value(record);
      params[column.name] = value === undefined ? null : value;
    }
    upsertStmt.run(params);

    for (const { junction, del, ins } of junctionStmts) {
      del.run(record.id);
      const ids = junction.refIds(record) ?? [];
      const seen = new Set<string>();
      for (const refId of ids) {
        if (seen.has(refId)) continue;
        seen.add(refId);
        ins.run(record.id, refId);
      }
    }

    // Stage-5: keep THIS record's FTS row in lockstep (notes doc includes its anchor quotes;
    // source doc = title + text). A tombstoned upsert removes the FTS row (writeFtsRow no-ops the
    // insert when deletedAt is set), so a MATCH never returns a soft-deleted candidate.
    writeFtsRow(record);

    // The anchor-quote fan-out (write-amplification) is returned to the async `upsert` wrapper to
    // run AFTER this transaction commits — it writes into the SIBLING notes `.db` (a separate
    // connection/transaction), so it must not ride this store's transaction boundary.
    return fts?.isAnchor && anchorQuoteChanged;
  });

  const store: SnapshotStore<T> = {
    async list() {
      return parseRows<T>(listLiveStmt.all() as Row[], schema).records;
    },

    async listTrashed() {
      return parseRows<T>(listTrashedStmt.all() as Row[], schema).records;
    },

    async readWithIssues(): Promise<JsonlReadResult<T>> {
      // Validate every stored blob (tombstones included) against the schema — parity with
      // jsonl's readJsonl: invalid rows are dropped from `records` and reported in `issues`.
      return parseRows<T>(listAllStmt.all() as Row[], schema);
    },

    async get(id: string) {
      return parseOne<T>(getStmt.get(id) as Row | undefined, schema);
    },

    async getAny(id: string) {
      return parseOne<T>(getAnyStmt.get(id) as Row | undefined, schema);
    },

    async upsert(record: T) {
      const fanOut = upsertTxn(record);
      // Stage-5 write-amplification: an anchor whose quote changed refreshes every referencing
      // note's FTS doc (in the sibling notes `.db`, wired by wireFtsAnchorNotes). Post-commit so it
      // never rides the anchors-store transaction boundary; a no-op until the vault wires it.
      if (fanOut && refreshNoteFts) refreshNoteFts(record.id);
      return record;
    },

    async delete(id: string) {
      // ON DELETE CASCADE drops this owner's junction rows in the same statement. Drop the FTS row
      // too (a purge leaves no candidate behind).
      if (ftsDeleteStmt) ftsDeleteStmt.run(id);
      const info = deleteStmt.run(id);
      return info.changes > 0;
    }
  };

  Object.defineProperty(store, CLOSE, {
    value: () => db.open && db.close(),
    enumerable: false,
    configurable: true
  });

  // Stage-2 dump hook: write this store's schema-validated rows (incl. tombstones) to a jsonl file,
  // so the data-trust export materializes the pack's source-of-truth jsonl from the runtime `.db`.
  Object.defineProperty(store, DUMP, {
    value: async (jsonlPath: string, dumpStorage?: StorageAdapter) => {
      const { records } = await store.readWithIssues();
      await writeJsonlAtomic(jsonlPath, records, dumpStorage ?? config.storage);
    },
    enumerable: false,
    configurable: true
  });

  // Stage-3 load hook (SYMMETRIC inverse of DUMP): pump a jsonl file's records into this fresh
  // `.db` on a sqlite-TARGET vault import. Each `upsert` runs the engine-owned transaction, so the
  // note junction rows (note_anchors/note_concepts/note_layers) are rebuilt from the record arrays
  // for free. `readJsonl` schema-validates + skips blank lines (invalid rows dropped, parity with
  // the dump); the whole load is idempotent (upsert by PK) and safe to re-run.
  Object.defineProperty(store, LOAD, {
    value: async (jsonlPath: string, loadStorage?: StorageAdapter) => {
      const { records } = await readJsonl<T>(jsonlPath, schema, loadStorage ?? config.storage);
      for (const record of records) {
        upsertTxn(record);
      }
    },
    enumerable: false,
    configurable: true
  });

  // —— STORE-SQL Stage-5 FTS hooks (installed only on FTS-backed stores) ————————————————————————
  if (hasFtsTable && ftsMatchStmt) {
    // FTS_SEARCH: the candidate pre-filter the search service calls (ftsSearchStore). The query is
    // wrapped as a DOUBLE-QUOTED FTS5 phrase (inner `"` doubled) so arbitrary user input — hyphens,
    // quotes, FTS operator words (AND/OR/NEAR) — is a safe LITERAL substring, never MATCH syntax.
    Object.defineProperty(store, FTS_SEARCH, {
      value: (query: string): string[] => {
        const phrase = `"${query.replace(/"/g, '""')}"`;
        try {
          return (ftsMatchStmt.all(phrase) as { id: string }[]).map((row) => row.id);
        } catch {
          // A pathological query FTS5 still can't parse (e.g. a lone unbalanced token) → empty
          // candidate set; the service caller treats an empty set exactly like "matched nothing".
          return [];
        }
      },
      enumerable: false,
      configurable: true
    });
  }

  // (notes only) FTS_REFRESH_FOR_ANCHOR: re-extract the FTS doc of every note referencing an anchor —
  // the anchor-quote write-amplification fan-out target (wired to the anchors store by
  // wireFtsAnchorNotes). Reads the note_anchors junction for owner note ids, refreshes each.
  if (hasFtsTable && notesForAnchorStmt) {
    Object.defineProperty(store, FTS_REFRESH_FOR_ANCHOR, {
      value: (anchorId: string): void => {
        const ownerRows = notesForAnchorStmt.all(anchorId) as { ownerId: string }[];
        for (const { ownerId } of ownerRows) refreshNoteFtsById(ownerId);
      },
      enumerable: false,
      configurable: true
    });
    // FTS_SET_QUOTE_RESOLVER: the anchors store's sync quote reader is injected here so buildFtsDoc
    // can denormalize live quote text into a note's doc at write time.
    Object.defineProperty(store, FTS_SET_QUOTE_RESOLVER, {
      value: (fn: (anchorId: string) => string): void => {
        resolveQuote = fn;
      },
      enumerable: false,
      configurable: true
    });
  }

  // (anchors only) FTS_QUOTE_READER: a SYNC read of an anchor's current quote from THIS store's
  // connection (the notes store calls it inside its sync upsert transaction). FTS_SET_NOTE_REFRESHER
  // receives the notes store's fan-out so an anchor-quote edit refreshes referencing note docs.
  if (fts?.isAnchor && fts.anchorQuote) {
    const quoteReaderStmt = db.prepare(`SELECT json FROM ${tbl} WHERE id = ? AND deletedAt IS NULL`);
    Object.defineProperty(store, FTS_QUOTE_READER, {
      value: (anchorId: string): string => {
        const record = parseOne<T>(quoteReaderStmt.get(anchorId) as Row | undefined, schema);
        return record && fts.anchorQuote ? fts.anchorQuote(record) : "";
      },
      enumerable: false,
      configurable: true
    });
    Object.defineProperty(store, FTS_SET_NOTE_REFRESHER, {
      value: (fn: (anchorId: string) => void): void => {
        refreshNoteFts = fn;
      },
      enumerable: false,
      configurable: true
    });
  }

  return store;
};
