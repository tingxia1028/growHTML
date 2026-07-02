// Subject Auto-Switch detection engine (docs/design/subject-kits.md PART 3, milestone
// M-A) — the document-level analog of classifyContent (src/core/notes/classifyContent.ts):
// a PURE, deterministic, explainable scorer that maps a source's cheap signals (title /
// sourceType / an optional body sample) to the subject KIT that fits the document.
//
// Post-F4 adaptation. The design's §3.1 `SubjectProfile{subjectId,kitId}` predates M1;
// since F4 the per-source "active kit" means FOREGROUND ORDERING, never a filter
// (availability = src/kits/installState.ts effective-installed). Detection therefore
// resolves straight to a KIT id — the kit IS the subject handle — and `subjectId` is
// dropped. M-B's five subject kits each register one table; M-A seeds only the textbook
// kit's table as the stand-in (design PART 5).
//
// The F7 lesson (core never hardcodes a kit taxonomy): this module owns only the
// MECHANISM — the registry + the scorer. The keyword/pattern TABLES are registered PER
// KIT via the KitLayerPolicy precedent: a React-free `detection` field on ProductKit
// (src/kits/types.ts), registered by BOTH installServerKits (src/kits/server.ts) and
// installClientKits (src/kits/clientContext.tsx) so client and server resolve the same
// foreground. Core imports no kit.
//
// Contract (classifyContent's, §3.2):
//   • Pure: no React, no fetch, no DOM. Same input + same tables ⇒ same output
//     (title patterns are probed with String.search, so a stray /g flag can never leak
//     lastIndex state between calls).
//   • NEVER throws: a broken table scores 0; a pathological input yields the none-result.
//   • Deterministic total order: score DESC → weight DESC → kitId ASC — no flapping.
//   • Explainable: a candidate's signals[] points sum to its confidence (pre-clamp), so
//     the chip can show exactly WHY a kit won.

// —— table shape (what a kit registers) ————————————————————————————————————————

export type KitDetectionContentSignals = {
  /** Min LaTeX hits ($…$ / \( / \[) per 1000 chars of the body sample to fire. */
  latexDensity?: number;
  /** Dominant script expected in the body sample (weak signal, low weight by design). */
  langHint?: "en" | "zh" | "mixed";
  /** Literal body markers (element symbols, classical particles, 例题/习题, …).
      Case-sensitive on purpose — "NaCl"/"mol" style markers carry their case. */
  keywords?: string[];
};

export type KitDetectionTable = {
  /** The kit this table argues for (a CatalogEntry kind:"kit" id). */
  kitId: string;
  /** Case-insensitive substring matches on the source title (bilingual). */
  titleKeywords: string[];
  /** Word-boundary / anchored regexes over the title. */
  titlePatterns: RegExp[];
  /** Weak sourceType hints (src/core/schema/source.ts sourceTypeSchema values). */
  sourceTypes?: string[];
  /** Optional body-sample probes (callers that have no sample simply skip these). */
  contentSignals?: KitDetectionContentSignals;
  /** Deterministic tie-break scaler (default 1). NOTE — deviation from §3.2's
      "× weight normalized": weight is a PURE tie-breaker here, never multiplied into
      the score, so signals[] keep summing to the confidence (explainability wins). */
  weight?: number;
};

// —— engine input / output ————————————————————————————————————————————————————

export type DetectionInput = {
  title?: string;
  sourceType?: string;
  /** Optional body sample. The activation resolver passes none today (source records
      carry no body) — title alone clears the threshold by design (§3.2). */
  contentSample?: string;
};

export type DetectionSignalKind =
  | "title-keyword"
  | "title-pattern"
  | "source-type"
  | "latex-density"
  | "lang-hint"
  | "content-keyword";

export type DetectionSignal = {
  kind: DetectionSignalKind;
  /** The concrete probe that fired (first match in table order — deterministic). */
  value: string;
  /** The points this signal contributed (each bucket fires at most once). */
  points: number;
};

export type KitDetectionCandidate = {
  kitId: string;
  /** min(1, Σ signals.points) — clamped score in [0, 1]. */
  confidence: number;
  signals: DetectionSignal[];
  /** The table's tie-break weight (echoed for explainability). */
  weight: number;
};

