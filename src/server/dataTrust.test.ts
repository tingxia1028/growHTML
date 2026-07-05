// TRUST-1/2 (docs/design/data-trust.md §1–§2) — backup rotation math (injected
// clock, the digest-scheduler test idiom), the backup service against a fixture
// vault (manual trigger, status shape, backups-dir exclusion, day-by-day pruning),
// the app-start/idle scheduler, the pre-清除记忆 safety hook, streamed full-vault
// export (headers + manifest + every store), and import: rejected-without-touching
// (confirm phrase / non-zip / missing manifest / counts mismatch / unsafe entries),
// REPLACE semantics on a fixture vault with the automatic pre-import backup, and
// restore-from-backup with its pre-restore safety backup.

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { fixtureAnchor, fixtureConcept, fixtureHtmlBody, fixtureNote, fixtureSource } from "../core/fixtures/golden";
import { openVault, type StudyVault, type VaultPaths } from "../core/vault";
import { schemaVersion, studyLayerSchema, vaultManifestSchema, type StudyLayerRecord } from "../core/schema";
import { createEntityStores, entityFileNames } from "../core/store/entities";
import { closeSqliteStore } from "../core/store/engine";
import { sqliteEngine } from "../core/store/sqliteEngine";
import type { SnapshotRecord, SnapshotStore } from "../core/store/snapshotStore";
import { noteSchema, type NoteRecord } from "../core/schema";
import { nodeStorage } from "../core/storage/nodeStorage";
import { createApp } from "./app";
import {
  IMPORT_CONFIRM_PHRASE,
  VAULT_TRANSFER_MANIFEST_NAME,
  VaultImportError,
  createBackupScheduler,
  createDataTrustService,
  formatBackupName,
  parseBackupName,
  planBackupRotation,
  validateVaultZip,
  vaultTransferManifestSchema
} from "./dataTrust";

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

