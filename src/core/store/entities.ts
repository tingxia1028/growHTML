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
import { createSnapshotStore, type SnapshotStore } from "./snapshotStore";

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

export function createEntityStores(studyDir: string, storage: StorageAdapter = nodeStorage): EntityStores {
  const filePath = (file: string) => path.join(studyDir, file);
  return {
    sources: createSnapshotStore({ filePath: filePath(entityFileNames.sources), schema: sourceSchema, storage }),
    anchors: createSnapshotStore({ filePath: filePath(entityFileNames.anchors), schema: anchorSchema, storage }),
    notes: createSnapshotStore({ filePath: filePath(entityFileNames.notes), schema: noteSchema, storage }),
    patches: createSnapshotStore({ filePath: filePath(entityFileNames.patches), schema: patchSchema, storage }),
    concepts: createSnapshotStore({ filePath: filePath(entityFileNames.concepts), schema: conceptSchema, storage }),
    relations: createSnapshotStore({ filePath: filePath(entityFileNames.relations), schema: relationSchema, storage }),
    assets: createSnapshotStore({ filePath: filePath(entityFileNames.assets), schema: assetSchema, storage }),
    layers: createSnapshotStore({ filePath: filePath(entityFileNames.layers), schema: studyLayerSchema, storage }),
    operations: createSnapshotStore({ filePath: filePath(entityFileNames.operations), schema: operationSchema, storage }),
    triggers: createSnapshotStore({ filePath: filePath(entityFileNames.triggers), schema: triggerSchema, storage }),
    chatSessions: createSnapshotStore({ filePath: filePath(entityFileNames.chatSessions), schema: chatSessionSchema, storage }),
    memoryEvents: createSnapshotStore({ filePath: filePath(entityFileNames.memoryEvents), schema: memoryEventSchema, storage })
  };
}

