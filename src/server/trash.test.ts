// TRUST-3 回收站 (docs/design/data-trust.md §3) — soft-delete interception on the
// EXISTING DELETE routes (same API shape), the trash surfaces (list / restore /
// 永久删除 / 清空回收站), cascade + restore-conflict semantics, the 30d auto-purge
// (clock-injected), and the explicit backup/export choice (tombstones RIDE the
// verbatim full-vault zip; outward reads exclude them via the stores' live-only
// list()).

import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixtureHtmlBody } from "../core/fixtures/golden";
import { trashCascadeOf } from "../core/store/trash";
import { type StudyVault } from "../core/vault";
import { openTestVault } from "../core/testing/openTestVault";
import { createApp } from "./app";
import { createDataTrustService } from "./dataTrust";
import {
  createTrashPurgeScheduler,
  createTrashService,
  PURGE_ALL_CONFIRM_PHRASE,
  resolveTrashRetentionDays,
  TRASH_RETENTION_DAYS
} from "./trash";

const DAY_MS = 24 * 60 * 60 * 1000;

let tempDir = "";
let vault: StudyVault;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-trash-"));
  vault = await openTestVault({ rootDir: path.join(tempDir, "vault") });
  app = createApp({ vault, identityDir: path.join(tempDir, "identity") });
});

afterEach(async () => {
  vault?.close(); // STORE-SQL Stage-3: release sqlite .db handles before rm (Windows EBUSY). no-op on jsonl.
  await rm(tempDir, { recursive: true, force: true });
});

async function seedSource(title = "Trash Fixture") {
  const res = await request(app).post("/api/sources/html").send({ title, content: fixtureHtmlBody }).expect(201);
  return res.body.source as { id: string; title: string; path: string };
}

async function seedAnchor(sourceId: string, studyId = "p-render-thread", quote = "Render Thread submits rendering commands.") {
  const res = await request(app)
    .post("/api/anchors")
    .send({ sourceId, studyId, quote, contextBefore: "", contextAfter: "" })
    .expect(201);
  return res.body.anchor as { id: string };
}

async function seedNote(sourceId: string, content: string, anchorIds: string[] = [], layerIds?: string[]) {
  const res = await request(app)
    .post("/api/notes")
    .send({ sourceId, anchorIds, contentType: "markdown", content, ...(layerIds ? { layerIds } : {}) })
    .expect(201);
  return res.body.note as { id: string };
}

const fileExists = (absPath: string) =>
  access(absPath).then(
    () => true,
    () => false
  );

