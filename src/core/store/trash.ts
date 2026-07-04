// TRUST-3 回收站 tombstone helpers (docs/design/data-trust.md §3) — the ONE shape
// every soft-delete path shares. A soft delete is `deletedAt` on the record
// envelope (additive, compaction-aware — see snapshotStore.ts); a record trashed
// as part of a PARENT's cascade (a source's notes/anchors/patches, a note's
// orphaned anchors) additionally carries `metadata.trash = { cascadeOf: parentId }`
// so restore can resurrect exactly the cascade (and ONLY the cascade — records
// the user had deleted independently beforehand stay in the bin).

import type { SnapshotRecord } from "./snapshotStore";

/** The metadata key trash bookkeeping lives under (the plugin-escape-hatch slot). */
export const TRASH_METADATA_KEY = "trash";

export type TrashMarker = {
  /** Set when this record was trashed as part of deleting `cascadeOf` (its parent). */
  cascadeOf?: string;
};

type TrashableRecord = SnapshotRecord & { metadata: Record<string, unknown> };

/** The record's trash marker, if any (absent on live records and direct deletes). */
export function trashMarker(record: { metadata: Record<string, unknown> }): TrashMarker | null {
  const raw = record.metadata[TRASH_METADATA_KEY];
  if (!raw || typeof raw !== "object") return null;
  const cascadeOf = (raw as { cascadeOf?: unknown }).cascadeOf;
  return { ...(typeof cascadeOf === "string" ? { cascadeOf } : {}) };
}

/** The parent id this record was cascade-trashed under, if any. */
export function trashCascadeOf(record: { metadata: Record<string, unknown> }): string | undefined {
  return trashMarker(record)?.cascadeOf;
}

/** Copy of `record` tombstoned at `deletedAt` (+ the cascade marker when given). */
export function withTombstone<T extends TrashableRecord>(record: T, deletedAt: string, cascadeOf?: string): T {
  const metadata = cascadeOf
    ? { ...record.metadata, [TRASH_METADATA_KEY]: { cascadeOf } }
    : record.metadata;
  return { ...record, updatedAt: deletedAt, deletedAt, metadata };
}

/** Copy of `record` restored to LIVE: tombstone + trash marker stripped. */
export function withoutTombstone<T extends TrashableRecord>(record: T, restoredAt: string): T {
  const metadata = { ...record.metadata };
  delete metadata[TRASH_METADATA_KEY];
  const restored = { ...record, updatedAt: restoredAt, metadata };
  delete (restored as { deletedAt?: string }).deletedAt;
  return restored;
}
