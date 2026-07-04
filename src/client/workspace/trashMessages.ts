// Every user-visible string of the 回收站 view (TRUST-3), in ONE typed dictionary
// (the libraryMessages/searchMessages idiom — zh/en enforced by the Message type;
// no hardcoded literal in the component). React-free on purpose.

import { defineMessages } from "../i18n";

export const trashMessages = defineMessages({
  // —— panel chrome ——
  title: { zh: "回收站", en: "Recycle bin" },
  // {days} is substituted with the server's retention readout.
  retentionNote: {
    zh: "已删除的内容保留 {days} 天,到期后自动清除。",
    en: "Deleted items are kept for {days} days, then purged automatically."
  },
  refresh: { zh: "刷新", en: "Refresh" },
  loading: { zh: "加载中…", en: "Loading…" },
  loadFailed: { zh: "回收站加载失败", en: "Failed to load the recycle bin" },
  empty: { zh: "回收站是空的", en: "The recycle bin is empty" },

  // —— typed sections ——
  sectionSources: { zh: "已删除的文档", en: "Deleted documents" },
  sectionNotes: { zh: "已删除的笔记", en: "Deleted notes" },

  // —— rows ——
  deletedAtPrefix: { zh: "删除于", en: "Deleted" },
  // {notes}/{anchors} substituted with the source's cascade counts.
  cascadeCounts: { zh: "{notes} 条笔记 · {anchors} 处标注", en: "{notes} notes · {anchors} highlights" },
  untitledNote: { zh: "（无内容摘要）", en: "(no excerpt)" },
  sourceInTrashHint: { zh: "来源文档也在回收站 — 先恢复文档", en: "Its document is in the bin — restore it first" },
  sourceMissingHint: { zh: "来源文档已被永久删除", en: "Its document was permanently deleted" },

  // —— actions ——
  restore: { zh: "恢复", en: "Restore" },
  purge: { zh: "彻底删除", en: "Delete forever" },
  purgeAll: { zh: "清空回收站", en: "Empty recycle bin" },
  confirmPurgeOne: {
    zh: "彻底删除后将无法恢复。确定要删除吗?",
    en: "This permanently deletes the item. Continue?"
  },
  // The typed-confirm phrase flow (the TRUST-2 import idiom).
  purgeAllPrompt: {
    zh: "清空回收站会永久删除其中所有内容,无法恢复。\n输入「清空回收站」以确认:",
    en: 'Emptying the bin permanently deletes everything in it.\nType "清空回收站" to confirm:'
  },
  purgeAllMismatch: { zh: "确认口令不符,已取消。", en: "Confirmation phrase did not match — cancelled." },
  actionFailed: { zh: "操作失败", en: "Action failed" }
});