describe("TRUST-3 soft delete interception (same DELETE routes)", () => {
  it("DELETE /api/notes tombstones the note + orphan-cascades its anchor into the bin", async () => {
    const source = await seedSource();
    const anchor = await seedAnchor(source.id);
    const note = await seedNote(source.id, "note body", [anchor.id]);

    await request(app).delete(`/api/notes/${note.id}`).expect(200, { ok: true });

    // Excluded from every live read (list/search/painting)…
    expect((await request(app).get("/api/notes").expect(200)).body.notes).toEqual([]);
    expect((await request(app).get(`/api/sources/${source.id}/anchors`).expect(200)).body.anchors).toEqual([]);
    expect((await request(app).get("/api/search?q=note%20body").expect(200)).body.hits).toEqual([]);

    // …but NOT hard-deleted: both records sit in the bin, the anchor cascade-marked.
    const trashedNote = await vault.stores.notes.getAny(note.id);
    expect(trashedNote?.deletedAt).toBeTruthy();
    const trashedAnchor = await vault.stores.anchors.getAny(anchor.id);
    expect(trashedAnchor?.deletedAt).toBeTruthy();
    expect(trashCascadeOf(trashedAnchor!)).toBe(note.id);

    // The listing shows the note as a top-level row (no source row — the source is live).
    const listing = (await request(app).get("/api/trash").expect(200)).body;
    expect(listing.retentionDays).toBe(TRASH_RETENTION_DAYS);
    expect(listing.sources).toEqual([]);
    expect(listing.notes).toHaveLength(1);
    expect(listing.notes[0]).toMatchObject({
      id: note.id,
      contentType: "markdown",
      excerpt: "note body",
      sourceId: source.id,
      sourceTitle: source.title,
      sourceState: "live"
    });
    expect(listing.notes[0].purgeAt).toBe(
      new Date(Date.parse(listing.notes[0].deletedAt) + TRASH_RETENTION_DAYS * DAY_MS).toISOString()
    );

    // A second DELETE 404s — the note is no longer live (same contract as before).
    await request(app).delete(`/api/notes/${note.id}`).expect(404);
  });

  it("keeps an anchor LIVE when another live note still references it", async () => {
    const source = await seedSource();
    const anchor = await seedAnchor(source.id);
    const noteA = await seedNote(source.id, "note A", [anchor.id]);
    await seedNote(source.id, "note B", [anchor.id]);

    await request(app).delete(`/api/notes/${noteA.id}`).expect(200);

    expect((await vault.stores.anchors.get(anchor.id))?.deletedAt).toBeUndefined();
    const painted = (await request(app).get(`/api/sources/${source.id}/anchors`).expect(200)).body.anchors;
    expect(painted.map((a: { id: string }) => a.id)).toEqual([anchor.id]);
  });

  it("DELETE /api/sources tombstones the source + cascade-trashes notes/anchors/patches, KEEPING the stored file", async () => {
    const source = await seedSource();
    const anchor = await seedAnchor(source.id);
    const note = await seedNote(source.id, "cascade note", [anchor.id]);
    const patch = (
      await request(app)
        .post("/api/patches")
        .send({ sourceId: source.id, anchorId: anchor.id, action: "replace_selection", newContent: "x" })
        .expect(201)
    ).body.patch as { id: string };

    await request(app).delete(`/api/sources/${source.id}`).expect(200, { ok: true });
    await request(app).delete(`/api/sources/${source.id}`).expect(404); // not live anymore

    expect((await request(app).get("/api/sources").expect(200)).body.sources).toEqual([]);
    expect((await request(app).get("/api/notes").expect(200)).body.notes).toEqual([]);

    // Soft delete keeps the stored FILE (restore needs it); records are cascade-marked.
    expect(await fileExists(path.join(vault.paths.rootDir, source.path))).toBe(true);
    for (const [store, id] of [
      [vault.stores.notes, note.id],
      [vault.stores.anchors, anchor.id],
      [vault.stores.patches, patch.id]
    ] as const) {
      const record = await store.getAny(id);
      expect(record?.deletedAt).toBeTruthy();
      expect(trashCascadeOf(record!)).toBe(source.id);
    }

    // Listing: ONE source row with cascade counts; the cascaded note is NOT a top-level row.
    const listing = (await request(app).get("/api/trash").expect(200)).body;
    expect(listing.notes).toEqual([]);
    expect(listing.sources).toHaveLength(1);
    expect(listing.sources[0]).toMatchObject({
      id: source.id,
      title: source.title,
      sourceType: "html",
      noteCount: 1,
      anchorCount: 1
    });
  });
});

