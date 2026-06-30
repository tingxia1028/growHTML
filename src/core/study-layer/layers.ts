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

// The built-in stage layers (预习 / 学习 / 复习 / 拓展) — a fixed lens axis offered on
// every source. Like the owned layer, they are pre-named layer records created lazily
// the first time the switcher lists a source's layers. Order is stable (0..3) so the
// switcher always shows them in the same sequence. "复习" here is purely an organizing
// filter (no scheduling/SRS — that is out of scope).
const PRESET_STAGES: ReadonlyArray<{ title: string; order: number }> = [
  { title: "预习", order: 0 },
  { title: "学习", order: 1 },
  { title: "复习", order: 2 },
  { title: "拓展", order: 3 }
];

// Create the four preset stage layers for a source on demand. Idempotent: a stage that
// already exists (same role:"preset" + localSourceId + title) is reused, so this is safe
// to call on every layer-list. Mirrors ensureOwnedLayer's construction.
export async function ensurePresetLayers(vault: StudyVault, source: SourceRecord): Promise<StudyLayerRecord[]> {
  const existing = (await vault.stores.layers.list()).filter(
    (layer) => layer.role === "preset" && layer.localSourceId === source.id
  );
  const byTitle = new Map(existing.map((layer) => [layer.title, layer]));

  const stages: StudyLayerRecord[] = [];
  for (const stage of PRESET_STAGES) {
    const found = byTitle.get(stage.title);
    if (found) {
      stages.push(found);
      continue;
    }
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
      title: stage.title,
      visibility: "private",
      importMode: "owned",
      enabled: true,
      role: "preset",
      order: stage.order
    });
    await vault.stores.layers.upsert(layer);
    stages.push(layer);
  }
  return stages;
}

// The per-source "Imported" PARENT layer — a container that imported `.studypack`
// layers nest under in the Layer Lens tree (spec §8.2: hierarchy is import-driven). It
// is a presentation-only grouping: it owns NO anchors/notes itself, so it never affects
// the enabled-OR filter (membership stays per LEAF layer); its `enabled` only drives the
// Lens cascade + count roll-up. Created lazily on the first import, idempotent (matched
// by role:"shared" + importMode:"imported" + the sentinel title + no parentId).
export const IMPORTED_PARENT_TITLE = "导入图层";

export async function ensureImportedParent(vault: StudyVault, source: SourceRecord): Promise<StudyLayerRecord> {
  const existing = (await vault.stores.layers.list()).find(
    (layer) =>
      layer.localSourceId === source.id &&
      layer.role === "shared" &&
      !layer.parentId &&
      layer.title === IMPORTED_PARENT_TITLE
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
    title: IMPORTED_PARENT_TITLE,
    visibility: "private",
    importMode: "imported",
    enabled: true,
    role: "shared",
    order: 100
  });
  await vault.stores.layers.upsert(layer);
  return layer;
}

// Create a user-defined ("custom") layer over a source. Used by the layer-manager
// create action. Mirrors ensureOwnedLayer but stamps role:"custom" and the optional
// presentation fields (color/order) the manager supplies.
export async function createCustomLayer(
  vault: StudyVault,
  source: SourceRecord,
  opts: { title: string; color?: string; order?: number }
): Promise<StudyLayerRecord> {
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
    title: opts.title,
    visibility: "private",
    importMode: "owned",
    enabled: true,
    role: "custom",
    color: opts.color,
    order: opts.order
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
    // Idempotent: a note that already has membership is left alone.
    if (note.layerIds.length > 0) continue;
    // Legacy single-membership note -> wrap its id; else (no layer yet) fall back to
    // the source's owned layer. Notes with no sourceId stay untouched (nothing to
    // bind them to). The deprecated single `layerId` is dropped on this rewrite.
    const layerIds = note.layerId
      ? [note.layerId]
      : note.sourceId
        ? [(await ownedFor(note.sourceId))?.id].filter((id): id is string => Boolean(id))
        : [];
    if (layerIds.length === 0) continue;
    const { layerId: _legacyLayerId, ...rest } = note;
    await vault.stores.notes.upsert({ ...rest, layerIds, updatedAt: new Date().toISOString() });
    notes += 1;
  }

  return { layers: ownedBySource.size, anchors, notes };
}
