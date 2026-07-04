// TRUST-3 回收站 (docs/design/data-trust.md §3) — the trash surfaces over the
// envelope soft-delete. The DELETE routes for notes/sources already tombstone
// behind their unchanged API shape (services/notes.ts deleteNote, core
// store/sources.ts deleteSource, services/anchors.ts orphan cascade); this
// module adds the recycle-bin service + routes + the auto-purge scheduler:
//
//   GET    /api/trash               — typed listing (documents + notes) + retention readout
//   POST   /api/trash/:id/restore   — restore ONE item, resurrecting its cascade
//                                     (a source brings back its cascade-trashed
//                                     notes/anchors/patches; a note brings back its
//                                     orphan-cascaded anchors, so the highlight
//                                     returns). Conflict: restoring a note whose
//                                     source is not live → 409 (restore/purge the
//                                     source first — never a silently detached note).
//   DELETE /api/trash/:id           — 永久删除 one item (REAL delete; a source purge
//                                     also removes its stored file + its trashed deps)
//   DELETE /api/trash?confirm=清空回收站 — purge EVERYTHING (typed confirm phrase,
//                                     the TRUST-2 import idiom)
//   auto-purge                      — records older than the 30d retention window
//                                     are purged by `createTrashPurgeScheduler`
//                                     (the TRUST-1 backup-scheduler idiom:
//                                     clock-injectable, unref'd, failures swallowed;
//                                     armed only by real entry points, and
//                                     STUDY_VAULT_TRASH_AUTO_PURGE=0 kills it).
//
// Backup/export integration (explicit choice, doc §1/§2 vs §3): the FULL-vault
// zips (TRUST-1 backups, TRUST-2 export) are the vault dir VERBATIM, so trash
// tombstones RIDE them — a disaster-recovery snapshot must not lose recoverable
// data, and import roundtrips byte-identically. The §3 guard ("soft-deleted never
// rides svpack/export/report") holds for every OUTWARD-facing read: svpack packs,
// study reports, search, queues and digests all read through the stores'
// live-only `list()`, which excludes tombstones by construction.

import { z } from "zod";
import type { Express } from "express";
import { getNoteContentSpec } from "../core/notes/contentTypes";
import type { NoteRecord, SourceRecord } from "../core/schema";
import { deleteStoredSourceFile } from "../core/store/sources";
import { trashCascadeOf, withoutTombstone } from "../core/store/trash";
import type { StudyVault } from "../core/vault";
import { ConflictError, NotFoundError, handleServiceError } from "./services/errors";

// —— Policy constants (doc §3) ———————————————————————————————————————————————————

/** Default retention: trashed records auto-purge after this many days. */
export const TRASH_RETENTION_DAYS = 30;
/** How often the scheduler re-checks for expired records (long-running sessions). */
export const TRASH_PURGE_CHECK_MS = 60 * 60 * 1000;
/** The exact phrase 清空回收站 must carry — the TRUST-2 typed-confirm idiom. */
export const PURGE_ALL_CONFIRM_PHRASE = "清空回收站";

/** Retention config (doc §3 "auto-purge after 30d (config)"): env override, else 30. */
export function resolveTrashRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.STUDY_VAULT_TRASH_RETENTION_DAYS);
  return Number.isInteger(raw) && raw > 0 ? raw : TRASH_RETENTION_DAYS;
}

// —— Listing DTOs ————————————————————————————————————————————————————————————————

export type TrashSourceItem = {
  id: string;
  title: string;
  sourceType: string;
  deletedAt: string;
  /** When auto-purge will remove it (deletedAt + retention). */
  purgeAt: string;
  /** Cascade counts — what 恢复 brings back alongside the document. */
  noteCount: number;
  anchorCount: number;
};