describe("TRUST-3 restore (relationship reattachment + conflicts)", () => {
  it("restores a note roundtrip: back in lists, its anchor repaints, markers stripped", async () => {
    const source = await seedSource();
    const anchor = await seedAnchor(source.id);
    const note = await seedNote(source.id, "restore me", [anchor.id]);
    await request(app).delete(`/api/notes/${note.id}`).expect(200);

    const result = (await request(app).post(`/api/trash/${note.id}/restore`).expect(200)).body;
    expect(result).toMatchObject({ ok: true, restored: { type: "note", id: note.id }, cascade: { anchors: 1 } });

    const notes = (await request(app).get("/api/notes").expect(200)).body.notes;
    expect(notes.map((n: { id: string }) => n.id)).toEqual([note.id]);
    const painted = (await request(app).get(`/api/sources/${source.id}/anchors`).expect(200)).body.anchors;
    expect(painted.map((a: { id: string }) => a.id)).toEqual([anchor.id]);

    // Tombstone + cascade marker are gone; the bin is empty again.
    const restoredAnchor = await vault.stores.anchors.get(anchor.id);
    expect(restoredAnchor?.deletedAt).toBeUndefined();
    expect(trashCascadeOf(restoredAnchor!)).toBeUndefined();
    const listing = (await request(app).get("/api/trash").expect(200)).body;
    expect(listing.sources).toEqual([]);
    expect(listing.notes).toEqual([]);
  });

  it("restores a source WITH its cascade — but not notes the user had deleted beforehand", async () => {
    const source = await seedSource();
    const anchor = await seedAnchor(source.id);
    const direct = await seedNote(source.id, "deleted directly first");
    const cascaded = await seedNote(source.id, "rides the source cascade", [anchor.id]);

    await request(app).delete(`/api/notes/${direct.id}`).expect(200); // direct delete FIRST
    await request(app).delete(`/api/sources/${source.id}`).expect(200); // then the source

    const result = (await request(app).post(`/api/trash/${source.id}/restore`).expect(200)).body;
    expect(result).toMatchObject({
      ok: true,
      restored: { type: "source", id: source.id },
      cascade: { notes: 1, anchors: 1, patches: 0 }
    });

    // Source + cascaded note/anchor live again; the direct-deleted note stays in the bin.
    expect((await request(app).get("/api/sources").expect(200)).body.sources).toHaveLength(1);
    const notes = (await request(app).get("/api/notes").expect(200)).body.notes;
    expect(notes.map((n: { id: string }) => n.id)).toEqual([cascaded.id]);
    const listing = (await request(app).get("/api/trash").expect(200)).body;
    expect(listing.sources).toEqual([]);
    expect(listing.notes.map((n: { id: string }) => n.id)).toEqual([direct.id]);
    expect(listing.notes[0].sourceState).toBe("live");

    // …and now the direct-deleted note restores cleanly onto its live source.
    await request(app).post(`/api/trash/${direct.id}/restore`).expect(200);
    expect((await request(app).get("/api/notes").expect(200)).body.notes).toHaveLength(2);
  });

  it("409s when restoring a note whose source is in the bin (restore the source first)", async () => {
    const source = await seedSource();
    const note = await seedNote(source.id, "child of a trashed source");
    await request(app).delete(`/api/notes/${note.id}`).expect(200);
    await request(app).delete(`/api/sources/${source.id}`).expect(200);

    const conflict = await request(app).post(`/api/trash/${note.id}/restore`).expect(409);
    expect(conflict.body.code).toBe("source-in-trash");
    // The listing surfaces the same state so the UI can hint before the click.
    const listing = (await request(app).get("/api/trash").expect(200)).body;
    expect(listing.notes[0].sourceState).toBe("trashed");

    // Restoring the source unblocks the note.
    await request(app).post(`/api/trash/${source.id}/restore`).expect(200);
    await request(app).post(`/api/trash/${note.id}/restore`).expect(200);
  });

  it("409s (source-missing) when the note's source is gone entirely", async () => {
    const source = await seedSource();
    const note = await seedNote(source.id, "orphan-to-be");
    await request(app).delete(`/api/notes/${note.id}`).expect(200);
    // Simulate a source record hard-removed outside the trash flow (legacy/manual).
    await vault.stores.sources.delete(source.id);

    const conflict = await request(app).post(`/api/trash/${note.id}/restore`).expect(409);
    expect(conflict.body.code).toBe("source-missing");
    expect((await request(app).get("/api/trash").expect(200)).body.notes[0].sourceState).toBe("missing");
  });

  it("prunes memberships of layers deleted while the note sat in the bin", async () => {
    const source = await seedSource();
    const layer = (
      await request(app).post(`/api/sources/${source.id}/layers`).send({ title: "临时层" }).expect(201)
    ).body.layer as { id: string };
    const note = await seedNote(source.id, "layered note", [], [layer.id]);

    await request(app).delete(`/api/notes/${note.id}`).expect(200);
    await request(app).delete(`/api/layers/${layer.id}`).expect(200); // custom layer — deletable

    await request(app).post(`/api/trash/${note.id}/restore`).expect(200);
    const restored = await vault.stores.notes.get(note.id);
    expect(restored?.layerIds).toEqual([]); // stale membership pruned — never invisible
  });

  it("404s restoring ids that are not in the bin", async () => {
    const source = await seedSource();
    await request(app).post(`/api/trash/${source.id}/restore`).expect(404); // live, not trashed
    await request(app).post("/api/trash/note_01HZZZZZZZZZZZZZZZZZZZZZZZ/restore").expect(404);
    await request(app).post("/api/trash/layer_x/restore").expect(404); // untyped id
  });
});

