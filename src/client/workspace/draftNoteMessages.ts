// D6 (note-presentation-unified.md §6) — the user-visible strings for the
// auto-materialized draft-note toast ("已生成笔记 · 撤销"). One typed dictionary so the
// zh/en pair is enforced by the Message type (mirrors conceptMessages.ts). React-free.

import { defineMessages } from "../i18n";

export const draftNoteMessages = defineMessages({
  // The toast body after an anchor-context AI answer auto-materializes as a draft note.
  toastMaterialized: { zh: "已生成笔记", en: "Note generated" },
  // The undo affordance — dispatches note.delete on the just-materialized draft.
  undo: { zh: "撤销", en: "Undo" },
  dismiss: { zh: "关闭", en: "Dismiss" },
  // The small "draft" marker shown on a draft note's chip / card wrapper.
  draftBadge: { zh: "草稿", en: "Draft" }
});
