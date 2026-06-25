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
    expect(note.layerId).toBe(anchor.layerId);

    const layers = (await request(app).get(`/api/sources/${source.id}/layers`).expect(200)).body.layers;
    expect(layers).toHaveLength(1);
    expect(layers[0].importMode).toBe("owned");
    expect(layers[0].id).toBe(anchor.layerId);
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

  it("hides anchors on a disabled layer (and keeps anchors on enabled layers)", async () => {
    const { source, anchor } = await seedSourceWithAnchorAndNote();

    let anchors = (await request(app).get(`/api/sources/${source.id}/anchors`).expect(200)).body.anchors;
    expect(anchors.map((a: { id: string }) => a.id)).toContain(anchor.id);

    await request(app).patch(`/api/layers/${anchor.layerId}`).send({ enabled: false }).expect(200);

    anchors = (await request(app).get(`/api/sources/${source.id}/anchors`).expect(200)).body.anchors;
    expect(anchors.map((a: { id: string }) => a.id)).not.toContain(anchor.id);
  });
});
