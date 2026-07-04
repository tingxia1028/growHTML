// Every user-visible string of the lightweight concept interactions (CONCEPT-UX-1),
// in ONE typed dictionary — the 标为概念 selection action + its toast, the concept
// chips (FocusOverlay), the 关联到… autocomplete (ConceptInspector), and the concept
// list's filter/badges/empty state all read from here, so the zh/en pair is enforced
// by the Message type. React-free on purpose (mirrors libraryMessages.ts).

import { defineMessages } from "../i18n";

export const conceptMessages = defineMessages({
  // —— 选中即建概念 (the selection-toolbar action + its feedback toast) ——
  markAction: { zh: "标为概念", en: "Mark as concept" },
  markActionHint: {
    zh: "把选中文字变成概念并挂到当前段落",
    en: "Turn the selection into a concept linked at this passage"
  },
  toastMarked: { zh: "已标为概念", en: "Marked as concept" },
  toastLinkedExisting: { zh: "已关联到已有概念", en: "Linked to existing concept" },
  undo: { zh: "撤销", en: "Undo" },
  dismiss: { zh: "关闭", en: "Dismiss" },

  // —— concept chips (FocusOverlay note 大窗口) + the shared autocomplete ——
  chipsLabel: { zh: "关联概念", en: "Linked concepts" },
  openConcept: { zh: "查看概念", en: "Open concept" },
  addConcept: { zh: "关联一个概念", en: "Link a concept" },
  autocompletePlaceholder: { zh: "输入概念名…", en: "Type a concept name…" },
  createOnEnter: { zh: "回车创建", en: "Press Enter to create" },

  // —— 关联到… (ConceptInspector's one-step relation) ——
  relateToPlaceholder: { zh: "关联到…", en: "Relate to…" },

  // —— concept list usability (conceptViews) ——
  filterPlaceholder: { zh: "筛选概念…", en: "Filter concepts…" },
  linkedNoteCount: { zh: "关联笔记数", en: "Linked note count" },
  emptyGuidance: { zh: "选中文字 → 标为概念", en: "Select text → Mark as concept" },
  noMatches: { zh: "没有匹配的概念。", en: "No matching concepts." }
});
