import path from "node:path";
import {
  anchorSchema,
  assetSchema,
  chatSessionSchema,
  conceptSchema,
  memoryEventSchema,
  noteSchema,
  operationSchema,
  patchSchema,
  relationSchema,
  sourceSchema,
  studyLayerSchema,
  triggerSchema,
  type AnchorRecord,
  type AssetRecord,
  type ChatSessionRecord,
  type ConceptRecord,
  type MemoryEventRecord,
  type NoteRecord,
  type OperationRecord,
  type PatchRecord,
  type RelationRecord,
  type SourceRecord,
  type StudyLayerRecord,
  type TriggerRecord
} from "../schema";
import type { StorageAdapter } from "../storage/adapter";
import { nodeStorage } from "../storage/nodeStorage";
import type { StoreConfig, StoreEngine } from "./engine";
import { jsonlEngine } from "./jsonlEngine";
import { sqliteEngine } from "./sqliteEngine";
import { createSnapshotStore, type SnapshotStore } from "./snapshotStore";

/**
 * STORE-SQL Stage-3 (docs/implementation/sqlite-migration-build-spec.md §Stage-3) — the DEFAULT
 * runtime storage engine is now SQLite (better-sqlite3): `get(id)` goes O(N)→O(1), reads stop
 * re-scanning the whole file. `createEntityStores` runs SERVER-SIDE (Node), so `process.env` is
 * available here.
 *
 * REVERSIBILITY GUARDRAIL (the user-requested switch): `STORE_ENGINE=jsonl` falls back to the
 * previous file-backed engine for one release, so if sqlite ever misbehaves in the wild the fix
 * is an env var — no code change / redeploy. Any OTHER value (or unset) = sqlite (the new default).
 * Only the DEFAULT engine param resolves through here; explicit-engine call sites (the
 * parameterized snapshotStore tests, jsonl-inherent tests) keep passing their engine directly.
 */
export function resolveDefaultEngine(): StoreEngine {
  return process.env.STORE_ENGINE === "jsonl" ? jsonlEngine : sqliteEngine;
}

export const entityFileNames = {
  sources: "sources.jsonl",
  anchors: "anchors.jsonl",
  notes: "notes.jsonl",
  patches: "patches.jsonl",
  concepts: "concepts.jsonl",
  relations: "relations.jsonl",
  assets: "assets.jsonl",
  layers: "layers.jsonl",
  operations: "operations.jsonl",
  // Proactive-learning trigger DEFINITIONS (PRO-1, proactive-learning.md §1) — the
  // temporal analogue of operations.jsonl. Fire STATE lives separately in the raw-JSON
  // trigger-fires.json (the operation-prefs idiom), never in this durable definition store.
  triggers: "triggers.jsonl",
  // AI chat sessions (ai-workspace.md §2.1, W1) — durable, resumable conversations.
  chatSessions: "chat-sessions.jsonl",
  // Learner-memory 短期 stream (learner-memory.md §2) — its OWN jsonl so the raw,
  // prunable event stream never mingles with the durable entities above.
  memoryEvents: "memory-events.jsonl"
} as const;

export type EntityStores = {
  sources: SnapshotStore<SourceRecord>;
  anchors: SnapshotStore<AnchorRecord>;
  notes: SnapshotStore<NoteRecord>;
  patches: SnapshotStore<PatchRecord>;
  concepts: SnapshotStore<ConceptRecord>;
  relations: SnapshotStore<RelationRecord>;
  assets: SnapshotStore<AssetRecord>;
  layers: SnapshotStore<StudyLayerRecord>;
  operations: SnapshotStore<OperationRecord>;
  triggers: SnapshotStore<TriggerRecord>;
  chatSessions: SnapshotStore<ChatSessionRecord>;
  memoryEvents: SnapshotStore<MemoryEventRecord>;
};

