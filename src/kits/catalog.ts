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

// FLAT (docs/design/kit-flatten-and-core-review.md §2): the user-facing extension unit
// is the KIT ONLY. A capability group (能力组) is a kit's INTERNAL structure — the old
// "member plugin" demoted from install unit to a named, toggleable slice of one kit.
// Member plugin ids are PRESERVED inside `members` (contribution wiring, ownership,
// uninstall-data law all keep keying on plugin ids); only presentation + install state
// flatten to the kit.
export type KitCapabilityGroup = {
  id: string;
  /** Bilingual display name — the manager resolves per locale (no zh/en mixing). */
  name: { zh: string; en: string };
  description?: { zh: string; en: string };
  /** The member plugin ids whose contributions this group governs. */
  members: string[];
  /** false = the group starts DISABLED on a fresh/default install (opt-in capability,
      e.g. the per-subject groups — the old NOT-default-installed subject kits). */
  defaultEnabled?: boolean;
};

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
  /** kits: capability groups (FLAT §2) — the kit's internal structure. Every group
      member must also appear in `members`. Kits without groups present each member as
      its own implicit group (see kitCapabilityGroups). */
  groups?: KitCapabilityGroup[];
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
  // (b) the textbook kit's member plugins (F5, §8.10). FLAT §2: these are no longer
  // install units — each is GROUP-OWNED by the Textbook Kit below (defaultInstalled
  // flips to false; availability flows from the kit's enabled groups). The entries stay
  // cataloged as the internal read model (names + the provides/ownership index).
  {
    id: "explanation",
    kind: "plugin",
    name: "讲解 Explanation",
    icon: "sparkles",
    description: "Explain a focused passage as a structured study block.",
    author: "growte",
    provides: ["textbook.explanation"],
    defaultInstalled: false,
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
    defaultInstalled: false,
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
    defaultInstalled: false,
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
    defaultInstalled: false,
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
    defaultInstalled: false,
    source: "bundled"
  },
  // (REV-CORE: the review loop is CORE — the mission loop is not a market good, so it
  // has NO catalog entry. Stale `"review"` ids in a vault's persisted catalogState are
  // harmless: uncataloged ids are treated as always-available and never listed.)
  // (b) subject exemplar plugins (subject-kits.md M-B). FLAT §2: group-owned by the
  // Textbook Kit's per-subject groups (defaultEnabled:false) — enabling the group
  // lights up their create affordances (slash/composer/toolbar); rendering is never
  // gated.
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
  // (b) subject M-C plugins (subject-kits.md M-C). Group-owned by the Textbook Kit's
  // per-subject groups; `provides` powers providerOf() import prompts (§8.7).
  {
    id: "subject-derivation",
    kind: "plugin",
    name: "推导步骤 Derivation",
    icon: "list-ordered",
    description: "推导步骤:逐步 LaTeX 推导,每步可展开理由,结果高亮.",
    author: "growte",
    provides: ["subject.derivation"],
    defaultInstalled: false,
    source: "bundled"
  },
  {
    id: "subject-theorem",
    kind: "plugin",
    name: "定理卡 Theorem",
    icon: "scroll-text",
    description: "定理卡:定理内容(LaTeX)+ 条件 + 证明(可折叠)+ 用法 + 用例.",
    author: "growte",
    provides: ["subject.theorem"],
    defaultInstalled: false,
    source: "bundled"
  },
  {
    id: "subject-grammar",
    kind: "plugin",
    name: "语法点 Grammar",
    icon: "languages",
    description: "语法点:结构 + 含义 + 模板 + 例句 + 易错点(警示样式).",
    author: "growte",
    provides: ["subject.grammar"],
    defaultInstalled: false,
    source: "bundled"
  },
  {
    id: "subject-excerpt",
    kind: "plugin",
    name: "摘抄赏析 Excerpt",
    icon: "quote",
    description: "摘抄赏析:名句引用 + 出处 + 修辞手法 + 主题 + 赏析.",
    author: "growte",
    provides: ["subject.excerpt"],
    defaultInstalled: false,
    source: "bundled"
  },
  {
    id: "subject-argument",
    kind: "plugin",
    name: "论证结构 Argument",
    icon: "scale",
    description: "论证结构:图尔敏式论点/论据/推理/证据/反驳/结论树.",
    author: "growte",
    provides: ["subject.argument"],
    defaultInstalled: false,
    source: "bundled"
  },
  {
    id: "subject-figure",
    kind: "plugin",
    name: "人物卡 Figure",
    icon: "user-round",
    description: "人物卡:时代/身份 + 事迹 + 作品 + 意义 + 人物关系.",
    author: "growte",
    provides: ["subject.figure"],
    defaultInstalled: false,
    source: "bundled"
  },
  {
    id: "subject-cause-effect",
    kind: "plugin",
    name: "因果链 Cause-Effect",
    icon: "waypoints",
    description: "因果链:起因(按类别)→ 核心事件 → 结果(短期/长期).",
    author: "growte",
    provides: ["subject.cause-effect"],
    defaultInstalled: false,
    source: "bundled"
  },
  {
    id: "subject-experiment",
    kind: "plugin",
    name: "实验记录 Experiment",
    icon: "flask-conical",
    description: "实验记录:目的/材料/编号步骤/现象/结论 + 安全提示(警示样式).",
    author: "growte",
    provides: ["subject.experiment"],
    defaultInstalled: false,
    source: "bundled"
  },
  // (c) THE kit (FLAT §2 + §4): ONE Textbook Kit. The old 5 member plugins re-declare
  // as 5 capability groups; the old subject kits (english/math/history-geo — separate
  // kits only because of the old model) merge in as per-subject groups, opt-in like the
  // NOT-default-installed kits they were. Member plugin ids preserved throughout.
  {
    id: "textbook-learning",
    kind: "kit",
    name: "Textbook Kit",
    icon: "book-open",
    description:
      "Turn a source into a textbook: explain passages, generate practice, track mistakes, review — with per-subject card types (英语/数学/史地).",
    author: "growte",
    members: [
      "explanation",
      "practice",
      "mistake",
      "review-pack",
      "textbook-language",
      // subject M-B + M-C member plugins (the 11 subject types). Shared plugins
      // (subject-excerpt/-figure/-formula) appear once here; group membership below
      // encodes the multi-subject overlap (§8.5.2 refcount).
      "subject-vocab",
      "subject-formula",
      "subject-timeline",
      "subject-derivation",
      "subject-theorem",
      "subject-grammar",
      "subject-excerpt",
      "subject-argument",
      "subject-figure",
      "subject-cause-effect",
      "subject-experiment"
    ],
    groups: [
      { id: "explanation", name: { zh: "讲解", en: "Explanation" }, members: ["explanation"] },
      { id: "practice", name: { zh: "练习", en: "Practice" }, members: ["practice"] },
      { id: "mistake", name: { zh: "错题", en: "Mistakes" }, members: ["mistake"] },
      { id: "review-pack", name: { zh: "复习包", en: "Review pack" }, members: ["review-pack"] },
      {
        id: "textbook-language",
        name: { zh: "教材词汇", en: "Textbook language" },
        members: ["textbook-language"]
      },
      // Per-subject groups (subject-kits.md PART 2). members[] follow the doc's kit
      // rows; shared plugins list under EVERY subject that includes them (groupOwnerOf
      // resolves to the first — the plugin's "home" — for the detail page).
      {
        id: "subject-english",
        name: { zh: "英语", en: "English" },
        description: {
          zh: "生词卡 / 语法点 / 摘抄赏析",
          en: "Vocab, grammar, and excerpt cards"
        },
        members: ["subject-vocab", "subject-grammar", "subject-excerpt"],
        defaultEnabled: false
      },
      {
        id: "subject-math",
        name: { zh: "数学", en: "Math" },
        description: {
          zh: "公式卡 / 推导步骤 / 定理卡 (LaTeX)",
          en: "Formula, derivation, and theorem cards (LaTeX)"
        },
        members: ["subject-formula", "subject-derivation", "subject-theorem"],
        defaultEnabled: false
      },
      {
        id: "subject-history-geo",
        name: { zh: "史地", en: "History & Geo" },
        description: {
          zh: "时间线 / 人物卡 / 因果链",
          en: "Timelines, figures, and cause-effect chains"
        },
        members: ["subject-timeline", "subject-figure", "subject-cause-effect"],
        defaultEnabled: false
      },
      {
        id: "subject-chinese",
        name: { zh: "语文", en: "Chinese" },
        description: {
          zh: "论证结构 (+ 摘抄赏析/人物卡)",
          en: "Argument structure (+ shared excerpt/figure)"
        },
        // FLAT install-state law: a shared plugin belongs to ONE capability group (its
        // HOME) so enabling a group never over-activates a sibling subject. 语文's shared
        // types — 摘抄赏析 (home 英语) + 人物卡 (home 史地) — render globally and carry 语文
        // language, but their CREATE affordance follows their home group. Only the 语文-
        // owned member (论证结构) gates on THIS group.
        members: ["subject-argument"],
        defaultEnabled: false
      },
      {
        id: "subject-science",
        name: { zh: "理化生", en: "Science" },
        description: {
          zh: "实验记录 (+ 公式卡/概念图)",
          en: "Experiment records (+ shared formula/diagrams)"
        },
        // 公式卡 is home to 数学 (shared, §8.5.2 refcount) — it stays out of THIS group's
        // membership so enabling 理化生 lights only 实验记录, not 公式卡's siblings.
        members: ["subject-experiment"],
        defaultEnabled: false
      }
    ],
    defaultInstalled: true,
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

/** Attach preview fixtures to a cataloged entry (M2a — the market detail preview,
    §8.4.3). Kept as a SEAM (not a literal on the entry) so catalog.ts stays free of the
    prompt-pack imports the fixtures reuse: catalogPreview.ts owns the shapes + calls this
    once at load, and it re-runs cleanly after resetCatalog rebuilds the bundled array. */
export function setPreviewFixtures(id: string, fixtures: NonNullable<CatalogEntry["previewFixtures"]>): void {
  const entry = entries.find((e) => e.id === id);
  if (entry) entry.previewFixtures = fixtures;
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

// —— FLAT §2: capability-group reads ————————————————————————————————————————————

/** A catalog kit's capability groups. Kits without a `groups` declaration present each
    member as its own implicit group (id == member id, default enabled) so the group
    model is total over kits. [] for plugins/unknown ids. */
export function kitCapabilityGroups(kitId: string): readonly KitCapabilityGroup[] {
  const entry = getCatalogEntry(kitId);
  if (entry?.kind !== "kit") return [];
  if (entry.groups) return entry.groups;
  return (entry.members ?? []).map((memberId) => ({
    id: memberId,
    name: {
      zh: getCatalogEntry(memberId)?.name ?? memberId,
      en: getCatalogEntry(memberId)?.name ?? memberId
    },
    members: [memberId]
  }));
}

/** The kit+group that OWNS a plugin id (FLAT: group-owned plugins are not install
    units), or undefined for standalone/uncataloged plugins. */
export function groupOwnerOf(pluginId: string): { kitId: string; groupId: string } | undefined {
  for (const entry of entries) {
    if (entry.kind !== "kit" || !entry.groups) continue;
    for (const group of entry.groups) {
      if (group.members.includes(pluginId)) return { kitId: entry.id, groupId: group.id };
    }
  }
  return undefined;
}

/** Group ids that start DISABLED by default for a kit (the opt-in groups). */
export function defaultDisabledGroupIds(kitId: string): string[] {
  return kitCapabilityGroups(kitId)
    .filter((group) => group.defaultEnabled === false)
    .map((group) => group.id);
}
