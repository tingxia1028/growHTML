# Data Trust — 备份 · 全库导出/导入 · 回收站 (+ the sync question)

The vault is 94MB of real study data in one folder with NO backup story, no full export, no
undelete. One loss event kills the product's trust permanently. All three fixes are cheap and
kernel-clean (operations + a view). Grounded 2026-07-02.

## 1. 自动备份 (TRUST-1)
Rotating local backups of the vault dir (zip): on app start (if last backup > 24h) + before
DESTRUCTIVE operations (清除记忆, vault import-overwrite, patch apply later). Keep N=7 daily +
4 weekly (config in the hub's 数据 section); backups live OUTSIDE the vault dir (sibling
`backups/`, excluded from any export). Restore = pick a backup in the hub → confirm → swap
(current state backed up first — restore is itself undoable). Status line in Settings Hub 数据:
"上次备份 x 小时前 · 共 N 份 · 立即备份".

## 2. 全库导出/导入 (TRUST-2)
`.growte-vault.zip` = the vault dir verbatim (JSONL + assets + prefs) + manifest {version,
counts, createdAt}. Export from the hub; import = restore flow with a DIFFERENT-VAULT warning
(id mismatch → "替换" vs "取消"; merge is NOT V1 — svpack is the merge path). This is also the
manual multi-device bridge until sync exists.

## 3. 回收站 (TRUST-3)
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
