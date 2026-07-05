import Database from "better-sqlite3";
import type { z } from "zod";
import type { StoreConfig, StoreEngine } from "./engine";
import type { JsonlIssue, JsonlReadResult } from "./jsonl";
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

/**
 * A hidden close hook on each sqlite-backed store. A DB connection is a process-lifetime
 * resource (like node-pty) — production never closes it — but tests and teardown need to
 * release the file handle (Windows can't unlink an open `.db`/`-wal`). Kept off the public
 * 8-method {@link SnapshotStore} contract via a symbol so the interface stays exactly 8 methods.
 */
const CLOSE = Symbol.for("growhtml.sqliteEngine.close");

/** Close a sqlite-backed store's DB connection if it has one (no-op for other engines). */
export function closeSqliteStore(store: SnapshotStore<SnapshotRecord>): void {
  const hook = (store as Record<symbol, unknown>)[CLOSE];
  if (typeof hook === "function") hook();
}

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
  const upsertTxn = db.transaction((record: T) => {
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
      upsertTxn(record);
      return record;
    },

    async delete(id: string) {
      // ON DELETE CASCADE drops this owner's junction rows in the same statement.
      const info = deleteStmt.run(id);
      return info.changes > 0;
    }
  };

  Object.defineProperty(store, CLOSE, {
    value: () => db.open && db.close(),
    enumerable: false,
    configurable: true
  });

  return store;
};
