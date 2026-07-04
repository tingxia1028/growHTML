// Every user-visible string of the Actions manager/builder (operationViews) in ONE
// typed dictionary — the ACTION-2b 一句话新增 two-field creator, the 高级 accordion
// (template chrome), the manager list, and the per-surface Customize tab all read
// from here, so the zh/en pair is enforced by the Message type. React-free on
// purpose (mirrors libraryMessages.ts / conceptMessages.ts).

import { defineMessages } from "../i18n";

export const operationMessages = defineMessages({
  // —— panel + tabs ——
  panelTitle: { zh: "操作", en: "Actions" },
  tabToolbar: { zh: "工具栏", en: "Toolbar" },
  tabManage: { zh: "我的操作", en: "My Actions" },
  tablistLabel: { zh: "自定义工具栏", en: "Customize toolbar surface" },

  // —— per-surface customize ——
  passageSurfaceTitle: { zh: "段落工具栏", en: "Passage toolbar" },
  resetSurface: { zh: "恢复默认", en: "Reset to default" },
  resetSurfaceHint: {
    zh: "恢复此工具栏的默认排序与显示",
    en: "Reset this surface to the default order/visibility"
  },
  changeIcon: { zh: "更换图标", en: "Change icon" },
  resetIcon: { zh: "重置图标", en: "Reset icon" },
  moveUp: { zh: "上移", en: "Move up" },
  moveDown: { zh: "下移", en: "Move down" },
  emptySurface: { zh: "此工具栏暂无动作。", en: "No actions for this surface." },
  tagPassage: { zh: "段落", en: "passage" },
  tagSource: { zh: "全文", en: "source" },
  tagBuiltin: { zh: "内置", en: "built-in" },
  tagCustom: { zh: "自定义", en: "custom" },

  // —— builder: the two-field 一句话新增 flow (ACTION-2b) ——
  newAction: { zh: "新增动作", en: "New action" },
  editAction: { zh: "编辑动作", en: "Edit action" },
  newButton: { zh: "新建", en: "New" },
  nameLabel: { zh: "名字", en: "Name" },
  namePlaceholder: { zh: "例如：苏格拉底提问", en: "e.g. Socratic questioning" },
  instructionLabel: { zh: "一句话指令", en: "One-sentence instruction" },
  instructionPlaceholder: {
    zh: "例如：把这段话改写成小学生能懂的例子",
    en: "e.g. Rewrite this passage as an example a primary-school student would understand"
  },
  simpleHint: {
    zh: "选中内容、文档信息、学习画像会自动补全，输出形式自动选择。",
    en: "Selection, document info and learner profile are added automatically; the output form is picked automatically."
  },
  nameRequired: { zh: "请输入名字", en: "Name is required" },
  instructionRequired: { zh: "请输入一句话指令", en: "Instruction is required" },
  templateRequired: { zh: "请输入提示词模板", en: "Prompt template is required" },

  // —— builder: 高级 accordion ——
  advanced: { zh: "高级", en: "Advanced" },
  outputTypeLabel: { zh: "输出类型", en: "Output type" },
  outputAuto: { zh: "自动（推荐）", en: "Auto (recommended)" },
  scopeLabel: { zh: "作用范围", en: "Runs on" },
  scopeAnchor: { zh: "选中段落", en: "Selected passage" },
  scopeSource: { zh: "整个来源", en: "Whole source" },
  convertToTemplate: { zh: "编辑为完整模板", en: "Edit as full template" },
  convertConfirm: {
    zh: "转换为完整模板后无法改回一句话模式。继续？",
    en: "Converting to a full template cannot be undone. Continue?"
  },

  // —— builder: template chrome (V1, lives inside 高级) ——
  descriptionPlaceholder: { zh: "描述（可选）", en: "Description (optional)" },
  prefillLabel: { zh: "从内置动作开始", en: "Start from a built-in" },
  prefillBlank: { zh: "— 空白 —", en: "— blank —" },
  insertVariable: { zh: "插入变量：", en: "Insert variable:" },
  varAnchorText: { zh: "选中段落", en: "Selected passage" },
  varSourceTitle: { zh: "来源标题", en: "Source title" },
  varExistingNotes: { zh: "已有笔记", en: "Existing notes" },
  templatePlaceholder: {
    zh: "编写指令，用上方按钮插入变量…",
    en: "Write the instruction. Use the buttons above to drop in variables…"
  },
  livePreview: { zh: "实时预览", en: "Live preview" },
  previewEmpty: { zh: "〔暂无内容〕", en: "(nothing yet)" },
  variablesSummary: { zh: "变量", en: "Variables" },
  newVarPlaceholder: { zh: "新变量名", en: "new variable name" },
  addVariable: { zh: "添加", en: "Add" },
  defaultValuePlaceholder: { zh: "默认值", en: "default value" },
  requiredLabel: { zh: "必填", en: "required" },
  noVariables: { zh: "暂无变量。", en: "No variables yet." },
  previewSelectionPlaceholder: { zh: "〔选中的段落文本〕", en: "[selected passage text]" },
  previewSourceTitlePlaceholder: { zh: "〔来源标题〕", en: "[source title]" },
  previewNotesPlaceholder: { zh: "〔已有笔记内容〕", en: "[existing note content]" },

  // —— builder actions ——
  save: { zh: "保存", en: "Save" },
  tryIt: { zh: "试一下", en: "Try it" },
  tryHint: {
    zh: "保存并通过生成预览运行",
    en: "Save and run through the generation preview"
  },
  restoreDefault: { zh: "恢复内置默认", en: "Restore default" },
  restoreDefaultHint: {
    zh: "恢复该内置动作的默认模板",
    en: "Restore the built-in default template"
  },

  // —— manager list ——
  managerTitle: { zh: "动作排序与启停", en: "Action toolbar order" },
  editButton: { zh: "编辑", en: "Edit" },
  deleteAria: { zh: "删除动作", en: "Delete action" },
  customizeBuiltin: { zh: "自定义此动作", en: "Customize this action" },
  forkSuffix: { zh: "（我的副本）", en: " (my copy)" },
  emptyManager: { zh: "暂无动作。", en: "No actions yet." },
  deleteConfirm: { zh: "删除“{name}”这个动作？", en: 'Delete the "{name}" action?' },

  // —— error fallbacks (server errors show their own message verbatim) ——
  saveFailed: { zh: "保存动作失败", en: "Failed to save operation" },
  deleteFailed: { zh: "删除动作失败", en: "Failed to delete operation" },
  forkFailed: { zh: "复制动作失败", en: "Failed to fork action" },
  prefsFailed: { zh: "保存动作偏好失败", en: "Failed to save action prefs" },
  toolbarPrefsFailed: { zh: "保存工具栏偏好失败", en: "Failed to save toolbar prefs" },
  iconFailed: { zh: "保存图标失败", en: "Failed to save icon" },
  resetToolbarFailed: { zh: "重置工具栏失败", en: "Failed to reset toolbar" }
});