describe("TRUST-3 purge (永久删除 / 清空回收站)", () => {
  it("purges ONE note for real (with its cascade-trashed anchors)", async () => {
    const source = await seedSource();
    const anchor = await seedAnchor(source.id);
    const note = await seedNote(source.id, "purge me", [anchor.id]);
    await request(app).delete(`/api/notes/${note.id}`).expect(200);

    const result = (await request(app).delete(`/api/trash/${note.id}`).expect(200)).body;
    expect(result).toMatchObject({ ok: true, purged: { notes: 1, anchors: 1 } });
    expect(await vault.stores.notes.getAny(note.id)).toBeNull();
    expect(await vault.stores.anchors.getAny(anchor.id)).toBeNull();

    await request(app).delete(`/api/trash/${note.id}`).expect(404); // already gone
  });

  it("purges ONE source for real: stored file + trashed dependents removed", async () => {
    const source = await seedSource();
    const anchor = await seedAnchor(source.id);
    const note = await seedNote(source.id, "cascade", [anchor.id]);
    await request(app).delete(`/api/sources/${source.id}`).expect(200);
    const absPath = path.join(vault.paths.rootDir, source.path);
    expect(await fileExists(absPath)).toBe(true);

    const result = (await request(app).delete(`/api/trash/${source.id}`).expect(200)).body;
    expect(result).toMatchObject({ ok: true, purged: { sources: 1, notes: 1, anchors: 1 } });
    expect(await fileExists(absPath)).toBe(false);
    expect(await vault.stores.sources.getAny(source.id)).toBeNull();
    expect(await vault.stores.notes.getAny(note.id)).toBeNull();
    expect(await vault.stores.anchors.getAny(anchor.id)).toBeNull();
  });

  it("清空回收站 requires the EXACT typed confirm phrase (the TRUST-2 idiom)", async () => {
    const source = await seedSource();
    const note = await seedNote(source.id, "left behind");
    await request(app).delete(`/api/notes/${note.id}`).expect(200);
    await request(app).delete(`/api/sources/${source.id}`).expect(200);

    const missing = await request(app).delete("/api/trash").expect(400);
    expect(missing.body.code).toBe("confirm-required");
    await request(app).delete("/api/trash?confirm=清空").expect(400);
    // Nothing was touched by the refused calls.
    expect((await request(app).get("/api/trash").expect(200)).body.sources).toHaveLength(1);

    const result = (
      await request(app).delete(`/api/trash?confirm=${encodeURIComponent(PURGE_ALL_CONFIRM_PHRASE)}`).expect(200)
    ).body;
    expect(result.ok).toBe(true);
    expect(result.purged.sources).toBe(1);
    expect(result.purged.notes).toBe(1);
    const listing = (await request(app).get("/api/trash").expect(200)).body;
    expect(listing.sources).toEqual([]);
    expect(listing.notes).toEqual([]);
    expect(await vault.stores.notes.getAny(note.id)).toBeNull();
  });
});

