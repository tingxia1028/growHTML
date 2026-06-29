// classifyContent — the ONE new mechanism behind "adaptive note forms": a PURE
// function that maps a free-text blob (a chat reply, a paste, an unlabelled note)
// to an already-registered `contentType` + a `content` value shaped for THAT type's
// core NoteContentSpec schema (src/core/notes/contentTypes.ts).
//
// Contract (design plan §3, §0.5-A):
//   • Pure: no React, no fetch, no DOM, no module-level state.
//   • NEVER throws: a bad/empty input falls back to { markdown, low }.
//   • High precision, MOST-SPECIFIC first: only `high` confidence is auto-applied by
//     the UI; `low` is the safe markdown fallback (never blocks).
//
// SCOPE — Phase 1a: ONLY the forms that ALREADY render are detected
// (mermaid / markmap / code-snippet / markdown). Video-embed and html-interactive
// detection are Phase 2/3 — the rule list is ordered + commented so those rules slot
// in by most-specificity without touching the existing ones.

import { parseVideoUrl } from "./parseVideoUrl";

export type ClassifiedForm = {
  /** An already-registered contentType (so getNoteContentSpec / getNoteType resolve). */
  contentType: string;
  /** `content` shaped for that contentType's core schema. */
  content: unknown;
  /** high = auto-apply; low = suggestion only (always markdown today). */
  confidence: "high" | "low";
};

// A fenced block: ```lang\n…\n``` — captures the (optional) info string + the body.
// Tolerant of leading whitespace and CRLF; non-greedy body; requires a closing fence.
const FENCE_RE = /^[ \t]*```([^\n`]*)\r?\n([\s\S]*?)\r?\n[ \t]*```[ \t]*$/m;

// Mermaid diagram keywords that can lead a bare (un-fenced) diagram source.
const MERMAID_LEADERS = [
  "graph",
  "flowchart",
  "sequenceDiagram",
  "gantt",
  "classDiagram",
  "stateDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "journey",
  "pie",
  "mindmap"
];

// Languages we recognize for a fenced code block → `code-snippet`. A short, common
// list keeps precision high; an unknown info-string falls through to markdown (a
// generic ``` fence is prose-y, not necessarily a code note).
const KNOWN_LANGUAGES = new Set([
  "js",
  "javascript",
  "jsx",
  "ts",
  "typescript",
  "tsx",
  "py",
  "python",
  "rb",
  "ruby",
  "go",
  "golang",
  "rust",
  "rs",
  "java",
  "kotlin",
  "kt",
  "swift",
  "c",
  "cpp",
  "c++",
  "cs",
  "csharp",
  "php",
  "sh",
  "bash",
  "shell",
  "zsh",
  "sql",
  "html",
  "css",
  "scss",
  "json",
  "yaml",
  "yml",
  "toml",
  "xml",
  "lua",
  "r",
  "scala",
  "dart",
  "perl",
  "haskell",
  "hs",
  "elixir",
  "clojure",
  "objc",
  "objective-c"
]);

/** The single fallback (never blocks): the raw text as a markdown note, low confidence. */
function markdownFallback(raw: string): ClassifiedForm {
  return { contentType: "markdown", content: raw, confidence: "low" };
}

// —— per-rule detectors (most-specific first) ————————————————————————————————
// Each returns a ClassifiedForm when it MATCHES, or null to fall through. Keeping
// them as discrete functions makes adding Phase 2/3 rules (video/html) a one-liner
// insertion into `classifyContent`'s ordered list below — no rule entangles another.

// video-embed: the WHOLE input is a single bare provider URL (YouTube / bilibili /
// Vimeo). A bare link is a high-confidence "play this video" intent; a link sitting
// INSIDE prose stays markdown (see classifyContent: we only test the trimmed whole).
// Content is shaped for the `video` union's embed member {kind, provider, videoId, url}.
function detectVideoEmbed(raw: string): ClassifiedForm | null {
  const trimmed = raw.trim();
  // Reject anything with internal whitespace — a bare URL has none, prose does.
  if (/\s/.test(trimmed)) return null;
  const parsed = parseVideoUrl(trimmed);
  if (!parsed) return null;
  return {
    contentType: "video",
    content: { kind: "embed", provider: parsed.provider, videoId: parsed.videoId, url: trimmed },
    confidence: "high"
  };
}

