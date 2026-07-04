import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openVault, type StudyVault } from "../core/vault";
import { createApp } from "./app";

let tempDir = "";
let vault: StudyVault;
let app: ReturnType<typeof createApp>;

// No hand-written study-ids: the /api/sources/html route injects its own (prefix
// "html"), which is exactly what an imported anchor must re-realize against.
const SOURCE_HTML = "<article><p>The render thread submits commands.</p></article>";

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-layer-api-"));
  vault = await openVault({ rootDir: tempDir });
  app = createApp({ vault });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function seedSourceWithAnchorAndNote() {
  const created = await request(app)
    .post("/api/sources/html")
    .send({ title: "Render Thread", content: SOURCE_HTML })
    .expect(201);
  const source = created.body.source;
  // The locally-injected study-id for the paragraph (what a real capture would use).
  const studyId: string = created.body.injected.ids[0];

  const anchor = (
    await request(app)
      .post("/api/anchors")
      .send({
        sourceId: source.id,
        anchorKind: "html_selection",
        studyId,
        quote: "render thread submits commands",
        contextBefore: "The "
      })
      .expect(201)
  ).body.anchor;

  const note = (
    await request(app)
      .post("/api/notes")
      .send({ sourceId: source.id, anchorIds: [anchor.id], contentType: "markdown", content: "my note" })
      .expect(201)
  ).body.note;

  return { source, anchor, note, studyId };
}

