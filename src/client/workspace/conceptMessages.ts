// Every user-visible string of the lightweight concept interactions (CONCEPT-UX-1),
// in ONE typed dictionary — the 标为概念 selection action + its toast, the concept
// chips (FocusOverlay), the 关联到… autocomplete (ConceptInspector), and the concept
// list's filter/badges/empty state all read from here, so the zh/en pair is enforced
// by the Message type. React-free on purpose (mirrors libraryMessages.ts).

import { defineMessages } from "../i18n";

export const conceptMessages = defineMessages({
  title: { zh: "知元", en: "Concepts" },
  createAction: { zh: "新建知元", en: "New concept" },
  namePlaceholder: { zh: "新知元名称…", en: "New concept name…" },
  descriptionPlaceholder: { zh: "描述（可选）", en: "Description (optional)" },
  selectEmpty: {
    zh: "选择一个知元查看它的笔记和关系。",
    en: "Select a concept to see its notes and relations."
  },

  // —— 选中即建概念 (the selection-toolbar action + its feedback toast) ——
  markAction: { zh: "标为知元", en: "Mark as concept" },
  markActionHint: {
    zh: "把选中文字变成知元并挂到当前段落",
    en: "Turn the selection into a concept linked at this passage"
  },
  toastMarked: { zh: "已标为知元", en: "Marked as concept" },
  toastLinkedExisting: { zh: "已关联到已有知元", en: "Linked to existing concept" },
  undo: { zh: "撤销", en: "Undo" },
  dismiss: { zh: "关闭", en: "Dismiss" },

  // —— concept chips (FocusOverlay note 大窗口) + the shared autocomplete ——
  chipsLabel: { zh: "关联知元", en: "Linked concepts" },
  openConcept: { zh: "查看知元", en: "Open concept" },
  addConcept: { zh: "关联一个知元", en: "Link a concept" },
  autocompletePlaceholder: { zh: "输入知元名…", en: "Type a concept name…" },
  createOnEnter: { zh: "回车创建", en: "Press Enter to create" },

  // —— 关联到… (ConceptInspector's one-step relation) ——
  relateToPlaceholder: { zh: "关联到…", en: "Relate to…" },

  // —— concept list usability (conceptViews) ——
  filterPlaceholder: { zh: "筛选知元…", en: "Filter concepts…" },
  linkedNoteCount: { zh: "关联笔记数", en: "Linked note count" },
  markerNote: { zh: "知元标记", en: "Concept marker" },
  emptyGuidance: { zh: "选中文字 → 标为知元", en: "Select text → Mark as concept" },
  noMatches: { zh: "没有匹配的知元。", en: "No matching concepts." }
});