export type KitDetectionResult = {
  /** The winning kit when its confidence clears DETECTION_THRESHOLD; null otherwise. */
  kitId: string | null;
  confidence: number;
  signals: DetectionSignal[];
  /** Every positive-scoring candidate, sorted score DESC → weight DESC → kitId ASC.
      Scored over ALL registered tables (§3.2: an uninstalled kit may still top the
      list — the resolver decides what to do with it; §3.5's suggestion seam). */
  candidates: KitDetectionCandidate[];
};

// —— scoring constants (§3.2) ——————————————————————————————————————————————————
// Integer points (out of 100) so tie comparisons are exact — no float-sum drift can
// make two "equal" scores differ in the last bit and destabilize the total order.

const TITLE_POINTS = 60; // a title hit ALONE clears the threshold (strong)
const SOURCE_TYPE_POINTS = 10; // weak hint
const LATEX_POINTS = 30;
const LANG_POINTS = 30;
const CONTENT_KEYWORD_POINTS = 20;
const MAX_POINTS = 100;

/** Winner must score ≥ this (0.35): a title hit qualifies, a sourceType hint alone never does. */
export const DETECTION_THRESHOLD = 0.35;
const THRESHOLD_POINTS = 35;

// Language-ratio probe bounds: judge only samples with enough letters, call a script
// dominant at ≥75%, call it mixed when both scripts hold ≥25%.
const LANG_MIN_LETTERS = 40;
const LANG_DOMINANT_RATIO = 0.75;
const LANG_MIXED_MIN_RATIO = 0.25;

