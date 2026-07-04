# Data Trust — 备份 · 全库导出/导入 · 回收站 (+ the sync question)

The vault is 94MB of real study data in one folder with NO backup story, no full export, no
undelete. One loss event kills the product's trust permanently. All three fixes are cheap and
kernel-clean (operations + a view). Grounded 2026-07-02.

## 1. 自动备份 (TRUST-1)
**Status: ✅ shipped (TRUST-12-001, 2026-07-04)** — `src/server/dataTrust.ts`: zip backups of
the whole vault dir into the sibling `backups/` (fflate streaming, file-by-file with skip-on-
error for concurrent writes, backups dir excluded even if nested); rotation = 7 daily + 4
weekly (newest per UTC day/epoch-week) **+ a 24h protection window** so same-day safety
backups survive (small extension to the policy below); triggers = app start/idle scheduler
(the MEM-2 idiom, clock-injectable; armed by real entry points — packaged Electron and the
dev/CLI server; `STUDY_VAULT_AUTO_BACKUP=0` kills it for e2e) + `POST /api/backup/now` +
automatic pre-destructive backups (清除记忆 hook, vault import/restore). Restore =
`POST /api/backup/restore {name, confirm:"替换全库"}` with a pre-restore safety backup
(undoable), sharing the import pipeline; manual recovery also works — a backup zip IS a
`.growte-vault.zip` (导入全库 it). `GET /api/backup/status` serves the readout; the Settings
Hub 数据 section (status line + backup picker UI + N config) is DEFERRED (SettingsHub.tsx
contended 2026-07-04) — meanwhile 立即备份 lives in the UserMenu with the status readout as
its tooltip. Keep-N config = with the hub section.

Rotating local backups of the vault dir (zip): on app start (if last backup > 24h) + before
DESTRUCTIVE operations (清除记忆, vault import-overwrite, patch apply later). Keep N=7 daily +
4 weekly (config in the hub's 数据 section); backups live OUTSIDE the vault dir (sibling
`backups/`, excluded from any export). Restore = pick a backup in the hub → confirm → swap
(current state backed up first — restore is itself undoable). Status line in Settings Hub 数据:
"上次备份 x 小时前 · 共 N 份 · 立即备份".

## 2. 全库导出/导入 (TRUST-2)
**Status: ✅ shipped (TRUST-12-001, 2026-07-04)** — `GET /api/vault/export` streams the vault
dir verbatim + `growte-vault.json` manifest {format, appVersion, createdAt, vault identity,
per-store counts}; UserMenu 导出全库… saves it via the download idiom. Import =
`POST /api/vault/import?confirm=替换全库` (raw zip): full REPLACE only (merge stays svpack),
zip validated structurally BEFORE anything is touched (manifest, every jsonl line, counts
match, zip-slip guard), automatic pre-import backup FIRST, staging-dir extract → two-rename
swap with rollback, then in-process reload (stores are disk-read-per-request; manifest +
sealed runtime refreshed — no restart needed, `restartRequired:false`). UserMenu 导入全库
(替换)… peeks the manifest LOCALLY (fflate) and shows the DIFFERENT-VAULT warning on
`vault.createdAt` mismatch (the vault id), then requires TYPING 「替换全库」. Client/actions:
`src/client/workspace/dataTrust.ts`; hub placement deferred with the §1 数据 section.

`.growte-vault.zip` = the vault dir verbatim (JSONL + assets + prefs) + manifest {version,
counts, createdAt}. Export from the hub; import = restore flow with a DIFFERENT-VAULT warning
(id mismatch → "替换" vs "取消"; merge is NOT V1 — svpack is the merge path). This is also the
manual multi-device bridge until sync exists.

## 3. 回收站 (TRUST-3)
**Status: ✅ shipped (TRUST-3-001, 2026-07-04)** — `deletedAt` on the shared record
envelope (additive, compaction-aware: the snapshot stores keep tombstoned lines through
every rewrite and exclude them from `list()`/`get()`, so EVERY read — list/search/queue/
digest/svpack/report — hides them by construction). The existing DELETE routes flipped to
soft behind the SAME API shape: `DELETE /api/notes/:id` tombstones the note + orphan-
cascades its anchors (marked `metadata.trash.cascadeOf=noteId` so restore resurrects the
highlight); `DELETE /api/sources/:id` tombstones the source + cascade-trashes its
notes/anchors/patches (stored FILE kept on disk — only purge removes it). Trash surfaces
(`src/server/trash.ts`): `GET /api/trash` (typed listing: documents with cascade counts +
directly-deleted notes with sourceState, retention readout), `POST /api/trash/:id/restore`
(cascade resurrection; restoring a note whose source is not live → 409
`source-in-trash`/`source-missing` — restore the document first, never a silently detached
note; layer memberships deleted meanwhile are pruned so nothing resurrects invisible),
`DELETE /api/trash/:id` (永久删除 — REAL delete; a source purge also removes its file +
its trashed dependents), `DELETE /api/trash?confirm=清空回收站` (typed confirm phrase, the
§2 import idiom). Auto-purge after 30d (`STUDY_VAULT_TRASH_RETENTION_DAYS` config) rides
the §1 scheduler idiom (`createTrashPurgeScheduler`, clock-injected, armed by real entry
points via `scheduleAuto`; `STUDY_VAULT_TRASH_AUTO_PURGE=0` kills it — e2e stays hermetic).
View: registered `trash.panel` (`src/client/workspace/trashViews.tsx` + trashIo/
trashMessages/trash.css, zh/en) reached from the UserMenu 数据 group 回收站 entry (hub
数据 section still deferred with §1). **Explicit export choice:** tombstones RIDE the
verbatim full-vault backups/exports (§1/§2 — disaster recovery keeps the bin, import
roundtrips byte-identically, manifest counts count raw lines); every OUTWARD-facing read
(svpack/report/search/queues/digests) excludes them via the stores' live-only `list()`.
REAL delete stays for 永久删除/清空回收站 + memory clear-all (its own semantics).

Soft-delete for notes + sources (+ their cascade): `deletedAt` on the envelope (additive,
compaction-aware), excluded from every list/search/queue/digest; 回收站 view (hub 数据 section
or library) with restore + 永久删除; auto-purge after 30d (config). Guard: soft-deleted never
rides svpack/export/report. The existing DELETE routes flip to soft behind the same API shape
(REAL delete stays for 永久删除 + memory clear-all which has its own semantics).

## 4. The sync question (recorded, NOT scheduled — architecture ≫ feature)
Multi-device (desktop↔X2 mobile) sync is the elephant: JSONL entity stores + append-only
memory events are actually sync-FRIENDLY (per-entity files, ULID ids, last-write-wins per
entity is mostly acceptable; memory events are append-only = trivially mergeable), but
conflict UX, partial sync (assets), and transport (LAN pair from study-report-delivery.md's
pairing model? hosted relay? third-party folder sync as V0?) need a real design round WITH X2.
**V0 stance shipped in docs:** vault-in-a-synced-folder (坚果云/OneDrive) works today with a
single-writer warning (lockfile + "另一台设备正在写入" guard — cheap, TRUST-1 scope); real sync
gets its own doc when X2 starts.

## 5. Tests
Backup rotation (counts, pruning, destructive-op trigger); restore roundtrip byte-identity +
pre-restore safety backup; export/import manifest + different-vault warning; soft-delete
excluded everywhere (list/search/queue/digest/svpack — extend the export guard); restore
resurrects cascades; purge honors config; lockfile guard (second writer warned, no corruption).
