// Subject kit detection tables (subject-kits.md §3.3, milestone M-B) — one table per
// shipped subject kit, colocated with the kits exactly like the textbook stand-in
// (src/kits/textbook-learning/detection.ts). React-free; registered by BOTH
// installServerKits (src/kits/index.ts aggregation) and installClientKits
// (ProductKit.detection), so client foreground and server stage seeding agree.
//
// Rows follow the §3.3 matrix verbatim. The doc's "date density" probe for 史地 maps
// onto the engine's literal content-keyword bucket (公元/朝代/…): the engine offers
// keywords / latexDensity / langHint only, and a keyword hit is worth the same +0.2
// the doc assigns the signal. All weights stay 1 — ties resolve by the deterministic
// kitId ASC leg (§3.2), which is exactly the ambiguity the chain is for.
// 理化生/语文 rows land in M-C with their kits.

import type { KitDetectionTable } from "../../core/subject/detectSubject";

export const mathDetection: KitDetectionTable = {
  kitId: "subject-math",
  titleKeywords: ["数学", "代数", "几何", "微积分", "函数", "三角", "math", "algebra", "geometry", "calculus"],
  titlePatterns: [/\b(math|algebra|calculus|geometry)\b/i, /数学|代数|几何|微积分/],
  sourceTypes: ["pdf", "markdown"],
  contentSignals: { latexDensity: 3 },
  weight: 1
};

export const englishDetection: KitDetectionTable = {
  kitId: "subject-english",
  titleKeywords: ["英语", "单词", "语法", "阅读", "english", "vocabulary", "grammar", "reading"],
  titlePatterns: [/\benglish\b/i],
  sourceTypes: ["webpage", "transcript", "pdf"],
  contentSignals: { langHint: "en" },
  weight: 1
};

export const historyGeoDetection: KitDetectionTable = {
  kitId: "subject-history-geo",
  titleKeywords: ["历史", "地理", "朝代", "年表", "history", "geography"],
  titlePatterns: [/\b(history|geography)\b/i, /历史|地理/],
  sourceTypes: ["pdf", "webpage"],
  // §3.3 "date density (年/公元/BC/AD)" → the literal keyword bucket (+0.2, same value).
  contentSignals: { keywords: ["公元", "公元前", "世纪", "朝代", "年表", "BC", "AD"] },
  weight: 1
};

// —— M-C: the two remaining subject kits' tables (§3.3 rows verbatim) ——————————

export const chineseDetection: KitDetectionTable = {
  kitId: "subject-chinese",
  titleKeywords: ["语文", "古文", "文言文", "诗词", "作文", "阅读", "chinese"],
  titlePatterns: [/语文|文言|诗词/],
  sourceTypes: ["pdf"],
  // §3.3 classical-Chinese markers (之乎者也…) — the weakest signal, low by design.
  contentSignals: { keywords: ["之", "乎", "者", "也", "兮", "曰"] },
  weight: 1
};

export const scienceDetection: KitDetectionTable = {
  kitId: "subject-science",
  titleKeywords: ["物理", "化学", "生物", "实验", "physics", "chemistry", "biology"],
  titlePatterns: [/\b(physics|chemistry|biology)\b/i, /物理|化学|生物/],
  sourceTypes: ["pdf"],
  // §3.3: latexDensity≥2/1k AND element/科学 markers. Math + science both fire on
  // latexDensity — the kitId-ASC tie-break decides (subject-math < subject-science).
  contentSignals: { latexDensity: 2, keywords: ["H₂O", "NaCl", "mol", "细胞", "分子", "原子"] },
  weight: 1
};

export const subjectDetectionTables: KitDetectionTable[] = [
  mathDetection,
  englishDetection,
  historyGeoDetection,
  chineseDetection,
  scienceDetection
];