export type TrashNoteItem = {
  id: string;
  contentType: string;
  /** First line of the note's search text (the SEARCH-1 idiom) — may be "". */
  excerpt: string;
  deletedAt: string;
  purgeAt: string;
  sourceId?: string;
  sourceTitle?: string;
  /** Drives the restore-conflict hint: a note only restores onto a LIVE source. */
  sourceState?: "live" | "trashed" | "missing";
};

export type TrashListing = {
  retentionDays: number;
  sources: TrashSourceItem[];
  notes: TrashNoteItem[];
};

export type TrashRestoreResult = {
  ok: true;
  restored: { type: "source" | "note"; id: string };
  cascade: { notes: number; anchors: number; patches: number };
};

export type TrashPurgeCounts = { sources: number; notes: number; anchors: number; patches: number };

export type TrashService = {
  now(): number;
  retentionDays: number;
  listTrash(): Promise<TrashListing>;
  restore(id: string): Promise<TrashRestoreResult>;
  purge(id: string): Promise<{ ok: true; purged: TrashPurgeCounts }>;
  purgeAll(): Promise<{ ok: true; purged: TrashPurgeCounts }>;
  /** Purge everything older than the retention window (the scheduler's pass). */
  autoPurge(): Promise<{ purged: TrashPurgeCounts }>;
};

export type TrashDeps = {
  vault: StudyVault;
  /** Injectable wall clock (tests drive the retention window deterministically). */
  now?: () => number;
  retentionDays?: number;
};

const EXCERPT_MAX = 120;

/** First line of the note's per-spec search text (a throwing spec degrades to ""). */
function noteExcerpt(note: NoteRecord): string {
  const spec = getNoteContentSpec(note.contentType);
  let text = "";
  if (spec) {
    try {
      text = spec.toSearchText(note.content);
    } catch {
      text = "";
    }
  }
  const line = text.split("\n").find((candidate) => candidate.trim().length > 0) ?? "";
  const collapsed = line.replace(/\s+/g, " ").trim();
  return collapsed.length > EXCERPT_MAX ? `${collapsed.slice(0, EXCERPT_MAX)}…` : collapsed;
}