// mermaid: a ```mermaid``` fence, OR a bare source that LEADS with a mermaid keyword.
function detectMermaid(raw: string, fence: RegExpMatchArray | null): ClassifiedForm | null {
  if (fence) {
    const lang = fence[1].trim().toLowerCase();
    if (lang === "mermaid") {
      return { contentType: "mermaid", content: fence[2].trim(), confidence: "high" };
    }
    return null; // a different fenced language — let the code-snippet rule decide.
  }
  const firstWord = raw.trim().split(/\s|\(|;/, 1)[0];
  if (MERMAID_LEADERS.includes(firstWord)) {
    return { contentType: "mermaid", content: raw.trim(), confidence: "high" };
  }
  return null;
}

// markmap: a multi-level markdown OUTLINE — ≥2 distinct heading levels (#, ##) OR
// ≥2 distinct bullet-indent levels. This is a thinking-tree, rendered as an
// interactive mind-map. Its content is the markdown outline string (markmap's schema).
function detectMarkmap(raw: string): ClassifiedForm | null {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");

  // Heading levels present (#, ##, ###…). A single level (all "#") is a flat doc,
  // not an outline — require ≥2 DISTINCT levels.
  const headingLevels = new Set<number>();
  for (const line of lines) {
    const m = /^(#{1,6})\s+\S/.exec(line);
    if (m) headingLevels.add(m[1].length);
  }
  if (headingLevels.size >= 2) {
    return { contentType: "markmap", content: raw.trim(), confidence: "high" };
  }

  // Bullet outline: ≥2 DISTINCT indent depths among `-`/`*`/`+` list items, with at
  // least one nested item (depth > 0). A flat bullet list (all depth 0) is NOT a tree.
  const indents = new Set<number>();
  let bulletCount = 0;
  for (const line of lines) {
    const m = /^([ \t]*)[-*+]\s+\S/.exec(line);
    if (m) {
      bulletCount += 1;
      // Normalize a tab to two columns so mixed tabs/spaces still bucket by depth.
      const depth = m[1].replace(/\t/g, "  ").length;
      indents.add(depth);
    }
  }
  if (bulletCount >= 2 && indents.size >= 2 && Math.max(...indents) > 0) {
    return { contentType: "markmap", content: raw.trim(), confidence: "high" };
  }
  return null;
}

// code-snippet: a ```lang``` fence whose info-string is a KNOWN language. Content is
// shaped for codeSnippetSchema = { language, code }.
function detectCodeSnippet(fence: RegExpMatchArray | null): ClassifiedForm | null {
  if (!fence) return null;
  const lang = fence[1].trim().toLowerCase();
  if (!lang || !KNOWN_LANGUAGES.has(lang)) return null;
  return {
    contentType: "code-snippet",
    content: { language: lang, code: fence[2] },
    confidence: "high"
  };
}

/**
 * Classify a free-text blob into an already-registered note form.
 *
 * Rule order (most-specific first):
 *   1. mermaid   — ```mermaid``` fence or bare `graph/flowchart/…` source.
 *   2. markmap   — multi-level heading/bullet outline (≥2 levels).
 *   3. code-snippet — ```lang``` fence with a known language.
 *   4. markdown  — fallback (LOW confidence; never blocks).
 *
 * NEVER throws — any unexpected input degrades to the markdown fallback.
 */
export function classifyContent(raw: string): ClassifiedForm {
  try {
    if (typeof raw !== "string" || raw.trim() === "") return markdownFallback(raw ?? "");

    // A single leading fenced block is the anchor for the fence-based rules. We match
    // the FIRST fence; mixed prose+fence stays markdown unless the fence rule fires.
    const fence = raw.match(FENCE_RE);

    // 0. video-embed (most specific: the ENTIRE input is one bare provider URL). A
    //    link inside a sentence has whitespace and falls through to markdown.
    const video = detectVideoEmbed(raw);
    if (video) return video;

    // 1. mermaid (most specific: a named diagram language / bare diagram source).
    const mermaid = detectMermaid(raw, fence);
    if (mermaid) return mermaid;

    // 2. markmap (a structured outline). Checked before code-snippet so an outline
    //    that happens to contain a fence is still treated as a mind-map.
    const markmap = detectMarkmap(raw);
    if (markmap) return markmap;

    // 3. code-snippet (a fenced known language).
    const code = detectCodeSnippet(fence);
    if (code) return code;

    // —— Phase 3 rules slot in here (most-specificity preserved) ——
    //   • video-embed (Phase 2): DONE — see rule 0 above (a bare provider URL).
    //   • html-interactive: <script> + <canvas>/addEventListener → html {interactive:true}
    //   • html-static: tags but no script → html {interactive:false}

    // 4. fallback.
    return markdownFallback(raw);
  } catch {
    // Pure + total: even a pathological input can never throw out of the classifier.
    return markdownFallback(typeof raw === "string" ? raw : "");
  }
}
