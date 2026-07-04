// Strings for source authoring (SRC-1/2): the Library 新建 entries + the authored
// editor view (阅读 ⇄ 编辑, kid-first markdown toolbar, 受影响的锚点, shared warning).
// Own file (not libraryMessages.ts) so the contended library files only gain imports.
import { defineMessages } from "../i18n";

export const sourceAuthoringMessages = defineMessages({
  // —— Library 新建 group ——
  createMarkdown: { zh: "新建 Markdown", en: "New Markdown" },
  createHtml: { zh: "新建 HTML 页", en: "New HTML page" },
  newMarkdownTitle: { zh: "未命名文档", en: "Untitled document" },
  newHtmlTitle: { zh: "未命名网页", en: "Untitled page" },

  // —— editor chrome ——
  modeRead: { zh: "阅读", en: "Read" },
  modeEdit: { zh: "编辑", en: "Edit" },
  save: { zh: "保存", en: "Save" },
  saving: { zh: "保存中…", en: "Saving…" },
  unsaved: { zh: "未保存", en: "Unsaved" },
  savedJustNow: { zh: "已保存", en: "Saved" },
  titleLabel: { zh: "标题", en: "Title" },
  loadFailed: { zh: "内容加载失败,请重试。", en: "Failed to load the content, please retry." },
  saveFailed: { zh: "保存失败,请重试。", en: "Save failed, please retry." },
  emptyReadHint: {
    zh: "这篇文档还是空的,点「编辑」开始写。",
    en: "This document is still empty — hit “Edit” to start writing."
  },

  // —— kid-first markdown toolbar (buttons insert/wrap; zero syntax knowledge needed) ——
  toolbarBold: { zh: "加粗", en: "Bold" },
  toolbarHeading: { zh: "大标题", en: "Heading" },
  toolbarSubheading: { zh: "小标题", en: "Subheading" },
  toolbarList: { zh: "列表", en: "List" },
  toolbarOrderedList: { zh: "编号", en: "Numbered" },
  toolbarQuote: { zh: "引用", en: "Quote" },
  boldPlaceholder: { zh: "加粗文字", en: "bold text" },
  headingPlaceholder: { zh: "标题", en: "Heading" },
  listItemPlaceholder: { zh: "列表项", en: "List item" },
  quotePlaceholder: { zh: "引用内容", en: "Quoted text" },
  editorPlaceholder: {
    zh: "在这里打字就行。想要标题、加粗或列表,点上面的大按钮。",
    en: "Just type here. Use the big buttons above for headings, bold, or lists."
  },
  previewTitle: { zh: "效果预览", en: "Preview" },
  previewEmpty: { zh: "右边会实时显示你写的效果。", en: "What you write shows up here live." },

  // —— html source editing (rich editing is SRC-4) ——
  htmlEditorHint: {
    zh: "HTML 源码编辑;可视化编辑在后续版本提供。",
    en: "HTML source editing; visual editing arrives in a later version."
  },
  htmlEditorPlaceholder: { zh: "<h1>标题</h1>\n<p>正文…</p>", en: "<h1>Title</h1>\n<p>Body…</p>" },

  // —— save pipeline surfacing ——
  affectedTitle: { zh: "受影响的锚点", en: "Affected anchors" },
  affectedHint: {
    zh: "这些划线在新内容里找不到原文了。可以回到阅读模式,重新划一次。",
    en: "These highlights no longer find their passage in the new content. Switch to Read and re-mark them."
  },
  affectedFuzzy: { zh: "模糊匹配", en: "fuzzy match" },
  affectedUnmatched: { zh: "未匹配", en: "unmatched" },
  affectedJump: { zh: "去阅读模式查看", en: "View in Read mode" },
  affectedDismiss: { zh: "知道了", en: "Got it" },

  // —— shared-source warning (before the FIRST edit of a shared source) ——
  sharedEditWarning: {
    zh: "已分享过的文档,编辑会使旧分享包无法绑定。仍要编辑吗?",
    en: "This document has been shared — editing will break the binding of previously shared packs. Edit anyway?"
  }
});
