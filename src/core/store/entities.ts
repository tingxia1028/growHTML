import path from "node:path";
import {
  anchorSchema,
  assetSchema,
  conceptSchema,
  noteSchema,
  patchSchema,
  relationSchema,
  sourceSchema,
  studyLayerSchema,
  type AnchorRecord,
  type AssetRecord,
  type ConceptRecord,
  type NoteRecord,
  type PatchRecord,
  type RelationRecord,
  type SourceRecord,
  type StudyLayerRecord
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
  layers: "layers.jsonl"
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
    layers: createSnapshotStore({ filePath: filePath(entityFileNames.layers), schema: studyLayerSchema, storage })
  };
}

