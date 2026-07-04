// Every user-visible string of the redesigned Library pane (LIB-2), in ONE typed
// dictionary — the shell (views.tsx LibraryView) and the built-in sections/add-actions
// (libraryBuiltins.tsx) both read from here, so no Library literal is hardcoded and the
// zh/en pair is enforced by the Message type. React-free on purpose.

import { defineMessages } from "../i18n";

export const libraryMessages = defineMessages({
  // —— header ——
  title: { zh: "资料库", en: "Library" },
  searchPlaceholder: { zh: "搜索…", en: "Search…" },
  refresh: { zh: "刷新", en: "Refresh" },
  add: { zh: "添加到资料库", en: "Add to library" },

  // —— the unified + menu ——
  groupImport: { zh: "导入", en: "Import" },
  groupCreate: { zh: "新建", en: "Create" },
  importFile: { zh: "文件…", en: "File…" },
  importWeb: { zh: "网页…", en: "Web page…" },
  mountFolder: { zh: "挂载文件夹…", en: "Mount folder…" },
  fetchUrl: { zh: "抓取网页", en: "Fetch page" },
  openLive: { zh: "实时打开", en: "Open live" },
  urlPlaceholder: { zh: "https://…", en: "https://…" },
  createDocument: { zh: "文档…", en: "Document…" },
  desktopOnly: { zh: "仅桌面端可用", en: "Desktop app only" },
  desktopOnlyHint: { zh: "打开本地文件/文件夹仅桌面端可用。", en: "File/folder open is desktop-only." },

  // —— sections ——
  sectionRecent: { zh: "最近", en: "Recent" },
  sectionDocuments: { zh: "文档", en: "Documents" },
  sectionFolders: { zh: "文件夹", en: "Folders" },
  collapseSection: { zh: "折叠", en: "Collapse" },
  expandSection: { zh: "展开", en: "Expand" },
  emptyRecent: { zh: "还没有阅读记录。", en: "No recent reads yet." },
  emptyDocuments: { zh: "点 + 导入第一份资料", en: "Click + to import your first document" },
  emptyFolders: { zh: "点 + 挂载本地文件夹", en: "Click + to mount a local folder" },
  noMatches: { zh: "没有匹配的条目。", en: "No matching items." },

  // —— document rows / chips ——
  typeFilter: { zh: "类型筛选", en: "Filter by type" },
  chipAll: { zh: "全部", en: "All" },
  chipPdf: { zh: "PDF", en: "PDF" },
  chipWeb: { zh: "网页", en: "Web" },
  chipImage: { zh: "图片", en: "Images" },
  chipHtml: { zh: "HTML", en: "HTML" },
  chipMarkdown: { zh: "MD", en: "MD" },
  chipWord: { zh: "Word", en: "Word" },
  chipCode: { zh: "代码", en: "Code" },
  removeDocument: { zh: "移除这份资料", en: "Remove this document" },
  closeFolder: { zh: "关闭文件夹", en: "Close folder" },

  // —— 新建文档 seed ——
  newDocumentTitle: { zh: "未命名文档", en: "Untitled document" },
  newDocumentBody: { zh: "从这里开始记录。", en: "Start writing here." }
});