describe("study layer API", () => {
  it("stamps an owned layer onto new anchors + notes and lists it", async () => {
    const { source, anchor, note } = await seedSourceWithAnchorAndNote();
    expect(anchor.layerId).toMatch(/^layer_/);
    // The note's MULTI-membership includes the source's owned layer (anchor.layerId).
    expect(note.layerIds).toEqual([anchor.layerId]);

    // Listing a source's layers now lazily creates the owned layer + the four preset
    // stages (预习/学习/复习/拓展). The owned layer is the one our anchor/note joined.
    const layers = (await request(app).get(`/api/sources/${source.id}/layers`).expect(200)).body.layers;
    const owned = layers.filter((l: { importMode: string; role?: string }) => l.importMode === "owned" && !l.role);
    expect(owned).toHaveLength(1);
    expect(owned[0].id).toBe(anchor.layerId);
    const presets = layers.filter((l: { role?: string }) => l.role === "preset");
    expect(presets.map((l: { title: string }) => l.title).sort()).toEqual(["复习", "学习", "拓展", "预习"]);
    expect(presets.every((l: { parentId?: string }) => l.parentId === owned[0].id)).toBe(true);
  });

  it("exports a layer to a portable pack with local realizations stripped", async () => {
    const { anchor } = await seedSourceWithAnchorAndNote();
    const pack = (await request(app).post(`/api/layers/${anchor.layerId}/export`).expect(200)).body.pack;

    expect(pack.anchors).toHaveLength(1);
    expect(pack.anchors[0].quote).toBe("render thread submits commands");
    // portable: no studyId / selector / sourceId leak
    expect(pack.anchors[0].studyId).toBeUndefined();
    expect(pack.anchors[0].selector).toBeUndefined();
    expect(pack.anchors[0].sourceId).toBeUndefined();
    expect(pack.sourceFingerprint.contentHash).toBeTruthy();
    expect(pack.notes).toHaveLength(1);
    expect(pack.notes[0].anchorRefs).toEqual([pack.anchors[0].refId]);
  });

  it("previews then commits an import, re-locating the anchor against the local source", async () => {
    const { anchor, studyId } = await seedSourceWithAnchorAndNote();
    const pack = (await request(app).post(`/api/layers/${anchor.layerId}/export`).expect(200)).body.pack;

    const preview = (await request(app).post("/api/layers/import/preview").send({ pack }).expect(200)).body.preview;
    expect(preview.matchedBy).toBe("contentHash");
    expect(preview.stats).toEqual({ matched: 1, fuzzy: 0, unmatched: 0 });

    const result = (await request(app).post("/api/layers/import/commit").send({ pack }).expect(201)).body.result;
    expect(result.createdAnchors).toBe(1);
    expect(result.importedNotes).toBe(1);
    expect(result.stats.matched).toBe(1);
    expect(result.layerId).toMatch(/^layer_/);

    // The imported layer's anchor was re-realized with a LOCAL study-id + matchStatus.
    const imported = (await vault.stores.anchors.list()).find((a) => a.layerId === result.layerId);
    expect(imported?.anchorKind).toBe("html_selection");
    expect(imported?.matchStatus).toBe("matched");
    // Re-realized against the importer's OWN injected study-id, not the author's.
    if (imported?.anchorKind === "html_selection") expect(imported.studyId).toBe(studyId);
  });

  it("nests an imported layer under the per-source 'Imported' parent (R7 hierarchy)", async () => {
    const { source, anchor } = await seedSourceWithAnchorAndNote();
    const pack = (await request(app).post(`/api/layers/${anchor.layerId}/export`).expect(200)).body.pack;

    const result = (await request(app).post("/api/layers/import/commit").send({ pack }).expect(201)).body.result;

    const layers = (await request(app).get(`/api/sources/${source.id}/layers`).expect(200)).body
      .layers as Array<{ id: string; title: string; role?: string; importMode: string; parentId?: string }>;

    // A single per-source "Imported" parent (role:shared, no parentId) was created…
    const parents = layers.filter((l) => l.title === "导入图层" && l.role === "shared" && !l.parentId);
    expect(parents).toHaveLength(1);
    // …and the imported layer hangs under it.
    const imported = layers.find((l) => l.id === result.layerId)!;
    expect(imported.parentId).toBe(parents[0].id);

    // Idempotent: a SECOND import reuses the same parent (not a duplicate).
    const result2 = (await request(app).post("/api/layers/import/commit").send({ pack }).expect(201)).body.result;
    const layers2 = (await request(app).get(`/api/sources/${source.id}/layers`).expect(200)).body
      .layers as Array<{ id: string; title: string; role?: string; parentId?: string }>;
    expect(layers2.filter((l) => l.title === "导入图层" && !l.parentId)).toHaveLength(1);
    const imported2 = layers2.find((l) => l.id === result2.layerId)!;
    expect(imported2.parentId).toBe(parents[0].id);
  });

  it("hides anchors on a disabled layer (and keeps anchors on enabled layers)", async () => {
    const { source, anchor } = await seedSourceWithAnchorAndNote();

    let anchors = (await request(app).get(`/api/sources/${source.id}/anchors`).expect(200)).body.anchors;
    expect(anchors.map((a: { id: string }) => a.id)).toContain(anchor.id);

    await request(app).patch(`/api/layers/${anchor.layerId}`).send({ enabled: false }).expect(200);

    anchors = (await request(app).get(`/api/sources/${source.id}/anchors`).expect(200)).body.anchors;
    expect(anchors.map((a: { id: string }) => a.id)).not.toContain(anchor.id);
  });

  // Fetch a source's layers, returning the owned layer + a title→layer map of the
  // preset stages (lazily created the first time layers are listed).
  async function listLayers(sourceId: string) {
    const layers = (await request(app).get(`/api/sources/${sourceId}/layers`).expect(200)).body
      .layers as Array<{ id: string; title: string; importMode: string; role?: string; parentId?: string }>;
    const owned = layers.find((l) => l.importMode === "owned" && !l.role)!;
    const presetByTitle = new Map(layers.filter((l) => l.role === "preset").map((l) => [l.title, l]));
    return { layers, owned, presetByTitle };
  }

  it("filters the note list by OR over enabled layers", async () => {
    const { source, note } = await seedSourceWithAnchorAndNote();
    const { owned, presetByTitle } = await listLayers(source.id);
    const review = presetByTitle.get("复习")!;

    // Add the note to a second layer (复习). It now lives in [owned, 复习].
    await request(app).patch(`/api/notes/${note.id}`).send({ layerIds: [owned.id, review.id] }).expect(200);

    const notesFor = async (enabledLayerIds?: string) => {
      const url = `/api/sources/${source.id}/notes${enabledLayerIds ? `?enabledLayerIds=${enabledLayerIds}` : ""}`;
      return (await request(app).get(url).expect(200)).body.notes as Array<{ id: string }>;
    };

    // Disable owned (via the stored toggle); the note still shows because 复习 is enabled.
    await request(app).patch(`/api/layers/${owned.id}`).send({ enabled: false }).expect(200);
    expect((await notesFor()).map((n) => n.id)).toContain(note.id);

    // Disable 复习 too → both of the note's layers off → hidden.
    await request(app).patch(`/api/layers/${review.id}`).send({ enabled: false }).expect(200);
    expect((await notesFor()).map((n) => n.id)).not.toContain(note.id);

    // Re-enable 复习 → reappears (OR rule).
    await request(app).patch(`/api/layers/${review.id}`).send({ enabled: true }).expect(200);
    expect((await notesFor()).map((n) => n.id)).toContain(note.id);

    // Explicit enabledLayerIds query param overrides the stored toggle: only owned in
    // the set → note still shows (owned ∈ its layers), but a foreign id alone hides it.
    expect((await notesFor(owned.id)).map((n) => n.id)).toContain(note.id);
    expect((await notesFor("layer_nonexistent")).map((n) => n.id)).not.toContain(note.id);
  });

  it("keeps a note with EMPTY membership visible even when every layer is disabled", async () => {
    const { source, note } = await seedSourceWithAnchorAndNote();
    const { layers } = await listLayers(source.id);

    // Clear the note's membership entirely (layerIds: []) — the "never orphan" guarantee.
    const cleared = (await request(app).patch(`/api/notes/${note.id}`).send({ layerIds: [] }).expect(200)).body.note;
    expect(cleared.layerIds).toEqual([]);

    const notesFor = async () =>
      ((await request(app).get(`/api/sources/${source.id}/notes`).expect(200)).body.notes as Array<{ id: string }>).map(
        (n) => n.id
      );

    // Disable every layer over the source; the empty-membership note must still show.
    for (const layer of layers) {
      await request(app).patch(`/api/layers/${layer.id}`).send({ enabled: false }).expect(200);
    }
    expect(await notesFor()).toContain(note.id);

    // An explicit (empty-ish) filter param must not hide it either.
    const filtered = (await request(app).get(`/api/sources/${source.id}/notes?enabledLayerIds=layer_none`).expect(200)).body
      .notes as Array<{ id: string }>;
    expect(filtered.map((n) => n.id)).toContain(note.id);
  });

  it("applies the OR visibility rule across 3+ layers (visible while any one stays enabled)", async () => {
    const { source, note } = await seedSourceWithAnchorAndNote();
    const { owned, presetByTitle } = await listLayers(source.id);
    const preview = presetByTitle.get("预习")!;
    const study = presetByTitle.get("学习")!;
    const review = presetByTitle.get("复习")!;

    // Put the note in FOUR layers at once.
    await request(app)
      .patch(`/api/notes/${note.id}`)
      .send({ layerIds: [owned.id, preview.id, study.id, review.id] })
      .expect(200);

    const visible = async () =>
      ((await request(app).get(`/api/sources/${source.id}/notes`).expect(200)).body.notes as Array<{ id: string }>)
        .map((n) => n.id)
        .includes(note.id);

    // Disable layers one-by-one; the note stays visible until the LAST one goes off.
    await request(app).patch(`/api/layers/${owned.id}`).send({ enabled: false }).expect(200);
    expect(await visible()).toBe(true);
    await request(app).patch(`/api/layers/${preview.id}`).send({ enabled: false }).expect(200);
    expect(await visible()).toBe(true);
    await request(app).patch(`/api/layers/${study.id}`).send({ enabled: false }).expect(200);
    expect(await visible()).toBe(true);
    await request(app).patch(`/api/layers/${review.id}`).send({ enabled: false }).expect(200);
    expect(await visible()).toBe(false);

    // Re-enabling just one of the four brings it back (OR holds for N≥3).
    await request(app).patch(`/api/layers/${study.id}`).send({ enabled: true }).expect(200);
    expect(await visible()).toBe(true);
  });

  it("cascade-strips a deleted custom layer from notes so a note-only-in-it never orphans", async () => {
    const { source, note } = await seedSourceWithAnchorAndNote();
    const { owned } = await listLayers(source.id);

    // A custom layer that becomes the note's SOLE membership.
    const custom = (
      await request(app).post(`/api/sources/${source.id}/layers`).send({ title: "重点" }).expect(201)
    ).body.layer;
    await request(app).patch(`/api/notes/${note.id}`).send({ layerIds: [custom.id] }).expect(200);

    // Disable the owned layer so ONLY the custom layer could be keeping the note visible.
    await request(app).patch(`/api/layers/${owned.id}`).send({ enabled: false }).expect(200);

    const notesFor = async () =>
      ((await request(app).get(`/api/sources/${source.id}/notes`).expect(200)).body.notes as Array<{ id: string }>).map(
        (n) => n.id
      );
    expect(await notesFor()).toContain(note.id);

    // Delete the custom layer. The note must NOT vanish: its membership collapses to []
    // (always visible), rather than pointing at a now-nonexistent layer.
    await request(app).delete(`/api/layers/${custom.id}`).expect(200);

    const reloaded = (await vault.stores.notes.get(note.id))!;
    expect(reloaded.layerIds).toEqual([]);
    expect(await notesFor()).toContain(note.id);
  });

  it("derives anchor painting: an anchor paints while EITHER of its notes' layers is enabled", async () => {
    const { source, anchor, note } = await seedSourceWithAnchorAndNote();
    const { owned, presetByTitle } = await listLayers(source.id);
    const review = presetByTitle.get("复习")!;

    // A SECOND note on the same anchor, living in 复习 only.
    const note2 = (
      await request(app)
        .post("/api/notes")
        .send({ sourceId: source.id, anchorIds: [anchor.id], layerIds: [review.id], contentType: "markdown", content: "review note" })
        .expect(201)
    ).body.note;
    expect(note2.layerIds).toEqual([review.id]);

    const paintedIds = async () =>
      ((await request(app).get(`/api/sources/${source.id}/anchors`).expect(200)).body.anchors as Array<{ id: string }>).map(
        (a) => a.id
      );

    // Disable owned (note1's layer) — the anchor still paints via note2 in 复习.
    await request(app).patch(`/api/layers/${owned.id}`).send({ enabled: false }).expect(200);
    expect(await paintedIds()).toContain(anchor.id);

    // Disable 复习 too — now NO note on the anchor is in an enabled layer → not painted.
    await request(app).patch(`/api/layers/${review.id}`).send({ enabled: false }).expect(200);
    expect(await paintedIds()).not.toContain(anchor.id);

    // note in [owned] also exists; re-enabling owned repaints.
    await request(app).patch(`/api/layers/${owned.id}`).send({ enabled: true }).expect(200);
    expect(await paintedIds()).toContain(anchor.id);
    void note;
  });

  it("round-trips multi-membership through export → import (notes whose layerIds include the layer)", async () => {
    const { source, anchor, note } = await seedSourceWithAnchorAndNote();
    const { owned, presetByTitle } = await listLayers(source.id);
    const review = presetByTitle.get("复习")!;

    // Put the note in BOTH owned and 复习, then export the 复习 layer.
    await request(app).patch(`/api/notes/${note.id}`).send({ layerIds: [owned.id, review.id] }).expect(200);
    const pack = (await request(app).post(`/api/layers/${review.id}/export`).expect(200)).body.pack;
    expect(pack.notes).toHaveLength(1);
    // The anchor travels because it is DERIVED from the layer's note (anchor.layerId is
    // the owned layer, not 复习 — proving membership is note-driven now).
    expect(pack.anchors).toHaveLength(1);
    expect(pack.notes[0].anchorRefs).toEqual([pack.anchors[0].refId]);

    // Import into a FRESH vault that has its own copy of the same source.
    const tempDir2 = await mkdtemp(path.join(os.tmpdir(), "study-vault-import-"));
    try {
      const vault2 = await openVault({ rootDir: tempDir2 });
      const app2 = createApp({ vault: vault2 });
      await request(app2).post("/api/sources/html").send({ title: "Render Thread", content: SOURCE_HTML }).expect(201);

      const result = (await request(app2).post("/api/layers/import/commit").send({ pack }).expect(201)).body.result;
      expect(result.importedNotes).toBe(1);

      // The imported layer is role:"shared"; the imported note's layerIds is [importedLayer].
      const importedLayer = (await vault2.stores.layers.get(result.layerId))!;
      expect(importedLayer.role).toBe("shared");
      const importedNote = (await vault2.stores.notes.list()).find((n) => n.layerIds.includes(result.layerId));
      expect(importedNote?.layerIds).toEqual([result.layerId]);
      expect(importedNote?.anchorIds).toHaveLength(1);
    } finally {
      await rm(tempDir2, { recursive: true, force: true });
    }
    void anchor;
  });

  it("creates a custom layer and refuses to delete a non-custom (preset/owned) layer", async () => {
    const created = await request(app)
      .post("/api/sources/html")
      .send({ title: "Custom Layer Doc", content: SOURCE_HTML })
      .expect(201);
    const source = created.body.source;
    const { owned, presetByTitle } = await listLayers(source.id);

    // Create a custom layer with color + order.
    const custom = (
      await request(app).post(`/api/sources/${source.id}/layers`).send({ title: "重点", color: "#f00", order: 9 }).expect(201)
    ).body.layer;
    expect(custom.role).toBe("custom");
    expect(custom.color).toBe("#f00");
    expect(custom.order).toBe(9);
    expect(custom.parentId).toBe(owned.id);

    // It shows up in the list.
    const after = (await request(app).get(`/api/sources/${source.id}/layers`).expect(200)).body.layers;
    expect(after.map((l: { id: string }) => l.id)).toContain(custom.id);

    // Deleting the custom layer succeeds; deleting a preset / owned layer is refused (409).
    await request(app).delete(`/api/layers/${custom.id}`).expect(200);
    await request(app).delete(`/api/layers/${owned.id}`).expect(409);
    await request(app).delete(`/api/layers/${presetByTitle.get("预习")!.id}`).expect(409);
  });

  it("POST /api/notes: defaults membership to the owned layer, honors explicit layerIds", async () => {
    const created = await request(app)
      .post("/api/sources/html")
      .send({ title: "Default Membership Doc", content: SOURCE_HTML })
      .expect(201);
    const source = created.body.source;

    // No layerIds + a sourceId → defaults to [owned].
    const noteA = (
      await request(app).post("/api/notes").send({ sourceId: source.id, contentType: "markdown", content: "a" }).expect(201)
    ).body.note;
    const { owned, presetByTitle } = await listLayers(source.id);
    expect(noteA.layerIds).toEqual([owned.id]);

    // Explicit layerIds are used verbatim.
    const study = presetByTitle.get("学习")!;
    const noteB = (
      await request(app)
        .post("/api/notes")
        .send({ sourceId: source.id, layerIds: [study.id], contentType: "markdown", content: "b" })
        .expect(201)
    ).body.note;
    expect(noteB.layerIds).toEqual([study.id]);

    // PATCH moves membership (full replace).
    const moved = (await request(app).patch(`/api/notes/${noteB.id}`).send({ layerIds: [owned.id] }).expect(200)).body.note;
    expect(moved.layerIds).toEqual([owned.id]);
  });

  // F7a: the preset stage axis is SEEDED FROM THE ACTIVE KIT, not hardcoded in core.
  it("seeds the stage axis from the active kit: textbook default → 4 stages, Core → none", async () => {
    // A) Default source: no activeKitIds metadata → server falls back to the textbook kit
    //    → the 4 preset stages appear (back-compat, but now KIT-sourced).
    const a = await request(app).post("/api/sources/html").send({ title: "Default Kit Doc", content: SOURCE_HTML }).expect(201);
    const layersA = (await request(app).get(`/api/sources/${a.body.source.id}/layers`).expect(200)).body
      .layers as Array<{ id: string; title: string; role?: string; importMode: string; parentId?: string }>;
    expect(layersA.filter((l) => l.role === "preset").map((l) => l.title).sort()).toEqual(["复习", "学习", "拓展", "预习"]);
    const ownedA = layersA.find((l) => l.importMode === "owned" && !l.role)!;
    expect(ownedA).toBeTruthy();
    expect(layersA.filter((l) => l.role === "preset").every((l) => l.parentId === ownedA.id)).toBe(true);

    // B) Force Core (activeKitIds: []) → no kit imposes an axis → NO preset stages, owned still present.
    const b = await request(app).post("/api/sources/html").send({ title: "Core Doc", content: SOURCE_HTML }).expect(201);
    await request(app).patch(`/api/sources/${b.body.source.id}`).send({ metadata: { activeKitIds: [] } }).expect(200);
    const layersB = (await request(app).get(`/api/sources/${b.body.source.id}/layers`).expect(200)).body
      .layers as Array<{ title: string; role?: string; importMode: string }>;
    expect(layersB.filter((l) => l.role === "preset")).toHaveLength(0);
    expect(layersB.some((l) => l.importMode === "owned" && !l.role)).toBe(true);
  });

  it("F7a migration: preset layers already created survive after the source drops the kit axis", async () => {
    const created = await request(app).post("/api/sources/html").send({ title: "Migrate Doc", content: SOURCE_HTML }).expect(201);
    const source = created.body.source;

    // First list (textbook default) lazily creates the 4 preset stages.
    const first = (await request(app).get(`/api/sources/${source.id}/layers`).expect(200)).body
      .layers as Array<{ id: string; role?: string }>;
    const presetIds = first.filter((l) => l.role === "preset").map((l) => l.id).sort();
    expect(presetIds).toHaveLength(4);

    // Switch the source to Core (no axis) and re-list: the already-created preset layers
    // must be PRESERVED (they may hold notes) — the seeder only stops creating new ones.
    await request(app).patch(`/api/sources/${source.id}`).send({ metadata: { activeKitIds: [] } }).expect(200);
    const second = (await request(app).get(`/api/sources/${source.id}/layers`).expect(200)).body
      .layers as Array<{ id: string; role?: string }>;
    expect(second.filter((l) => l.role === "preset").map((l) => l.id).sort()).toEqual(presetIds);
  });
});
