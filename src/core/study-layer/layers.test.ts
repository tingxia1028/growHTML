import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openVault, type StudyVault } from "../vault";
import { anchorSchema, noteSchema } from "../schema";
import { createEntityId } from "../ids";
import { ingestHtmlSource } from "../store/sources";
import { ensureOwnedLayer, migrateStudyLayers } from "./layers";

let tempDir = "";
let vault: StudyVault;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-layers-"));
  vault = await openVault({ rootDir: tempDir });
});

afterEach(async () => {
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
