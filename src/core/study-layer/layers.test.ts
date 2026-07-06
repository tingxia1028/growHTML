import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openVault, type StudyVault } from "../vault";
import { anchorSchema, noteSchema, studyLayerSchema } from "../schema";
import { createEntityId } from "../ids";
import { ingestHtmlSource } from "../store/sources";
import { ensureOwnedLayer, ensurePresetStages, migrateStudyLayers } from "./layers";

let tempDir = "";
let vault: StudyVault;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-layers-"));
  vault = await openVault({ rootDir: tempDir });
});

afterEach(async () => {
  // STORE-SQL Stage-3: release sqlite handles before rm (no-op on jsonl).
  await vault?.close();
  await rm(tempDir, { recursive: true, force: true });
});

const now = "2026-06-25T00:00:00.000Z";

async function seedLegacyData() {
  const source = await ingestHtmlSource(vault, {
    title: "Render Thread",
    content: '<p data-study-id="p-1">The render thread submits commands.</p>'
  });
  // A pre-layer anchor + note (no layerId), written straight to the stores.
  const anchor = anchorSchema.parse({
    id: createEntityId("anchor"),
    type: "anchor",
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: "user",
    sourceId: source.id,
    anchorKind: "html_selection",
    studyId: "p-1",
    selector: '[data-study-id="p-1"]',
    quote: "render thread",
    contextBefore: "",
    contextAfter: ""
  });
  await vault.stores.anchors.upsert(anchor);
  const note = noteSchema.parse({
    id: createEntityId("note"),
    type: "note",
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: "user",
    sourceId: source.id,
    anchorIds: [anchor.id],
    conceptIds: [],
    contentType: "markdown",
    content: "note body",
    visibility: "private"
  });
  await vault.stores.notes.upsert(note);
  return { source, anchor, note };
}

describe("ensureOwnedLayer", () => {
  it("creates exactly one owned layer per source and reuses it", async () => {
    const source = await ingestHtmlSource(vault, { title: "Doc", content: "<p>hi</p>" });
    const a = await ensureOwnedLayer(vault, source);
    const b = await ensureOwnedLayer(vault, source);
    expect(a.id).toBe(b.id);
    expect(a.importMode).toBe("owned");
    expect(a.enabled).toBe(true);
    expect(a.localSourceId).toBe(source.id);
    expect(a.sourceFingerprint.contentHash).toBe(source.contentHash);
    expect(await vault.stores.layers.list()).toHaveLength(1);
  });
});