describe("TRUST-3 auto-purge (30d retention, clock-injected)", () => {
  it("purges records past the retention window and keeps younger ones", async () => {
    const source = await seedSource();
    const oldNote = await seedNote(source.id, "expired");
    const youngNote = await seedNote(source.id, "still fresh");
    await request(app).delete(`/api/notes/${oldNote.id}`).expect(200);
    await request(app).delete(`/api/notes/${youngNote.id}`).expect(200);

    // Backdate ONE tombstone 31 days; the other stays at (real) now.
    const trashed = await vault.stores.notes.getAny(oldNote.id);
    const backdated = new Date(Date.now() - 31 * DAY_MS).toISOString();
    await vault.stores.notes.upsert({ ...trashed!, deletedAt: backdated, updatedAt: backdated });

    const service = createTrashService({ vault });
    const { purged } = await service.autoPurge();
    expect(purged.notes).toBe(1);
    expect(await vault.stores.notes.getAny(oldNote.id)).toBeNull();
    expect((await vault.stores.notes.getAny(youngNote.id))?.deletedAt).toBeTruthy(); // survived
  });

  it("honors the injected clock + retention config (and sweeps expired sources with files)", async () => {
    const source = await seedSource();
    await seedNote(source.id, "cascade child");
    await request(app).delete(`/api/sources/${source.id}`).expect(200);
    const absPath = path.join(vault.paths.rootDir, source.path);

    // 2 days retention, clock 3 days ahead → everything expired.
    let nowMs = Date.now() + 3 * DAY_MS;
    const service = createTrashService({ vault, now: () => nowMs, retentionDays: 2 });
    const { purged } = await service.autoPurge();
    expect(purged.sources).toBe(1);
    expect(purged.notes).toBe(1);
    expect(await fileExists(absPath)).toBe(false);
    expect(await vault.stores.sources.getAny(source.id)).toBeNull();
  });

  it("the scheduler runs a purge pass on start (unref'd, disposable — the backup-scheduler idiom)", async () => {
    const source = await seedSource();
    const note = await seedNote(source.id, "scheduled away");
    await request(app).delete(`/api/notes/${note.id}`).expect(200);

    const service = createTrashService({ vault, now: () => Date.now() + 31 * DAY_MS });
    const scheduler = createTrashPurgeScheduler(service, { checkEveryMs: 60_000 });
    await scheduler.start();
    await scheduler.dispose();

    expect(await vault.stores.notes.getAny(note.id)).toBeNull();
  });

  it("resolveTrashRetentionDays: env override wins, junk falls back to 30", () => {
    expect(resolveTrashRetentionDays({ STUDY_VAULT_TRASH_RETENTION_DAYS: "7" } as NodeJS.ProcessEnv)).toBe(7);
    expect(resolveTrashRetentionDays({ STUDY_VAULT_TRASH_RETENTION_DAYS: "0" } as NodeJS.ProcessEnv)).toBe(30);
    expect(resolveTrashRetentionDays({ STUDY_VAULT_TRASH_RETENTION_DAYS: "x" } as NodeJS.ProcessEnv)).toBe(30);
    expect(resolveTrashRetentionDays({} as NodeJS.ProcessEnv)).toBe(30);
  });
});

describe("TRUST-3 backup/export integration (explicit choice)", () => {
  it("tombstones RIDE the verbatim full-vault export (disaster recovery keeps the bin)", async () => {
    const source = await seedSource();
    const note = await seedNote(source.id, "trashed but backed up");
    await request(app).delete(`/api/notes/${note.id}`).expect(200);

    const service = createDataTrustService({
      vault,
      backupsDir: path.join(tempDir, "backups"),
      appVersion: "test"
    });
    const chunks: Uint8Array[] = [];
    await service.exportToStream(async (chunk) => {
      chunks.push(chunk);
    });
    const zipped = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const entries = unzipSync(new Uint8Array(zipped));

    const notesJsonl = strFromU8(entries[".study/notes.jsonl"]);
    expect(notesJsonl).toContain(note.id);
    expect(notesJsonl).toContain("deletedAt"); // the tombstone itself is in the zip
    // The manifest counts raw jsonl lines, so import validation stays consistent.
    const manifest = JSON.parse(strFromU8(entries["growte-vault.json"]));
    expect(manifest.counts.notes).toBe(1);
  });

  it("soft-deleted records are excluded from every live store read (the svpack/report/search guard)", async () => {
    const source = await seedSource();
    const note = await seedNote(source.id, "invisible once trashed");
    await request(app).delete(`/api/notes/${note.id}`).expect(200);
    await request(app).delete(`/api/sources/${source.id}`).expect(200);

    // The ONE guard everything outward-facing shares: live-only list().
    expect(await vault.stores.notes.list()).toEqual([]);
    expect(await vault.stores.sources.list()).toEqual([]);
    expect((await request(app).get("/api/search?q=invisible").expect(200)).body.hits).toEqual([]);
  });
});