// A LaTeX hit: an inline $…$ pair (single line, bounded) or a \( / \[ opener.
const LATEX_HIT_RE = /\$[^$\n]{1,120}\$|\\\(|\\\[/g;

// —— the registry (KitLayerPolicy precedent: module-scope, idempotent per kit) ————

const tables: KitDetectionTable[] = [];

/** Register a kit's detection table. Idempotent per kitId (re-install / test re-import
    must not duplicate — same rule as registerKitLayerPolicy). */
export function registerKitDetection(table: KitDetectionTable): void {
  if (tables.some((t) => t.kitId === table.kitId)) return;
  tables.push(table);
}

export function listKitDetections(): readonly KitDetectionTable[] {
  return tables;
}

/** Test hook — drops all registered tables (resetKitLanguages precedent). */
export function resetKitDetections(): void {
  tables.length = 0;
}

// —— per-bucket probes (each fires at most once; value = the first matching probe) ——

function titleSignal(table: KitDetectionTable, title: string): DetectionSignal | null {
  const haystack = title.toLowerCase();
  for (const keyword of table.titleKeywords ?? []) {
    if (keyword && haystack.includes(keyword.toLowerCase())) {
      return { kind: "title-keyword", value: keyword, points: TITLE_POINTS / 100 };
    }
  }
  for (const pattern of table.titlePatterns ?? []) {
    // String.search ignores /g and never mutates lastIndex — deterministic re-runs.
    if (title.search(pattern) !== -1) {
      return { kind: "title-pattern", value: String(pattern), points: TITLE_POINTS / 100 };
    }
  }
  return null;
}

function sourceTypeSignal(table: KitDetectionTable, sourceType: string): DetectionSignal | null {
  if ((table.sourceTypes ?? []).includes(sourceType)) {
    return { kind: "source-type", value: sourceType, points: SOURCE_TYPE_POINTS / 100 };
  }
  return null;
}

function latexSignal(minPerThousand: number, sample: string): DetectionSignal | null {
  const hits = sample.match(LATEX_HIT_RE)?.length ?? 0;
  if (hits === 0) return null;
  const perThousand = (hits * 1000) / Math.max(sample.length, 1);
  if (perThousand < minPerThousand) return null;
  return {
    kind: "latex-density",
    value: `${hits} hits ≈ ${perThousand.toFixed(1)}/1k (min ${minPerThousand})`,
    points: LATEX_POINTS / 100
  };
}

function langSignal(hint: "en" | "zh" | "mixed", sample: string): DetectionSignal | null {
  let cjk = 0;
  let latin = 0;
  for (const ch of sample) {
    if (ch >= "一" && ch <= "鿿") cjk += 1;
    else if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z")) latin += 1;
  }
  const total = cjk + latin;
  if (total < LANG_MIN_LETTERS) return null; // too small to judge — the weakest signal stays silent
  const cjkRatio = cjk / total;
  const latinRatio = latin / total;
  const matched =
    hint === "en"
      ? latinRatio >= LANG_DOMINANT_RATIO
      : hint === "zh"
        ? cjkRatio >= LANG_DOMINANT_RATIO
        : cjkRatio >= LANG_MIXED_MIN_RATIO && latinRatio >= LANG_MIXED_MIN_RATIO;
  if (!matched) return null;
  return {
    kind: "lang-hint",
    value: `${hint} (cjk ${(cjkRatio * 100).toFixed(0)}% / latin ${(latinRatio * 100).toFixed(0)}%)`,
    points: LANG_POINTS / 100
  };
}

function contentKeywordSignal(keywords: string[], sample: string): DetectionSignal | null {
  for (const keyword of keywords) {
    if (keyword && sample.includes(keyword)) {
      return { kind: "content-keyword", value: keyword, points: CONTENT_KEYWORD_POINTS / 100 };
    }
  }
  return null;
}

// —— the scorer ————————————————————————————————————————————————————————————————

/**
 * Score ONE table against an input. Explainable: the returned signals each name the
 * probe that fired; their points sum to the (pre-clamp) confidence. Never throws — a
 * broken table degrades to a zero candidate.
 */
export function scoreKitDetection(table: KitDetectionTable, input: DetectionInput): KitDetectionCandidate {
  const weight = typeof table.weight === "number" ? table.weight : 1;
  const signals: DetectionSignal[] = [];
  try {
    const title = typeof input.title === "string" ? input.title : "";
    const sample = typeof input.contentSample === "string" ? input.contentSample : "";

    if (title) {
      const hit = titleSignal(table, title);
      if (hit) signals.push(hit);
    }
    if (typeof input.sourceType === "string" && input.sourceType) {
      const hit = sourceTypeSignal(table, input.sourceType);
      if (hit) signals.push(hit);
    }
    const content = table.contentSignals;
    if (content && sample) {
      if (typeof content.latexDensity === "number") {
        const hit = latexSignal(content.latexDensity, sample);
        if (hit) signals.push(hit);
      }
      if (content.langHint) {
        const hit = langSignal(content.langHint, sample);
        if (hit) signals.push(hit);
      }
      if (content.keywords?.length) {
        const hit = contentKeywordSignal(content.keywords, sample);
        if (hit) signals.push(hit);
      }
    }
  } catch {
    // Total: a malformed table (bad regex list, non-array keywords, …) scores nothing
    // rather than killing detection for every other kit.
    return { kitId: String(table?.kitId ?? ""), confidence: 0, signals: [], weight };
  }
  const points = signals.reduce((sum, signal) => sum + Math.round(signal.points * 100), 0);
  return {
    kitId: table.kitId,
    confidence: Math.min(points, MAX_POINTS) / 100,
    signals,
    weight
  };
}

/**
 * Detect the subject kit for a source (§3.2 steps 2–3; the pin — step 1 — lives in the
 * activation resolver, src/kits/activation.ts). Scores every registered table, keeps the
 * positive candidates in the deterministic total order, and names a winner only when the
 * top candidate clears DETECTION_THRESHOLD. Never throws.
 */
export function detectKit(
  input: DetectionInput,
  candidates: readonly KitDetectionTable[] = listKitDetections()
): KitDetectionResult {
  const none: KitDetectionResult = { kitId: null, confidence: 0, signals: [], candidates: [] };
  try {
    if (!input || typeof input !== "object") return none;
    const scored = candidates
      .map((table) => scoreKitDetection(table, input))
      .filter((candidate) => candidate.kitId && candidate.confidence > 0)
      .sort(
        (a, b) =>
          b.confidence - a.confidence ||
          b.weight - a.weight ||
          (a.kitId < b.kitId ? -1 : a.kitId > b.kitId ? 1 : 0)
      );
    const top = scored[0];
    if (top && Math.round(top.confidence * 100) >= THRESHOLD_POINTS) {
      return { kitId: top.kitId, confidence: top.confidence, signals: top.signals, candidates: scored };
    }
    return { ...none, candidates: scored };
  } catch {
    return none;
  }
}