describe("ensurePresetStages (F7a: core takes an explicit stage list, no hardcoded taxonomy)", () => {
  const STAGES = [
    { title: "预习", order: 0 },
    { title: "学习", order: 1 },
    { title: "复习", order: 2 }
  ];

  it("creates the given stages as role:'preset' layers, once, and is idempotent on a second call", async () => {
    const source = await ingestHtmlSource(vault, { title: "Doc", content: "<p>hi</p>" });
    const owned = await ensureOwnedLayer(vault, source);
    const first = await ensurePresetStages(vault, source, STAGES);
    expect(first.map((l) => l.title)).toEqual(["预习", "学习", "复习"]);
    expect(first.map((l) => l.order)).toEqual([0, 1, 2]);
    expect(first.every((l) => l.role === "preset" && l.localSourceId === source.id)).toBe(true);
    expect(first.every((l) => l.parentId === owned.id)).toBe(true);

    const second = await ensurePresetStages(vault, source, STAGES);
    // Same records reused (same ids) — no duplicates written to the store.
    expect(second.map((l) => l.id)).toEqual(first.map((l) => l.id));
    expect((await vault.stores.layers.list()).filter((l) => l.role === "preset")).toHaveLength(3);
  });

  it("creates NOTHING for an empty stage list (a kit that imposes no stage axis)", async () => {
    const source = await ingestHtmlSource(vault, { title: "Doc", content: "<p>hi</p>" });
    expect(await ensurePresetStages(vault, source, [])).toEqual([]);
    expect((await vault.stores.layers.list()).filter((l) => l.role === "preset")).toHaveLength(0);
  });

  it("preserves a pre-existing preset layer of the same title (migration-safe: reuse, no duplicate)", async () => {
    const source = await ingestHtmlSource(vault, { title: "Doc", content: "<p>hi</p>" });
    const owned = await ensureOwnedLayer(vault, source);
    // Simulate a migrated vault where a preset "复习" layer already exists (may hold notes).
    const pre = await ensurePresetStages(vault, source, [{ title: "复习", order: 2 }]);
    const preId = pre[0].id;

    // A later call with the fuller axis reuses the existing 复习 and only adds the missing ones.
    const full = await ensurePresetStages(vault, source, STAGES);
    expect(full.find((l) => l.title === "复习")!.id).toBe(preId);
    const presets = (await vault.stores.layers.list()).filter((l) => l.role === "preset");
    expect(presets).toHaveLength(3);
    expect(presets.filter((l) => l.title === "复习")).toHaveLength(1); // reused, not re-created
    expect(presets.every((l) => l.parentId === owned.id)).toBe(true);
  });

  it("never deletes a stage the caller no longer lists (dropped stage keeps its layer)", async () => {
    const source = await ingestHtmlSource(vault, { title: "Doc", content: "<p>hi</p>" });
    await ensurePresetStages(vault, source, STAGES); // 预习 / 学习 / 复习
    // The active kit later drops 复习 → the caller passes a shorter list…
    const kept = await ensurePresetStages(vault, source, [
      { title: "预习", order: 0 },
      { title: "学习", order: 1 }
    ]);
    expect(kept.map((l) => l.title)).toEqual(["预习", "学习"]);
    // …but the previously-created 复习 layer is NOT removed (no auto-delete of note-holders).
    const presets = (await vault.stores.layers.list()).filter((l) => l.role === "preset");
    expect(presets.map((l) => l.title).sort()).toEqual(["复习", "学习", "预习"]);
  });

  it("backfills existing preset/custom layers under Mine even when the active kit lists no stages", async () => {
    const source = await ingestHtmlSource(vault, { title: "Doc", content: "<p>hi</p>" });
    const owned = await ensureOwnedLayer(vault, source);
    const createdAt = new Date().toISOString();
    const oldPreset = studyLayerSchema.parse({
      id: createEntityId("layer"),
      type: "layer",
      schemaVersion: 1,
      createdAt,
      updatedAt: createdAt,
      createdBy: "user",
      localSourceId: source.id,
      title: "复习",
      visibility: "private",
      importMode: "owned",
      enabled: true,
      role: "preset"
    });
    const oldCustom = studyLayerSchema.parse({
      ...oldPreset,
      id: createEntityId("layer"),
      title: "重点",
      role: "custom"
    });
    await vault.stores.layers.upsert(oldPreset);
    await vault.stores.layers.upsert(oldCustom);

    expect(await ensurePresetStages(vault, source, [])).toEqual([]);

    expect((await vault.stores.layers.get(oldPreset.id))?.parentId).toBe(owned.id);
    expect((await vault.stores.layers.get(oldCustom.id))?.parentId).toBe(owned.id);
  });
});

describe("migrateStudyLayers", () => {
  it("backfills layerId onto pre-layer anchors and notes (and is idempotent)", async () => {
    const { source, anchor, note } = await seedLegacyData();
    // Old records load fine (schema accepts missing layerId — backward compat).
    expect((await vault.stores.anchors.get(anchor.id))?.layerId).toBeUndefined();
    // A pre-multi note loads with an empty membership array.
    expect((await vault.stores.notes.get(note.id))?.layerIds).toEqual([]);

    const stats = await migrateStudyLayers(vault);
    expect(stats.anchors).toBe(1);
    expect(stats.notes).toBe(1);

    const layers = await vault.stores.layers.list();
    expect(layers).toHaveLength(1);
    const owned = layers[0];
    expect(owned.localSourceId).toBe(source.id);

    expect((await vault.stores.anchors.get(anchor.id))?.layerId).toBe(owned.id);
    // Notes are migrated to multi-membership: the owned layer joins layerIds.
    expect((await vault.stores.notes.get(note.id))?.layerIds).toEqual([owned.id]);

    // Running again touches nothing.
    const second = await migrateStudyLayers(vault);
    expect(second.anchors).toBe(0);
    expect(second.notes).toBe(0);
    expect(await vault.stores.layers.list()).toHaveLength(1);
  });

  it("wraps a legacy single layerId into layerIds", async () => {
    const { source } = await seedLegacyData();
    const owned = await ensureOwnedLayer(vault, source);
    // A note that still carries the deprecated single-membership field.
    const legacy = noteSchema.parse({
      id: createEntityId("note"),
      type: "note",
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: "user",
      sourceId: source.id,
      anchorIds: [],
      conceptIds: [],
      contentType: "markdown",
      content: "legacy single-layer note",
      visibility: "private",
      layerId: owned.id
    });
    await vault.stores.notes.upsert(legacy);
    expect((await vault.stores.notes.get(legacy.id))?.layerIds).toEqual([]);

    await migrateStudyLayers(vault);

    const migrated = await vault.stores.notes.get(legacy.id);
    expect(migrated?.layerIds).toEqual([owned.id]);
    expect(migrated?.layerId).toBeUndefined();
  });
});
