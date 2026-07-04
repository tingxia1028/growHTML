// Marketplace catalog — the market's READ MODEL (docs/design/plugin-viewer-model.md §8.2).
// React-free peer of ./plugin.ts. A CatalogEntry describes what CAN be installed plus its
// market presentation; the plugin read model (PluginRecord) stays the RUNTIME truth of what
// is registered in this session. V1 = a static, bundled array (all plugin code ships in the
// app bundle); the types are shaped so a remote registry can back the SAME UI later (§8.9).
//
// Layer rules (§8.1):
//   (a) core primitives (markdown / code-snippet / image / audio / video / html-sandbox and
//       the legacy plain-text alias) are HIDDEN — always-on infrastructure, never listed;
//   (b) plugins are the market's item unit — flashcard / quiz / bookmark / diagrams /
//       table-viewer / the textbook members (the review loop is CORE since REV-CORE);
//   (c) kits are bundles of plugin refs (members[]) + kit-level config (layout / policy).
//
// `id` doubles as the pluginId (kind:"plugin") / kitId (kind:"kit") used everywhere else
// (PluginRecord.id, namespaceId(), NoteTypePlugin.pluginId) — the market joins catalog and
// read model by this id.

import type { Contribution } from "./plugin";

export type CatalogEntry = {
  id: string;
  kind: "plugin" | "kit";
  name: string;
  /** lucide icon name (same convention as KitSurfaceItem.icon). */
  icon?: string;
  description: string;
  /** Informational in V1 (bundled == app version). */
  version?: string;
  /** "growte" for official entries. */
  author?: string;
  /** Detail-page live preview fixtures (M2 — §8.4.3). Unused in M1. */
  previewFixtures?: { contentType: string; sampleContent: unknown; label?: string }[];
  /** plugins: the contributions installing this plugin activates (same Contribution shape
      as the read model). Optional in V1 — the market joins the runtime read model by id. */
  contributions?: Contribution[];
  /** plugins: the contentTypes this plugin PROVIDES (its noteType contribution keys).
      This is the import-resolution index (§8.7): contentType → providing plugin. */
  provides?: string[];
  /** kits: member plugin ids — each must resolve to a kind:"plugin" entry. */
  members?: string[];
  /** Counts as installed while catalogState is null (back-compat, §8.3). true for every
      V1 bundled entry, since everything shipping today is active today. */
  defaultInstalled?: boolean;
  /** V1: always "bundled". A future remote registry adds "registry" + acquisition
      metadata WITHOUT changing this UI contract (§8.9). */
  source?: "bundled" | "registry";
};

