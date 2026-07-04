// Every user-visible string of the global-search palette (SEARCH-1), in ONE typed
// dictionary (the libraryMessages idiom — zh/en enforced by the Message type; no
// hardcoded literal in the components). React-free on purpose.

import { defineMessages } from "../i18n";

export const searchMessages = defineMessages({
  // —— palette chrome ——
  dialogLabel: { zh: "全局搜索", en: "Global search" },
  placeholder: { zh: "搜索笔记、文档、命令…", en: "Search notes, documents, commands…" },
  hint: { zh: "↑↓ 选择 · Enter 打开 · Esc 关闭", en: "↑↓ select · Enter open · Esc close" },
  empty: { zh: "没有匹配结果", en: "No results" },
  searching: { zh: "搜索中…", en: "Searching…" },

  // —— SEARCH-2 filters (design §3 — per-family narrowing) ——
  filterAll: { zh: "全部", en: "All" },
  filterLabel: { zh: "筛选", en: "Filter" },

  // —— SEARCH-2 recent searches (design §3) ——
  groupRecents: { zh: "最近搜索", en: "Recent searches" },
  clearRecents: { zh: "清除", en: "Clear" },

  // —— the three result families (design §1) ——
  groupNotes: { zh: "笔记", en: "Notes" },
  groupSources: { zh: "文档", en: "Documents" },
  groupCommands: { zh: "命令", en: "Commands" },

  // —— note-row fallbacks ——
  untitledNote: { zh: "（无标题笔记）", en: "(untitled note)" },

  // —— the commands family (navigation — 打开X, design §1's free navigation win) ——
  cmdLibrary: { zh: "打开资料库", en: "Open Library" },
  cmdConcepts: { zh: "打开知元", en: "Open Concepts" },
  cmdOperations: { zh: "打开操作管理", en: "Open Operations" },
  cmdPlugins: { zh: "打开套件管理", en: "Open Kits" },
  cmdReview: { zh: "打开复习", en: "Open Review" },
  cmdProfile: { zh: "打开画像", en: "Open Profile" },
  cmdSettings: { zh: "打开设置", en: "Open Settings" },
  cmdLayers: { zh: "打开分层", en: "Open Layers" },
  cmdBookmarks: { zh: "打开书签", en: "Open Bookmarks" },
  cmdOnboarding: { zh: "打开新手引导", en: "Open Onboarding" }
});
