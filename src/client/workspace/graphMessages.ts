// Every user-visible string of the CORE concept graph (CG-3) in ONE typed
// dictionary — the 列表/图谱 mode toggle, the graph toolbar (search / lens picker /
// top-N expand), the stats line and empty states. zh/en enforced by Message.
// React-free on purpose (mirrors conceptMessages.ts).

import { defineMessages } from "../i18n";

export const graphMessages = defineMessages({
  // —— pane mode toggle (Concepts pane header) ——
  listMode: { zh: "列表", en: "List" },
  graphMode: { zh: "图谱", en: "Graph" },

  // —— toolbar ——
  searchPlaceholder: { zh: "搜索知元…", en: "Search concepts…" },
  lensPicker: { zh: "透镜", en: "Lens" },
  defaultLens: { zh: "默认", en: "Default" },
  expandAll: { zh: "展开全部", en: "Show all" },
  cappedNotice: { zh: "仅显示前 {n} 个", en: "Top {n} shown" },

  // —— stats + states ——
  stats: { zh: "{nodes} 知元 · {edges} 关联", en: "{nodes} concepts · {edges} links" },
  loading: { zh: "图谱加载中…", en: "Loading graph…" },
  empty: {
    zh: "还没有知元 —— 选中文字 → 标为知元，或在笔记里写 [[名词]]。",
    en: "No concepts yet — select text → Mark as concept, or write [[term]] in a note."
  },
  noMatches: { zh: "没有匹配的知元。", en: "No matching concepts." },

  // —— legend (the built-in default lens) ——
  legendStored: { zh: "已建关系", en: "Stored relation" },
  legendDerived: { zh: "共现（推导）", en: "Co-occurrence (derived)" }
});

/** Tiny {token} filler for the two parameterized strings above. */
export function fillMessage(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole
  );
}