/**
 * Per-entity SQLite index/junction config (docs/implementation/sqlite-migration-build-spec.md
 * §Schema). The `jsonlEngine` IGNORES these fields entirely (they're purely additive), so
 * threading them changes nothing on the default path — they only shape the sqlite tables when
 * an `sqliteEngine` is passed. Kept here (next to the store wiring) because this is the one
 * place the 12 entities' shapes are known.
 */

// notes: sourceId/contentType extracted columns + the three many-to-many junctions
// (note_anchors/note_concepts/note_layers). status is NOT a column (N2); the legacy singular
// note.layerId rides the json blob losslessly (N2).
const notesSqlConfig: Pick<StoreConfig<NoteRecord>, "table" | "columns" | "junctions"> = {
  table: "notes",
  columns: [
    { name: "sourceId", value: (note) => note.sourceId ?? null },
    { name: "contentType", value: (note) => note.contentType }
  ],
  junctions: [
    { table: "note_anchors", refColumn: "anchorId", refIds: (note) => note.anchorIds },
    { table: "note_concepts", refColumn: "conceptId", refIds: (note) => note.conceptIds },
    { table: "note_layers", refColumn: "layerId", refIds: (note) => note.layerIds }
  ]
};

// anchors: discriminatedUnion → sourceId is the only shared, always-present index column (N1).
const anchorsSqlConfig: Pick<StoreConfig<AnchorRecord>, "table" | "columns"> = {
  table: "anchors",
  columns: [{ name: "sourceId", value: (anchor) => anchor.sourceId }]
};

// memoryEvents: verb/sessionId extracted; createdAt indexed for range/prune reads later.
const memoryEventsSqlConfig: Pick<StoreConfig<MemoryEventRecord>, "table" | "columns"> = {
  table: "memoryEvents",
  columns: [
    { name: "verb", value: (event) => event.verb },
    { name: "sessionId", value: (event) => event.sessionId ?? null },
    { name: "createdAt", value: (event) => event.createdAt, partialLiveIndex: false }
  ]
};

export function createEntityStores(
  studyDir: string,
  storage: StorageAdapter = nodeStorage,
  engine: StoreEngine = resolveDefaultEngine()
): EntityStores {
  const filePath = (file: string) => path.join(studyDir, file);
  return {
    sources: createSnapshotStore({ filePath: filePath(entityFileNames.sources), schema: sourceSchema, storage, table: "sources", engine }),
    anchors: createSnapshotStore({ filePath: filePath(entityFileNames.anchors), schema: anchorSchema, storage, engine, ...anchorsSqlConfig }),
    notes: createSnapshotStore({ filePath: filePath(entityFileNames.notes), schema: noteSchema, storage, engine, ...notesSqlConfig }),
    patches: createSnapshotStore({ filePath: filePath(entityFileNames.patches), schema: patchSchema, storage, table: "patches", engine }),
    concepts: createSnapshotStore({ filePath: filePath(entityFileNames.concepts), schema: conceptSchema, storage, table: "concepts", engine }),
    relations: createSnapshotStore({ filePath: filePath(entityFileNames.relations), schema: relationSchema, storage, table: "relations", engine }),
    assets: createSnapshotStore({ filePath: filePath(entityFileNames.assets), schema: assetSchema, storage, table: "assets", engine }),
    layers: createSnapshotStore({ filePath: filePath(entityFileNames.layers), schema: studyLayerSchema, storage, table: "layers", engine }),
    operations: createSnapshotStore({ filePath: filePath(entityFileNames.operations), schema: operationSchema, storage, table: "operations", engine }),
    triggers: createSnapshotStore({ filePath: filePath(entityFileNames.triggers), schema: triggerSchema, storage, table: "triggers", engine }),
    chatSessions: createSnapshotStore({ filePath: filePath(entityFileNames.chatSessions), schema: chatSessionSchema, storage, table: "chatSessions", engine }),
    memoryEvents: createSnapshotStore({ filePath: filePath(entityFileNames.memoryEvents), schema: memoryEventSchema, storage, engine, ...memoryEventsSqlConfig })
  };
}

