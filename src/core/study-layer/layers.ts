import { createEntityId } from "../ids";
import { studyLayerSchema, type SourceRecord, type StudyLayerRecord } from "../schema";
import type { StudyVault } from "../vault";
import { fingerprintForSource } from "./fingerprint";

// The "owned" layer is where a user's own annotations live — exactly one per source.
// Created lazily the first time an anchor/note needs it (new capture, or migration).
export async function ensureOwnedLayer(vault: StudyVault, source: SourceRecord): Promise<StudyLayerRecord> {
  const existing = (await vault.stores.layers.list()).find(
    (layer) => layer.importMode === "owned" && layer.localSourceId === source.id
  );
  if (existing) return existing;

  const now = new Date().toISOString();
  const layer = studyLayerSchema.parse({
    id: createEntityId("layer"),
    type: "layer",
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: "user",
    sourceFingerprint: fingerprintForSource(source),
    localSourceId: source.id,
    title: source.title,
    visibility: "private",
    importMode: "owned",
    enabled: true
  });
  await vault.stores.layers.upsert(layer);
  return layer;
}

export type StudyLayerMigrationStats = { layers: number; anchors: number; notes: number };

// Backfill: assign every pre-layer anchor/note to its source's owned layer. Cheap to
// run repeatedly (idempotent — records that already have a layerId are skipped), so
// it can run on every server boot. Notes with no sourceId are left untouched (an
// owned layer is per-source; there is nothing to bind them to).
export async function migrateStudyLayers(vault: StudyVault): Promise<StudyLayerMigrationStats> {
  const sources = await vault.stores.sources.list();
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const ownedBySource = new Map<string, StudyLayerRecord>();

  async function ownedFor(sourceId: string): Promise<StudyLayerRecord | null> {
    const cached = ownedBySource.get(sourceId);
    if (cached) return cached;
    const source = sourceById.get(sourceId);
    if (!source) return null;
    const layer = await ensureOwnedLayer(vault, source);
    ownedBySource.set(sourceId, layer);
    return layer;
  }

  let anchors = 0;
  for (const anchor of await vault.stores.anchors.list()) {
    if (anchor.layerId) continue;
    const layer = await ownedFor(anchor.sourceId);
    if (!layer) continue;
    await vault.stores.anchors.upsert({ ...anchor, layerId: layer.id, updatedAt: new Date().toISOString() });
    anchors += 1;
  }

  let notes = 0;
  for (const note of await vault.stores.notes.list()) {
    if (note.layerId || !note.sourceId) continue;
    const layer = await ownedFor(note.sourceId);
    if (!layer) continue;
    await vault.stores.notes.upsert({ ...note, layerId: layer.id, updatedAt: new Date().toISOString() });
    notes += 1;
  }

  return { layers: ownedBySource.size, anchors, notes };
}