// —— The V1 bundled catalog (§8.1 classification table) ————————————————————————
// Every entry is defaultInstalled (everything shipping today is active today), so a vault
// whose catalogState is null behaves byte-for-byte as before the market existed.
const BUNDLED_CATALOG: CatalogEntry[] = [
  // (b) built-in plugins reclassified out of the synthetic "core" seed (F5)
  {
    id: "flashcard",
    kind: "plugin",
    name: "Flashcard",
    icon: "credit-card",
    description: "Two-sided recall cards for spaced recall.",
    author: "growte",
    provides: ["flashcard"],
    defaultInstalled: true,
    source: "bundled"
  },
  {
    id: "quiz",
    kind: "plugin",
    name: "Quiz",
    icon: "list-checks",
    description: "Single-choice questions with answers and explanations.",
    author: "growte",
    provides: ["quiz"],
    defaultInstalled: true,
    source: "bundled"
  },
  {
    id: "bookmark",
    kind: "plugin",
    name: "Bookmark",
    icon: "bookmark",
    description: "Named markers on passages — the bookmark workflow (chip + pane).",
    author: "growte",
    provides: ["bookmark"],
    defaultInstalled: true,
    source: "bundled"
  },
  {
    id: "diagrams",
    kind: "plugin",
    name: "Diagrams",
    icon: "workflow",
    description: "Mermaid flowcharts and markmap mind maps as note types.",
    author: "growte",
    // One plugin providing both diagram types (+ the hidden legacy mindmap alias).
    provides: ["mermaid", "markmap", "mindmap"],
    defaultInstalled: true,
    source: "bundled"
  },
  {
    id: "table-viewer",
    kind: "plugin",
    name: "Table viewer",
    icon: "table",
    description: "Renders markdown pipe tables as real tables (viewer over markdown).",
    author: "growte",
    provides: [],
    defaultInstalled: true,
    source: "bundled"
  },
  // (b) the textbook kit decomposed into real member plugins (F5, §8.10)
  {
    id: "explanation",
    kind: "plugin",
    name: "讲解 Explanation",
    icon: "sparkles",
    description: "Explain a focused passage as a structured study block.",
    author: "growte",
    provides: ["textbook.explanation"],
    defaultInstalled: true,
    source: "bundled"
  },
  {
    id: "practice",
    kind: "plugin",
    name: "练习 Practice",
    icon: "list-checks",
    description: "Generate practice questions from a passage.",
    author: "growte",
    provides: ["textbook.exercise"],
    defaultInstalled: true,
    source: "bundled"
  },
  {
    id: "mistake",
    kind: "plugin",
    name: "错题 Mistake",
    icon: "triangle-alert",
    description: "Log a passage as a mistake for later review.",
    author: "growte",
    // REV-CORE: the 错题 TYPE is a core built-in (always available, never gated);
    // this plugin now provides only the mark-as-mistake command + toolbar surface.
    provides: [],
    defaultInstalled: true,
    source: "bundled"
  },
  {
    id: "review-pack",
    kind: "plugin",
    name: "复习包 Review Pack",
    icon: "star",
    description: "Synthesize a source's study blocks into a chapter-level review pack.",
    author: "growte",
    provides: ["textbook.review-pack"],
    defaultInstalled: true,
    source: "bundled"
  },
  {
    id: "textbook-language",
    kind: "plugin",
    name: "Textbook language",
    icon: "languages",
    description: "Domain vocabulary: Source→Textbook, Anchor→Knowledge Point, ….",
    author: "growte",
    provides: [],
    defaultInstalled: true,
    source: "bundled"
  },
  // (REV-CORE: the review loop is CORE — the mission loop is not a market good, so it
  // has NO catalog entry. Stale `"review"` ids in a vault's persisted catalogState are
  // harmless: uncataloged ids are treated as always-available and never listed.)
  // (b) subject exemplar plugins (subject-kits.md M-B). NOT default-installed: the
  // first true install-to-activate market goods — installing lights up their create
  // affordances (slash/composer/toolbar); rendering is never gated.
  {
    id: "subject-vocab",
    kind: "plugin",
    name: "生词卡 Vocab",
    icon: "spell-check",
    description: "生词卡:音标/词性/多释义/例句,近反义词,闪卡式翻面复习.",
    author: "growte",
    provides: ["subject.vocab"],
    defaultInstalled: false,
    source: "bundled"
  },
  {
    id: "subject-formula",
    kind: "plugin",
    name: "公式卡 Formula",
    icon: "sigma",
    description: "公式卡:KaTeX 排版的 LaTeX 公式 + 变量表(符号/含义/单位)+ 用法.",
    author: "growte",
    provides: ["subject.formula"],
    defaultInstalled: false,
    source: "bundled"
  },
  {
    id: "subject-timeline",
    kind: "plugin",
    name: "时间线 Timeline",
    icon: "history",
    description: "时间线:纵向年表,事件节点可展开细节与意义.",
    author: "growte",
    provides: ["subject.timeline"],
    defaultInstalled: false,
    source: "bundled"
  },
  // (c) kits — bundles of plugin refs + kit-level config
  {
    id: "textbook-learning",
    kind: "kit",
    name: "Textbook Learning Kit",
    icon: "book-open",
    description:
      "Turn a source into a textbook: explain passages, generate practice, track mistakes, review.",
    author: "growte",
    members: ["explanation", "practice", "mistake", "review-pack", "textbook-language"],
    defaultInstalled: true,
    source: "bundled"
  },
  // (c) subject kits (subject-kits.md PART 2, M-B slice) — members mix the new exemplar
  // plugin with EXISTING plugins (referenced, not re-created; the members-union refcount
  // §8.5.2 covers the sharing). The M-C types append to members[] when they ship.
  {
    id: "subject-english",
    kind: "kit",
    name: "英语 Kit",
    icon: "languages",
    description: "英语学习包:生词卡 + 闪卡(M-C 再加语法点/摘抄赏析).",
    author: "growte",
    members: ["subject-vocab", "flashcard"],
    defaultInstalled: false,
    source: "bundled"
  },
  {
    id: "subject-math",
    kind: "kit",
    name: "数学 Kit",
    icon: "sigma",
    description: "数学学习包:公式卡 + 错题 + 小测(M-C 再加推导/定理卡).",
    author: "growte",
    members: ["subject-formula", "mistake", "quiz"],
    defaultInstalled: false,
    source: "bundled"
  },
  {
    id: "subject-history-geo",
    kind: "kit",
    name: "史地 Kit",
    icon: "map",
    description: "史地学习包:时间线(M-C 再加人物卡/因果链).",
    author: "growte",
    members: ["subject-timeline"],
    defaultInstalled: false,
    source: "bundled"
  }
];

// Registered entries — bundled by default; tests (and, later, a remote registry adapter)
// may add entries. Insertion-ordered, de-duped by id (re-register replaces in place).
const entries: CatalogEntry[] = [...BUNDLED_CATALOG];

/** Every cataloged entry (bundled + any registered extras), stable order. */
export function listCatalogEntries(): readonly CatalogEntry[] {
  return entries;
}

export function getCatalogEntry(id: string): CatalogEntry | undefined {
  return entries.find((e) => e.id === id);
}

/** Register (or replace) a catalog entry — the test seam AND the future remote-registry
    ingestion point (§8.9). Bundled entries can be replaced by id (last-wins). */
export function registerCatalogEntry(entry: CatalogEntry): void {
  const index = entries.findIndex((e) => e.id === entry.id);
  if (index === -1) entries.push(entry);
  else entries[index] = entry;
}

/** Test hook — restore the pristine bundled catalog. */
export function resetCatalog(): void {
  entries.length = 0;
  entries.push(...BUNDLED_CATALOG);
}

/**
 * The plugin that PROVIDES a contentType (the §8.2/§8.7 import-resolution index), or
 * undefined for core primitives / unknown types. `providerOf("markdown") === undefined`
 * means "always available, nothing to install".
 */
export function providerOf(contentType: string): CatalogEntry | undefined {
  return entries.find((e) => e.kind === "plugin" && (e.provides ?? []).includes(contentType));
}

/** Member plugin ids of a catalog kit ([] for plugins/unknown ids). */
export function catalogKitMembers(kitId: string): readonly string[] {
  const entry = getCatalogEntry(kitId);
  return entry?.kind === "kit" ? entry.members ?? [] : [];
}

/** The DEFAULT-INSTALLED id set for a kind — what a null catalogState means (§8.3). */
export function defaultInstalledIds(kind: CatalogEntry["kind"]): string[] {
  return entries.filter((e) => e.kind === kind && e.defaultInstalled).map((e) => e.id);
}

/** Whether an id is cataloged at all. Uncataloged ids (core primitives, test kits) are
    OUTSIDE install state — always available, nothing to install/uninstall. */
export function isCataloged(id: string): boolean {
  return entries.some((e) => e.id === id);
}