export function createTrashService(deps: TrashDeps): TrashService {
  const { vault } = deps;
  const now = deps.now ?? (() => Date.now());
  const retentionDays = deps.retentionDays ?? resolveTrashRetentionDays();
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000;

  const purgeAt = (deletedAt: string) => new Date(Date.parse(deletedAt) + retentionMs).toISOString();
  const expired = (deletedAt: string) => Date.parse(deletedAt) + retentionMs <= now();

  /** LIVE layer ids — restore prunes stale memberships so a resurrected note is never invisible. */
  async function liveLayerIds(): Promise<Set<string>> {
    return new Set((await vault.stores.layers.list()).map((layer) => layer.id));
  }

  async function restoreNoteRecord(note: NoteRecord, restoredAt: string, layers: Set<string>): Promise<void> {
    const restored = withoutTombstone(note, restoredAt);
    // Relationship reattachment: layers deleted while the note sat in the bin are
    // pruned (a note whose ONLY layers are gone falls back to empty = always
    // visible — never resurrect a note into invisibility).
    restored.layerIds = restored.layerIds.filter((layerId) => layers.has(layerId));
    await vault.stores.notes.upsert(restored);
  }

  /** REAL-delete a trashed source: stored file + its trashed dependents + the record. */
  async function purgeSourceRecord(source: SourceRecord): Promise<TrashPurgeCounts> {
    await deleteStoredSourceFile(vault, source);
    const counts: TrashPurgeCounts = { sources: 0, notes: 0, anchors: 0, patches: 0 };
    // Every TRASHED dependent goes with it — including direct-deleted notes of this
    // source (their restore would 409 forever once the source is gone; purging them
    // avoids stranding unrestorable records in the bin).
    for (const note of await vault.stores.notes.listTrashed()) {
      if (note.sourceId === source.id && (await vault.stores.notes.delete(note.id))) counts.notes += 1;
    }
    for (const anchor of await vault.stores.anchors.listTrashed()) {
      if (anchor.sourceId === source.id && (await vault.stores.anchors.delete(anchor.id))) counts.anchors += 1;
    }
    for (const patch of await vault.stores.patches.listTrashed()) {
      if (patch.sourceId === source.id && (await vault.stores.patches.delete(patch.id))) counts.patches += 1;
    }
    if (await vault.stores.sources.delete(source.id)) counts.sources += 1;
    return counts;
  }

  /** REAL-delete a trashed note + the anchors that were orphan-cascaded under it. */
  async function purgeNoteRecord(note: NoteRecord): Promise<TrashPurgeCounts> {
    const counts: TrashPurgeCounts = { sources: 0, notes: 0, anchors: 0, patches: 0 };
    for (const anchor of await vault.stores.anchors.listTrashed()) {
      if (trashCascadeOf(anchor) === note.id && (await vault.stores.anchors.delete(anchor.id))) counts.anchors += 1;
    }
    if (await vault.stores.notes.delete(note.id)) counts.notes += 1;
    return counts;
  }

  const addCounts = (into: TrashPurgeCounts, from: TrashPurgeCounts) => {
    into.sources += from.sources;
    into.notes += from.notes;
    into.anchors += from.anchors;
    into.patches += from.patches;
  };

  return {
    now,
    retentionDays,

    async listTrash() {
      const [trashedSources, trashedNotes, trashedAnchors, liveSources] = await Promise.all([
        vault.stores.sources.listTrashed(),
        vault.stores.notes.listTrashed(),
        vault.stores.anchors.listTrashed(),
        vault.stores.sources.list()
      ]);
      const titleById = new Map<string, string>();
      for (const source of [...liveSources, ...trashedSources]) titleById.set(source.id, source.title);
      const trashedSourceIds = new Set(trashedSources.map((source) => source.id));
      const liveSourceIds = new Set(liveSources.map((source) => source.id));

      const sources: TrashSourceItem[] = trashedSources
        .map((source) => ({
          id: source.id,
          title: source.title,
          sourceType: source.sourceType,
          deletedAt: source.deletedAt!,
          purgeAt: purgeAt(source.deletedAt!),
          noteCount: trashedNotes.filter((note) => trashCascadeOf(note) === source.id).length,
          anchorCount: trashedAnchors.filter((anchor) => trashCascadeOf(anchor) === source.id).length
        }))
        .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));

      // Top-level note rows = DIRECT deletes only; cascade-trashed notes ride (and
      // restore with) their source's row instead of doubling up in the listing.
      const notes: TrashNoteItem[] = trashedNotes
        .filter((note) => trashCascadeOf(note) === undefined)
        .map((note) => ({
          id: note.id,
          contentType: note.contentType,
          excerpt: noteExcerpt(note),
          deletedAt: note.deletedAt!,
          purgeAt: purgeAt(note.deletedAt!),
          ...(note.sourceId
            ? {
                sourceId: note.sourceId,
                ...(titleById.has(note.sourceId) ? { sourceTitle: titleById.get(note.sourceId) } : {}),
                sourceState: liveSourceIds.has(note.sourceId)
                  ? ("live" as const)
                  : trashedSourceIds.has(note.sourceId)
                    ? ("trashed" as const)
                    : ("missing" as const)
              }
            : {})
        }))
        .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));

      return { retentionDays, sources, notes };
    },

    async restore(id) {
      const restoredAt = new Date(now()).toISOString();

      if (id.startsWith("src_")) {
        const source = await vault.stores.sources.getAny(id);
        if (!source?.deletedAt) throw new NotFoundError("回收站中没有该文档");
        await vault.stores.sources.upsert(withoutTombstone(source, restoredAt));
        // Resurrect exactly the cascade: records trashed AS PART OF this source's
        // deletion. Records the user deleted independently beforehand stay in the bin.
        const layers = await liveLayerIds();
        const cascade = { notes: 0, anchors: 0, patches: 0 };
        for (const note of await vault.stores.notes.listTrashed()) {
          if (trashCascadeOf(note) !== source.id) continue;
          await restoreNoteRecord(note, restoredAt, layers);
          cascade.notes += 1;
        }
        for (const anchor of await vault.stores.anchors.listTrashed()) {
          if (trashCascadeOf(anchor) !== source.id) continue;
          await vault.stores.anchors.upsert(withoutTombstone(anchor, restoredAt));
          cascade.anchors += 1;
        }
        for (const patch of await vault.stores.patches.listTrashed()) {
          if (trashCascadeOf(patch) !== source.id) continue;
          await vault.stores.patches.upsert(withoutTombstone(patch, restoredAt));
          cascade.patches += 1;
        }
        return { ok: true as const, restored: { type: "source" as const, id: source.id }, cascade };
      }

      if (id.startsWith("note_")) {
        const note = await vault.stores.notes.getAny(id);
        if (!note?.deletedAt) throw new NotFoundError("回收站中没有该笔记");
        // Restore conflict (doc §3): a note only restores onto a LIVE source —
        // never silently detach it or resurrect it into a dead reader.
        if (note.sourceId && !(await vault.stores.sources.get(note.sourceId))) {
          const sourceInTrash = !!(await vault.stores.sources.getAny(note.sourceId))?.deletedAt;
          const message = sourceInTrash
            ? "这条笔记的来源文档还在回收站里 — 请先恢复该文档"
            : "这条笔记的来源文档已被永久删除,无法恢复";
          throw new ConflictError(message, {
            error: message,
            code: sourceInTrash ? "source-in-trash" : "source-missing"
          });
        }
        const layers = await liveLayerIds();
        await restoreNoteRecord(note, restoredAt, layers);
        // Resurrect the note's own anchors so the highlight comes back. Any trashed
        // anchor the note references is safe to restore: shared anchors are never
        // tombstoned while a live reference remains.
        const cascade = { notes: 0, anchors: 0, patches: 0 };
        for (const anchorId of note.anchorIds) {
          const anchor = await vault.stores.anchors.getAny(anchorId);
          if (!anchor?.deletedAt) continue;
          await vault.stores.anchors.upsert(withoutTombstone(anchor, restoredAt));
          cascade.anchors += 1;
        }
        return { ok: true as const, restored: { type: "note" as const, id: note.id }, cascade };
      }

      throw new NotFoundError("回收站中没有该条目");
    },

    async purge(id) {
      if (id.startsWith("src_")) {
        const source = await vault.stores.sources.getAny(id);
        if (!source?.deletedAt) throw new NotFoundError("回收站中没有该文档");
        return { ok: true as const, purged: await purgeSourceRecord(source) };
      }
      if (id.startsWith("note_")) {
        const note = await vault.stores.notes.getAny(id);
        if (!note?.deletedAt) throw new NotFoundError("回收站中没有该笔记");
        return { ok: true as const, purged: await purgeNoteRecord(note) };
      }
      throw new NotFoundError("回收站中没有该条目");
    },

    async purgeAll() {
      const purged: TrashPurgeCounts = { sources: 0, notes: 0, anchors: 0, patches: 0 };
      for (const source of await vault.stores.sources.listTrashed()) {
        addCounts(purged, await purgeSourceRecord(source));
      }
      // Whatever remains trashed (standalone notes, edit-pruned anchors, …).
      for (const note of await vault.stores.notes.listTrashed()) {
        if (await vault.stores.notes.delete(note.id)) purged.notes += 1;
      }
      for (const anchor of await vault.stores.anchors.listTrashed()) {
        if (await vault.stores.anchors.delete(anchor.id)) purged.anchors += 1;
      }
      for (const patch of await vault.stores.patches.listTrashed()) {
        if (await vault.stores.patches.delete(patch.id)) purged.patches += 1;
      }
      return { ok: true as const, purged };
    },

    async autoPurge() {
      const purged: TrashPurgeCounts = { sources: 0, notes: 0, anchors: 0, patches: 0 };
      // Sources first: a source purge sweeps its trashed dependents (they share the
      // cascade's deletedAt, and any older direct-deletes are past due anyway).
      for (const source of await vault.stores.sources.listTrashed()) {
        if (expired(source.deletedAt!)) addCounts(purged, await purgeSourceRecord(source));
      }
      for (const note of await vault.stores.notes.listTrashed()) {
        if (expired(note.deletedAt!)) addCounts(purged, await purgeNoteRecord(note));
      }
      for (const anchor of await vault.stores.anchors.listTrashed()) {
        if (expired(anchor.deletedAt!) && (await vault.stores.anchors.delete(anchor.id))) purged.anchors += 1;
      }
      for (const patch of await vault.stores.patches.listTrashed()) {
        if (expired(patch.deletedAt!) && (await vault.stores.patches.delete(patch.id))) purged.patches += 1;
      }
      return { purged };
    }
  };
}