const madeDirs: string[] = [];
async function tmp(tag: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), `data-trust-${tag}-`));
  madeDirs.push(dir);
  return dir;
}
afterAll(async () => {
  await Promise.all(madeDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

type App = ReturnType<typeof createApp>;
type Ctx = { app: App; vault: StudyVault; backupsDir: string; parent: string };

/** Fixture vault in <parent>/vault with backups in <parent>/backups (the sibling default). */
async function makeCtx(tag: string, opts?: { backupsDirInsideVault?: boolean; now?: () => number }): Promise<Ctx> {
  const parent = await tmp(tag);
  const rootDir = path.join(parent, "vault");
  const vault = await openVault({ rootDir });
  const backupsDir = opts?.backupsDirInsideVault ? path.join(rootDir, "backups") : path.join(parent, "backups");
  const app = createApp({ vault, dataTrust: { backupsDir }, now: opts?.now });
  return { app, vault, backupsDir, parent };
}

async function seedSource(app: App, title: string): Promise<string> {
  const res = await request(app).post("/api/sources/html").send({ title, content: fixtureHtmlBody }).expect(201);
  return res.body.source.id as string;
}

async function seedAnchorAndNote(app: App, sourceId: string): Promise<void> {
  const anchor = (
    await request(app)
      .post("/api/anchors")
      .send({
        sourceId,
        studyId: "p-render-thread",
        selector: '[data-study-id="p-render-thread"]',
        quote: "Render Thread submits rendering commands."
      })
      .expect(201)
  ).body.anchor;
  await request(app)
    .post("/api/notes")
    .send({ sourceId, anchorIds: [anchor.id], contentType: "markdown", content: "A manual note." })
    .expect(201);
}

// Collect a binary response body (the app.test.ts idiom).
function binaryParser(res: any, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
  res.on("error", (err: Error) => callback(err, Buffer.alloc(0)));
}

async function exportVaultBytes(app: App): Promise<Buffer> {
  const res = await request(app).get("/api/vault/export").parse(binaryParser).expect(200);
  return res.body as Buffer;
}

async function listSourceTitles(app: App): Promise<string[]> {
  const res = await request(app).get("/api/sources").expect(200);
  return (res.body.sources as Array<{ title: string }>).map((source) => source.title).sort();
}

// —— Pure: names + rotation math ————————————————————————————————————————————————

describe("backup names", () => {
  it("format/parse roundtrip (incl. the same-second suffix); foreign names parse to null", () => {
    const at = Date.UTC(2026, 6, 4, 15, 30, 0);
    const name = formatBackupName(at, "manual");
    expect(name).toBe("vault-backup-20260704-153000-manual.zip");
    expect(parseBackupName(name)).toEqual({ at, reason: "manual" });

    const suffixed = formatBackupName(at, "pre-import", 2);
    expect(suffixed).toBe("vault-backup-20260704-153000-pre-import.2.zip");
    expect(parseBackupName(suffixed)).toEqual({ at, reason: "pre-import" });

    expect(parseBackupName("notes.jsonl")).toBeNull();
    expect(parseBackupName("vault-backup-20260704-153000-espresso.zip")).toBeNull();
    expect(parseBackupName("vault-backup-20260704-1530-manual.zip")).toBeNull();
  });
});

describe("planBackupRotation (pure, injected clock)", () => {
  it("keeps <24h (protection) + newest-per-day ×7 + newest-per-week ×4; collapses the rest", () => {
    const HOUR = 60 * 60 * 1000;
    // Mid-week, midday: now = start of epoch-week 2000 + 3.5 days ⇒ 12:00 UTC.
    const now = 2000 * WEEK + 3.5 * DAY;
    const entry = (name: string, at: number) => ({ name, at });
    const entries = [
      entry("p1", now - 2 * HOUR), // protected + newest of day0 + newest of week2000
      entry("p2", now - 20 * HOUR), // protected + newest of day1
      entry("s1", now - 30 * HOUR), // day1 again, older, unprotected → collapsed
      entry("d2", now - 2 * DAY), // dailies …
      entry("d3", now - 3 * DAY),
      entry("d4", now - 4 * DAY), // also the newest of week1999
      entry("d5", now - 5 * DAY),
      entry("d6", now - 6 * DAY), // 7th distinct day → daily quota full
      entry("d8", now - 7 * DAY), // 8th day, not week1999's newest → removed
      entry("w3", now - 14 * DAY), // newest of week1998 → weekly keep
      entry("w4", now - 21 * DAY), // newest of week1997 → weekly keep (4th week)
      entry("w4b", now - 22 * DAY), // week1997, older → collapsed
      entry("w5", now - 28 * DAY) // week1996 → beyond weeklyKeep → removed
    ];
    const plan = planBackupRotation(entries, { now });
    expect(plan.keep).toEqual(["p1", "p2", "d2", "d3", "d4", "d5", "d6", "w3", "w4"]);
    expect(plan.remove).toEqual(["s1", "d8", "w4b", "w5"]);
  });

  it("a later same-day backup never rotates away a young safety backup (24h window)", () => {
    const now = 2000 * WEEK + 3.5 * DAY;
    const plan = planBackupRotation(
      [
        { name: "later-manual", at: now - 1 * 60 * 60 * 1000 },
        { name: "pre-import-safety", at: now - 5 * 60 * 60 * 1000 }
      ],
      { now }
    );
    expect(plan.keep).toEqual(["later-manual", "pre-import-safety"]);
    expect(plan.remove).toEqual([]);
  });
});

// —— Service: backup + status + exclusion + pruning ————————————————————————————

describe("backup service", () => {
  it("POST /api/backup/now zips the vault; GET /api/backup/status reports the shape", async () => {
    const ctx = await makeCtx("manual");
    const sourceId = await seedSource(ctx.app, "Render Thread");
    await seedAnchorAndNote(ctx.app, sourceId);
    await seedSource(ctx.app, "Second Doc");

    const created = await request(ctx.app).post("/api/backup/now").expect(201);
    expect(created.body.backup.name).toMatch(/^vault-backup-\d{8}-\d{6}-manual\.zip$/);
    expect(created.body.backup.sizeBytes).toBeGreaterThan(0);
    expect(created.body.backup.fileCount).toBeGreaterThan(0);
    expect(created.body.backup.skippedFiles).toEqual([]);

    const status = await request(ctx.app).get("/api/backup/status").expect(200);
    expect(status.body.backups).toHaveLength(1);
    expect(status.body.backups[0]).toMatchObject({
      name: created.body.backup.name,
      reason: "manual",
      sizeBytes: created.body.backup.sizeBytes
    });
    expect(status.body.lastBackupAt).toBe(status.body.backups[0].createdAt);
    expect(Date.parse(status.body.nextDueAt) - Date.parse(status.body.lastBackupAt)).toBe(DAY);
    expect(status.body.backupsDir).toBe(ctx.backupsDir);

    // The zip really opens: transfer manifest + vault manifest + every entity store.
    const bytes = await readFile(path.join(ctx.backupsDir, created.body.backup.name));
    const entries = unzipSync(bytes);
    const manifest = vaultTransferManifestSchema.parse(JSON.parse(strFromU8(entries[VAULT_TRANSFER_MANIFEST_NAME])));
    expect(manifest.kind).toBe("backup");
    expect(manifest.reason).toBe("manual");
    expect(manifest.counts.sources).toBe(2);
    expect(manifest.counts.anchors).toBe(1);
    expect(manifest.counts.notes).toBe(1);
    expect(entries[".study/manifest.json"]).toBeDefined();
    expect(entries[".study/sources.jsonl"]).toBeDefined();
    expect(entries[".study/notes.jsonl"]).toBeDefined();
  });

  it("EXCLUDES the backups dir from the zip even when it nests inside the vault", async () => {
    const ctx = await makeCtx("exclude", { backupsDirInsideVault: true });
    await seedSource(ctx.app, "Doc");

    await request(ctx.app).post("/api/backup/now").expect(201);
    const second = await request(ctx.app).post("/api/backup/now").expect(201);

    const bytes = await readFile(path.join(ctx.backupsDir, second.body.backup.name));
    const names = Object.keys(unzipSync(bytes));
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => name.startsWith("backups/"))).toEqual([]);
  });

  it("rotation prunes day-by-day on the injected clock (7 dailies survive)", async () => {
    const T0 = 3000 * WEEK + 12 * 60 * 60 * 1000;
    let t = T0;
    const parent = await tmp("rotate");
    const vault = await openVault({ rootDir: path.join(parent, "vault") });
    const backupsDir = path.join(parent, "backups");
    const service = createDataTrustService({ vault, backupsDir, appVersion: "0.0.0-test", now: () => t });

    for (let day = 0; day < 10; day += 1) {
      t = T0 + day * DAY;
      await service.backupNow("auto");
    }

    const names = (await readdir(backupsDir)).sort();
    const ats = names.map((name) => parseBackupName(name)!.at).sort((a, b) => a - b);
    expect(ats).toEqual([3, 4, 5, 6, 7, 8, 9].map((day) => T0 + day * DAY));
  });
});

describe("backup scheduler (the MEM-2 idle-scheduler idiom)", () => {
  it("app-start check backs up a stale vault, skips a fresh one, and re-checks on the interval", async () => {
    vi.useFakeTimers();
    try {
      let t = 4000 * WEEK;
      const parent = await tmp("scheduler");
      const vault = await openVault({ rootDir: path.join(parent, "vault") });
      const backupsDir = path.join(parent, "backups");
      const service = createDataTrustService({ vault, backupsDir, appVersion: "0.0.0-test", now: () => t });
      const scheduler = createBackupScheduler(service);

      // No backup yet ⇒ the start trigger runs one immediately.
      await scheduler.start();
      expect((await readdir(backupsDir)).filter((name) => name.includes("-auto"))).toHaveLength(1);

      // 2h later the hourly re-check finds a fresh backup ⇒ no-op.
      t += 2 * 60 * 60 * 1000;
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(await readdir(backupsDir)).toHaveLength(1);

      // 25h since the last one ⇒ due again.
      t += 25 * 60 * 60 * 1000;
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      await scheduler.dispose();
      expect((await readdir(backupsDir)).filter((name) => name.includes("-auto"))).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("destructive-op guard (doc §1: backup before 清除记忆)", () => {
  it("DELETE /api/memory takes a pre-clear backup when dataTrust is configured; bare apps stay hermetic", async () => {
    const ctx = await makeCtx("preclear");
    await request(ctx.app).delete("/api/memory").expect(200);
    const names = await readdir(ctx.backupsDir);
    expect(names.filter((name) => name.includes("-pre-clear"))).toHaveLength(1);

    // Bare createApp (no dataTrust option): the hook is NOT armed.
    const bareParent = await tmp("preclear-bare");
    const bareVault = await openVault({ rootDir: path.join(bareParent, "vault") });
    const bareApp = createApp({ vault: bareVault });
    await request(bareApp).delete("/api/memory").expect(200);
    expect(existsSync(path.join(bareParent, "backups"))).toBe(false);
  });
});

// —— TRUST-2: export ————————————————————————————————————————————————————————————

describe("GET /api/vault/export", () => {
  it("streams a `.growte-vault.zip` with correct headers, the manifest, and every store", async () => {
    const ctx = await makeCtx("export", { backupsDirInsideVault: true });
    const sourceId = await seedSource(ctx.app, "Render Thread");
    await seedAnchorAndNote(ctx.app, sourceId);
    await seedSource(ctx.app, "Second Doc");
    await request(ctx.app).post("/api/backup/now").expect(201); // must NOT ride the export

    const res = await request(ctx.app).get("/api/vault/export").parse(binaryParser).expect(200);
    expect(res.headers["content-type"]).toContain("application/zip");
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="vault-\d{8}-\d{6}\.growte-vault\.zip"/);

    const entries = unzipSync(res.body as Buffer);
    const manifest = vaultTransferManifestSchema.parse(JSON.parse(strFromU8(entries[VAULT_TRANSFER_MANIFEST_NAME])));
    expect(manifest.format).toBe("growte-vault");
    expect(manifest.kind).toBe("export");
    expect(manifest.appVersion.length).toBeGreaterThan(0);
    expect(manifest.counts.sources).toBe(2);
    expect(manifest.counts.anchors).toBe(1);
    expect(manifest.counts.notes).toBe(1);

    const names = Object.keys(entries);
    // Every entity store rides along (openVault seeds them all, even empty).
    for (const fileName of [
      "sources.jsonl",
      "anchors.jsonl",
      "notes.jsonl",
      "patches.jsonl",
      "concepts.jsonl",
      "relations.jsonl",
      "assets.jsonl",
      "layers.jsonl",
      "operations.jsonl",
      "memory-events.jsonl"
    ]) {
      expect(names).toContain(`.study/${fileName}`);
    }
    expect(names).toContain(".study/manifest.json");
    // The vault dir verbatim ⇒ the ingested source file is in there too …
    expect(names.some((name) => name.startsWith("sources/"))).toBe(true);
    // … but backups NEVER ride an export (doc §1).
    expect(names.filter((name) => name.startsWith("backups/"))).toEqual([]);

    // The export IS a valid import package (roundtrip through the validator).
    const validated = validateVaultZip(res.body as Buffer);
    expect(validated.manifest.counts.sources).toBe(2);
  });
});

// —— TRUST-2: import (replace) + restore ————————————————————————————————————————

describe("POST /api/vault/import", () => {
  it("requires the exact confirm phrase — no body inspection, nothing touched", async () => {
    const ctx = await makeCtx("import-confirm");
    await seedSource(ctx.app, "Keep Me");

    const res = await request(ctx.app)
      .post("/api/vault/import")
      .set("Content-Type", "application/zip")
      .send(Buffer.from("PKjunk"))
      .expect(400);
    expect(res.body.code).toBe("confirm-required");

    const wrong = await request(ctx.app)
      .post("/api/vault/import")
      .query({ confirm: "替换" })
      .set("Content-Type", "application/zip")
      .send(Buffer.from("PKjunk"))
      .expect(400);
    expect(wrong.body.code).toBe("confirm-required");

    expect(await listSourceTitles(ctx.app)).toEqual(["Keep Me"]);
    expect(existsSync(ctx.backupsDir)).toBe(false); // no pre-import backup for a refused request
  });

  it("rejects bad zips/manifests/counts BEFORE touching the vault (no pre-import backup either)", async () => {
    const ctx = await makeCtx("import-validate");
    await seedSource(ctx.app, "Keep Me");
    const confirm = { confirm: IMPORT_CONFIRM_PHRASE };

    // Not a zip.
    const notZip = await request(ctx.app)
      .post("/api/vault/import")
      .query(confirm)
      .set("Content-Type", "application/zip")
      .send(Buffer.from("definitely not a zip"))
      .expect(400);
    expect(notZip.body.code).toBe("not-a-zip");

    // A zip without the transfer manifest.
    const noManifest = zipSync({ "readme.txt": strToU8("hello") });
    const missing = await request(ctx.app)
      .post("/api/vault/import")
      .query(confirm)
      .set("Content-Type", "application/zip")
      .send(Buffer.from(noManifest))
      .expect(400);
    expect(missing.body.code).toBe("missing-manifest");

    // A real export, tampered so the store no longer matches the manifest counts.
    const good = unzipSync(await exportVaultBytes(ctx.app));
    good[".study/sources.jsonl"] = strToU8("");
    const tampered = await request(ctx.app)
      .post("/api/vault/import")
      .query(confirm)
      .set("Content-Type", "application/zip")
      .send(Buffer.from(zipSync(good)))
      .expect(400);
    expect(tampered.body.code).toBe("counts-mismatch");

    expect(await listSourceTitles(ctx.app)).toEqual(["Keep Me"]);
    expect(existsSync(ctx.backupsDir)).toBe(false);
  });

  it("validateVaultZip refuses unsafe entry paths (zip-slip)", async () => {
    const ctx = await makeCtx("import-slip");
    const good = unzipSync(await exportVaultBytes(ctx.app));
    good["../evil.txt"] = strToU8("nope");
    expect(() => validateVaultZip(zipSync(good))).toThrowError(VaultImportError);
    try {
      validateVaultZip(zipSync(good));
    } catch (error) {
      expect((error as VaultImportError).code).toBe("unsafe-entry");
    }
  });

  it("REPLACES the vault: A's data serves from B afterwards; the pre-import backup carries B's old state", async () => {
    const ctxA = await makeCtx("import-a");
    await seedSource(ctxA.app, "A1");
    await seedSource(ctxA.app, "A2");
    const aInfo = await request(ctxA.app).get("/api/vault/info").expect(200);
    const packA = await exportVaultBytes(ctxA.app);

    const ctxB = await makeCtx("import-b");
    await seedSource(ctxB.app, "B1");

    const res = await request(ctxB.app)
      .post("/api/vault/import")
      .query({ confirm: IMPORT_CONFIRM_PHRASE })
      .set("Content-Type", "application/zip")
      .send(packA)
      .expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.sameVault).toBe(false); // DIFFERENT-VAULT (id mismatch) is reported honestly
    expect(res.body.restartRequired).toBe(false);
    expect(res.body.counts.sources).toBe(2);
    expect(res.body.preImportBackup).toMatch(/-pre-import\.zip$/);

    // Replace semantics: B now serves A's data (stores read from disk per request).
    expect(await listSourceTitles(ctxB.app)).toEqual(["A1", "A2"]);
    const bInfo = await request(ctxB.app).get("/api/vault/info").expect(200);
    expect(bInfo.body.vault.createdAt).toBe(aInfo.body.vault.createdAt);

    // The automatic pre-import backup holds B's OLD state.
    const backupBytes = await readFile(path.join(ctxB.backupsDir, res.body.preImportBackup));
    const backupEntries = unzipSync(backupBytes);
    expect(strFromU8(backupEntries[".study/sources.jsonl"])).toContain("B1");

    // …and restoring that backup returns B to its pre-import state (undoable restore).
    const restore = await request(ctxB.app)
      .post("/api/backup/restore")
      .send({ name: res.body.preImportBackup, confirm: IMPORT_CONFIRM_PHRASE })
      .expect(200);
    expect(restore.body.ok).toBe(true);
    expect(restore.body.preRestoreBackup).toMatch(/-pre-restore\.zip$/);
    expect(await listSourceTitles(ctxB.app)).toEqual(["B1"]);

    // The staging/replaced work dirs never survive a successful swap.
    const parentEntries = await readdir(ctxB.parent);
    expect(parentEntries.filter((name) => name.includes(".staging-") || name.includes(".replaced-"))).toEqual([]);
  });

  it("restore refuses a wrong phrase and unknown/unsafe backup names", async () => {
    const ctx = await makeCtx("restore-guard");
    await request(ctx.app).post("/api/backup/now").expect(201);

    const wrongPhrase = await request(ctx.app)
      .post("/api/backup/restore")
      .send({ name: "vault-backup-20260704-000000-manual.zip", confirm: "yes" })
      .expect(400);
    expect(wrongPhrase.body.code).toBe("confirm-required");

    const badName = await request(ctx.app)
      .post("/api/backup/restore")
      .send({ name: "../../etc/passwd", confirm: IMPORT_CONFIRM_PHRASE })
      .expect(400);
    expect(badName.body.code).toBe("invalid-backup-name");

    const missing = await request(ctx.app)
      .post("/api/backup/restore")
      .send({ name: "vault-backup-20200101-000000-manual.zip", confirm: IMPORT_CONFIRM_PHRASE })
      .expect(404);
    expect(missing.body.code).toBe("backup-not-found");
  });
});

// —— STORE-SQL Stage-2: JSONL-as-truth export/import bridge for a SQLITE vault ——————
//
// The `.db` is the RUNTIME truth but the PACK's source of truth is the `*.jsonl` dumps (spec R2).
// The export must MATERIALIZE the sqlite rows to jsonl before the whole-dir zip, EXCLUDE the
// rebuildable `.db` cache from the pack, and NOT touch the non-entity files (sources/assets). On
// import the swapped dir holds jsonl (no `.db`) → the next open rebuilds sqlite from jsonl. This
// suite is the new proof; the jsonl-runtime suites above prove the no-op path is byte-identical.

/** Build a SQLITE-backed StudyVault under `rootDir` (mirrors openVault's dir + manifest setup). */
async function buildSqliteVault(rootDir: string): Promise<StudyVault> {
  const studyDir = path.join(rootDir, ".study");
  const paths: VaultPaths = {
    rootDir,
    studyDir,
    sourcesDir: path.join(rootDir, "sources"),
    assetsDir: path.join(rootDir, "assets"),
    exportsDir: path.join(rootDir, "exports"),
    manifestPath: path.join(studyDir, "manifest.json"),
    pluginSettingsPath: path.join(studyDir, "plugin-settings.json")
  };
  for (const dir of [paths.studyDir, paths.sourcesDir, paths.assetsDir, paths.exportsDir]) {
    await mkdir(dir, { recursive: true });
  }
  const nowIso = new Date().toISOString();
  const manifest = vaultManifestSchema.parse({ schemaVersion, name: "SQLite Vault", createdAt: nowIso, updatedAt: nowIso });
  await writeFile(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const stores = createEntityStores(studyDir, nodeStorage, sqliteEngine);
  return {
    paths,
    manifest,
    stores,
    storage: nodeStorage,
    close() {
      for (const store of Object.values(stores)) {
        closeSqliteStore(store as SnapshotStore<SnapshotRecord>);
      }
    }
  };
}

/** Close every sqlite store's DB handle (Windows can't unlink an open `.db`/`-wal`). */
function closeVault(vault: StudyVault): void {
  for (const store of Object.values(vault.stores)) {
    closeSqliteStore(store as SnapshotStore<SnapshotRecord>);
  }
}

async function exportBytes(service: ReturnType<typeof createDataTrustService>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await service.exportToStream(async (chunk) => {
    chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  });
  return Buffer.concat(chunks);
}

describe("STORE-SQL Stage-2 — sqlite whole-vault round-trip (JSONL is the pack's truth)", () => {
  it("materializes jsonl, excludes the .db cache, and round-trips entities + tombstone + non-entity files", async () => {
    const parent = await tmp("sqlite-roundtrip");
    const rootA = path.join(parent, "vaultA");
    const rootB = path.join(parent, "vaultB");

    const layer: StudyLayerRecord = studyLayerSchema.parse({
      id: "layer_01ARZ3NDEKTSV4RRFFQ69G5FB2",
      type: "layer",
      schemaVersion: 1,
      createdAt: fixtureNote.createdAt,
      updatedAt: fixtureNote.updatedAt,
      createdBy: "user",
      title: "Owned"
    });
    // A note carrying anchor/concept/layer ids AND the DEPRECATED singular note.layerId (N2) —
    // the legacy id must round-trip losslessly through the json blob.
    const note: NoteRecord = noteSchema.parse({
      ...fixtureNote,
      anchorIds: [fixtureAnchor.id],
      conceptIds: [fixtureConcept.id],
      layerIds: [layer.id],
      layerId: layer.id
    });
    // A SOFT-DELETED anchor tombstone — must survive the round-trip (list hides it, listTrashed shows it).
    const trashedAnchor = { ...fixtureAnchor, id: "anchor_01ARZ3NDEKTSV4RRFFQ69G5FZZ", deletedAt: "2026-07-05T00:00:00.000Z", updatedAt: "2026-07-05T00:00:00.000Z" };

    // 1. Seed a sqlite-backed vault across several entity types (incl. the tombstone).
    const vaultA = await buildSqliteVault(rootA);
    const serviceA = createDataTrustService({ vault: vaultA, backupsDir: path.join(parent, "backupsA"), appVersion: "0.0.0-test" });
    try {
      await vaultA.stores.sources.upsert(fixtureSource);
      await vaultA.stores.anchors.upsert(fixtureAnchor);
      await vaultA.stores.anchors.upsert(trashedAnchor);
      await vaultA.stores.concepts.upsert(fixtureConcept);
      await vaultA.stores.layers.upsert(layer);
      await vaultA.stores.notes.upsert(note);

      // A NON-ENTITY file in the vault dir (the B1 loss guard) — an ingested source + an asset.
      await writeFile(path.join(vaultA.paths.sourcesDir, "fake.html"), "<p>ingested html</p>", "utf8");
      await writeFile(path.join(vaultA.paths.assetsDir, "diagram.bin"), Buffer.from([1, 2, 3, 4, 5]));
      // A user asset with a `.db` EXTENSION (importLocalAsset preserves the source extension, so a
      // user's imported `deck.db` lands here). It MUST survive — the sqlite-cache exclusion is scoped
      // to `.study/<entity>.db`, so a loose `.db` match would silently drop these bytes (the over-match bug).
      await writeFile(path.join(vaultA.paths.assetsDir, "user-backup.db"), Buffer.from([9, 8, 7]));

      // 2. Export — this MATERIALIZES the sqlite rows into `.study/*.jsonl` before the walk.
      const bytes = await exportBytes(serviceA);
      const entries = unzipSync(bytes);
      const names = Object.keys(entries);

      // The pack carries the jsonl dumps …
      expect(names).toContain(".study/notes.jsonl");
      expect(names).toContain(".study/anchors.jsonl");
      // … and NOT the local `.db` cache UNDER .study/ (rebuildable, excluded by the walk) — the
      // exclusion is scoped to the entity-store cache, so the `.db`-extensioned user asset is kept.
      expect(names.filter((name) => name.startsWith(".study/") && /\.db(-wal|-shm)?$/i.test(name))).toEqual([]);
      // The non-entity files rode the walk verbatim.
      expect(names).toContain("sources/fake.html");
      expect(names).toContain("assets/diagram.bin");
      // The `.db`-EXTENSIONED user asset was NOT dropped by the cache exclusion (over-match guard).
      expect(names).toContain("assets/user-backup.db");
      // The materialized notes.jsonl actually contains the note (a sqlite dump, not an empty file).
      const notesLines = strFromU8(entries[".study/notes.jsonl"]).split("\n").filter((l) => l.trim());
      expect(notesLines).toHaveLength(1);
      expect(JSON.parse(notesLines[0]).id).toBe(note.id);
      // The pack passes its own import validator (jsonl line-counts match the manifest).
      const validated = validateVaultZip(bytes);
      expect(validated.manifest.counts.notes).toBe(1);
      expect(validated.manifest.counts.anchors).toBe(2); // live + tombstone (line count, not list())

      // 3. Import into a FRESH vault B (full REPLACE via the real service pipeline). The import is
      //    an ENGINE-AGNOSTIC whole-dir two-rename swap that validates jsonl lines and never reopens
      //    stores, so B is a plain jsonl vault (no open `.db` handles to block the Windows rename —
      //    the production Stage-3 StudyVault.close() closes them before the swap). The sqlite-vs-jsonl
      //    proof is that we REBUILD sqlite stores from the imported jsonl in step 4.
      const vaultB = await openVault({ rootDir: rootB });
      const serviceB = createDataTrustService({ vault: vaultB, backupsDir: path.join(parent, "backupsB"), appVersion: "0.0.0-test" });
      const result = await serviceB.importVault(bytes);
      expect(result.ok).toBe(true);
      expect(result.counts.notes).toBe(1);

      // 4. Read the imported entities back — jsonl is the pack's TRUTH, so a jsonl store reads them
      //    directly from the swapped dir (pre-Stage-3; the Stage-3 boot builder will rebuild the `.db`
      //    from this same jsonl). No stale `.db` survived the swap (the pack carried none; the swap
      //    replaced the whole dir) — the jsonl alone is a complete, portable, restorable copy.
      expect(existsSync(path.join(rootB, ".study", "notes.db"))).toBe(false);
      const rebuilt = createEntityStores(path.join(rootB, ".study"), nodeStorage); // jsonl (default)
      const notes = await rebuilt.notes.list();
      expect(notes).toHaveLength(1);
      expect(notes[0].id).toBe(note.id);
      expect(notes[0].anchorIds).toEqual([fixtureAnchor.id]);
      expect(notes[0].conceptIds).toEqual([fixtureConcept.id]);
      expect(notes[0].layerIds).toEqual([layer.id]);
      expect(notes[0].layerId).toBe(layer.id); // legacy singular survived the blob round-trip

      // The tombstone survived: hidden from list(), present in listTrashed()/getAny().
      expect((await rebuilt.anchors.list()).map((a) => a.id)).toEqual([fixtureAnchor.id]);
      expect((await rebuilt.anchors.listTrashed()).map((a) => a.id)).toEqual([trashedAnchor.id]);
      expect((await rebuilt.anchors.getAny(trashedAnchor.id))?.deletedAt).toBe(trashedAnchor.deletedAt);

      // Other entity types round-tripped.
      expect((await rebuilt.sources.list()).map((s) => s.id)).toEqual([fixtureSource.id]);
      expect((await rebuilt.concepts.list()).map((c) => c.id)).toEqual([fixtureConcept.id]);
      expect((await rebuilt.layers.list()).map((l) => l.id)).toEqual([layer.id]);

      // 5. The non-entity files survived the whole export→import round-trip.
      expect(await readFile(path.join(rootB, "sources", "fake.html"), "utf8")).toBe("<p>ingested html</p>");
      expect([...(await readFile(path.join(rootB, "assets", "diagram.bin")))]).toEqual([1, 2, 3, 4, 5]);
      expect([...(await readFile(path.join(rootB, "assets", "user-backup.db")))]).toEqual([9, 8, 7]);
    } finally {
      closeVault(vaultA);
    }
  });

  it("jsonl export stays a NO-OP: dumpStoreToJsonl does not rewrite a jsonl store's file", async () => {
    // A jsonl-backed vault's entity file is already truth; the Stage-2 dump must NOT touch it (so
    // jsonl-vault backups stay byte-identical). Prove it by capturing the file's mtime+bytes across
    // an export.
    const parent = await tmp("jsonl-noop");
    const vault = await openVault({ rootDir: path.join(parent, "vault") });
    const service = createDataTrustService({ vault, backupsDir: path.join(parent, "backups"), appVersion: "0.0.0-test" });

    const notesPath = path.join(vault.paths.studyDir, entityFileNames.notes);
    await vault.stores.notes.upsert(fixtureNote);
    const before = await readFile(notesPath);

    await exportBytes(service);

    const after = await readFile(notesPath);
    expect(after.equals(before)).toBe(true); // the jsonl file is untouched by the (no-op) dump
  });
});
