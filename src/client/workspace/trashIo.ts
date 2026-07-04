// 回收站 IO seam (TRUST-3) — the swappable transport edges of the trash view
// (the profileIo/userMenuIo/dataTrust idiom): JSON goes through the shared
// VaultTransport; tests inject fakes via `setTrashIoForTests`. The contended
// entityClient is deliberately untouched — this view owns its own bindings.

import { createHttpTransport } from "../data/transport";

/** Must match the server's PURGE_ALL_CONFIRM_PHRASE (src/server/trash.ts). */
export const PURGE_ALL_CONFIRM_PHRASE = "清空回收站";

export type TrashSourceItem = {
  id: string;
  title: string;
  sourceType: string;
  deletedAt: string;
  purgeAt: string;
  noteCount: number;
  anchorCount: number;
};

export type TrashNoteItem = {
  id: string;
  contentType: string;
  excerpt: string;
  deletedAt: string;
  purgeAt: string;
  sourceId?: string;
  sourceTitle?: string;
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

export type TrashPurgeResult = {
  ok: true;
  purged: { sources: number; notes: number; anchors: number; patches: number };
};

export type TrashIo = {
  /** GET /api/trash */
  fetchTrash(): Promise<TrashListing>;
  /** POST /api/trash/:id/restore — 409 (ApiError) on a restore conflict. */
  restore(id: string): Promise<TrashRestoreResult>;
  /** DELETE /api/trash/:id — 永久删除 one item. */
  purge(id: string): Promise<TrashPurgeResult>;
  /** DELETE /api/trash?confirm=… — 清空回收站 (typed confirm phrase). */
  purgeAll(confirm: string): Promise<TrashPurgeResult>;
};

const transport = createHttpTransport();

const defaultIo: TrashIo = {
  fetchTrash: () => transport.request("GET", "/api/trash"),
  restore: (id) => transport.request("POST", `/api/trash/${encodeURIComponent(id)}/restore`),
  purge: (id) => transport.request("DELETE", `/api/trash/${encodeURIComponent(id)}`),
  purgeAll: (confirm) => transport.request("DELETE", `/api/trash?confirm=${encodeURIComponent(confirm)}`)
};

let io: TrashIo = defaultIo;

export function getTrashIo(): TrashIo {
  return io;
}

/** Test seam: override any subset of the IO edges (null restores the real ones). */
export function setTrashIoForTests(next: Partial<TrashIo> | null): void {
  io = next ? { ...defaultIo, ...next } : defaultIo;
}