// —— Scheduler (the TRUST-1 backup-scheduler idiom: unref'd, swallowed failures) ——

export type TrashPurgeScheduler = {
  /** App-start trigger: run a purge pass now and arm the periodic re-check. */
  start(): Promise<void>;
  /** Await any in-flight pass and cancel the timer (tests / teardown). */
  dispose(): Promise<void>;
};

export function createTrashPurgeScheduler(
  service: TrashService,
  opts?: { checkEveryMs?: number }
): TrashPurgeScheduler {
  const checkEveryMs = opts?.checkEveryMs ?? TRASH_PURGE_CHECK_MS;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inflight: Promise<void> = Promise.resolve();

  const check = (): Promise<void> => {
    inflight = inflight
      .then(async () => {
        await service.autoPurge();
      })
      .catch(() => undefined); // swallowed — the next check retries
    return inflight;
  };

  return {
    start() {
      const first = check();
      timer = setInterval(check, checkEveryMs);
      timer.unref?.();
      return first;
    },
    async dispose() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      await inflight;
    }
  };
}

// —— Routes ————————————————————————————————————————————————————————————————————

export function registerTrashRoutes(app: Express, service: TrashService): void {
  // The 回收站 view's readout: typed sections + the retention window.
  app.get("/api/trash", async (_req, res, next) => {
    try {
      res.json(await service.listTrash());
    } catch (error) {
      next(error);
    }
  });

  // Restore one item (+ its cascade). 404 = not in the bin; 409 = restore conflict
  // (note whose source is trashed/gone — the body carries a machine `code`).
  app.post("/api/trash/:id/restore", async (req, res, next) => {
    try {
      res.json(await service.restore(req.params.id));
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });

  // 清空回收站 — REAL delete of everything in the bin, gated by the typed confirm
  // phrase (the TRUST-2 import idiom). Registered before /:id (distinct paths).
  app.delete("/api/trash", async (req, res, next) => {
    try {
      const confirm = z.string().optional().parse(req.query.confirm) ?? "";
      if (confirm !== PURGE_ALL_CONFIRM_PHRASE) {
        res.status(400).json({
          error: `清空回收站会永久删除其中所有内容 — 请求必须携带确认口令 confirm=${PURGE_ALL_CONFIRM_PHRASE}`,
          code: "confirm-required"
        });
        return;
      }
      res.json(await service.purgeAll());
    } catch (error) {
      next(error);
    }
  });

  // 永久删除 one item — REAL delete (a source purge also removes its stored file).
  app.delete("/api/trash/:id", async (req, res, next) => {
    try {
      res.json(await service.purge(req.params.id));
    } catch (error) {
      if (!handleServiceError(res, error)) next(error);
    }
  });
}
