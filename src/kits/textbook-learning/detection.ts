// Textbook kit detection table (subject-kits.md M-A) — the stand-in seed the design
// calls for ("profiles can score toward the existing textbook kit", PART 5): textbook-y
// titles auto-foreground this kit. React-free, registered via the KitLayerPolicy
// precedent (ProductKit.detection → installServerKits + installClientKits). M-B replaces
// this single table with the five subject kits' tables (§3.3), each colocated with its
// kit exactly like this one — the F7 lesson: the table lives here, never in core.

import type { KitDetectionTable } from "../../core/subject/detectSubject";

export const textbookDetection: KitDetectionTable = {
  kitId: "textbook-learning",
  // Bilingual, case-insensitive substrings — precise "this is a textbook" tells.
  titleKeywords: ["教材", "课本", "教科书", "讲义", "必修", "选修", "textbook", "coursebook"],
  // The chapter/unit/lesson shapes textbook titles carry (第X章 / Chapter 3 / Unit 2).
  titlePatterns: [
    /第[0-9一二三四五六七八九十百]+[章节课讲]/,
    /[0-9一二三四五六七八九十]+\s*单元/,
    /\b(chapter|lesson|unit)\s*[0-9ivx]+/i
  ],
  // Weak hints: textbooks arrive as PDFs / word docs / markdown transcriptions.
  sourceTypes: ["pdf", "word", "markdown"],
  // Body markers of textbook prose (exercises, worked examples, chapter summaries).
  contentSignals: { keywords: ["例题", "习题", "练习", "知识点", "本章小结", "课后作业"] },
  weight: 1
};
