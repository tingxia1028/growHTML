// sourceTemplates — SRC-4 predefined HTML LAYOUTS an authored html page can start from
// (§4 "templates"). Each is a small, hand-written fragment of clean study markup: real
// heading/list/table/callout elements + inline styles only (no external CSS, so it
// renders identically in the read-mode DomReader and survives serialize/sanitize). No
// scripts, no javascript: URLs — the sanitizer keeps every byte. Bilingual bodies pick
// the active locale at pick time; the gallery LABELS are defineMessages strings.

import { getLocale, type Locale } from "../i18n";

export type SourceTemplateId =
  | "blank"
  | "lessonNotes"
  | "studyGuide"
  | "vocabList"
  | "compareTable"
  | "quizSheet";

export type SourceTemplate = {
  id: SourceTemplateId;
  /** Localized gallery label + one-line description (defineMessages resolved at render). */
  label: Record<Locale, string>;
  description: Record<Locale, string>;
  /** The layout HTML per locale — a BODY fragment (no <html>/<head>). "" = blank page. */
  html: Record<Locale, string>;
};

// Kept terse and kid-legible; inline styles only so nothing depends on app CSS.
const TEMPLATES: SourceTemplate[] = [
  {
    id: "blank",
    label: { zh: "空白页", en: "Blank page" },
    description: { zh: "从零开始写。", en: "Start from scratch." },
    html: { zh: "", en: "" }
  },
  {
    id: "lessonNotes",
    label: { zh: "课堂笔记", en: "Lesson notes" },
    description: { zh: "标题 + 要点 + 小结,记一节课刚好。", en: "Title, key points, and a summary — one lesson." },
    html: {
      zh:
        "<h1>课堂标题</h1>\n" +
        "<p><strong>日期:</strong>____ · <strong>科目:</strong>____</p>\n" +
        "<h2>今天学了什么</h2>\n<ul><li>要点一</li><li>要点二</li><li>要点三</li></ul>\n" +
        "<h2>我的问题</h2>\n<blockquote>还不太懂的地方写在这里。</blockquote>\n" +
        "<h2>一句话小结</h2>\n<p>用自己的话说一遍。</p>",
      en:
        "<h1>Lesson title</h1>\n" +
        "<p><strong>Date:</strong> ____ · <strong>Subject:</strong> ____</p>\n" +
        "<h2>What I learned today</h2>\n<ul><li>Point one</li><li>Point two</li><li>Point three</li></ul>\n" +
        "<h2>My questions</h2>\n<blockquote>Write anything you're unsure about here.</blockquote>\n" +
        "<h2>One-sentence summary</h2>\n<p>Say it again in your own words.</p>"
    }
  },
  {
    id: "studyGuide",
    label: { zh: "复习提纲", en: "Study guide" },
    description: { zh: "分节的复习清单,考前照着过一遍。", en: "A sectioned review checklist for before a test." },
    html: {
      zh:
        "<h1>复习提纲</h1>\n" +
        "<div style=\"padding:12px 14px;border-left:4px solid #2456c9;background:#eef4ff;border-radius:8px;margin:12px 0\"><p style=\"margin:0\"><strong>目标:</strong>把每一节都能自己讲清楚。</p></div>\n" +
        "<h2>第一节</h2>\n<ul><li>关键概念:</li><li>要记的公式/定义:</li><li>容易错的地方:</li></ul>\n" +
        "<h2>第二节</h2>\n<ul><li>关键概念:</li><li>要记的公式/定义:</li><li>容易错的地方:</li></ul>",
      en:
        "<h1>Study guide</h1>\n" +
        "<div style=\"padding:12px 14px;border-left:4px solid #2456c9;background:#eef4ff;border-radius:8px;margin:12px 0\"><p style=\"margin:0\"><strong>Goal:</strong> be able to explain every section yourself.</p></div>\n" +
        "<h2>Section 1</h2>\n<ul><li>Key idea:</li><li>Formula / definition to memorize:</li><li>Common mistake:</li></ul>\n" +
        "<h2>Section 2</h2>\n<ul><li>Key idea:</li><li>Formula / definition to memorize:</li><li>Common mistake:</li></ul>"
    }
  },
  {
    id: "vocabList",
    label: { zh: "生词表", en: "Vocabulary list" },
    description: { zh: "词 + 意思 + 例句的表格。", en: "A word / meaning / example table." },
    html: {
      zh:
        "<h1>生词表</h1>\n" +
        "<table style=\"border-collapse:collapse;width:100%;margin:12px 0\">" +
        "<tr><th style=\"border:1px solid #d9d9de;padding:6px 10px;text-align:left\">词</th><th style=\"border:1px solid #d9d9de;padding:6px 10px;text-align:left\">意思</th><th style=\"border:1px solid #d9d9de;padding:6px 10px;text-align:left\">例句</th></tr>" +
        "<tr><td style=\"border:1px solid #d9d9de;padding:6px 10px\">____</td><td style=\"border:1px solid #d9d9de;padding:6px 10px\">____</td><td style=\"border:1px solid #d9d9de;padding:6px 10px\">____</td></tr>" +
        "<tr><td style=\"border:1px solid #d9d9de;padding:6px 10px\">____</td><td style=\"border:1px solid #d9d9de;padding:6px 10px\">____</td><td style=\"border:1px solid #d9d9de;padding:6px 10px\">____</td></tr>" +
        "</table>",
      en:
        "<h1>Vocabulary list</h1>\n" +
        "<table style=\"border-collapse:collapse;width:100%;margin:12px 0\">" +
        "<tr><th style=\"border:1px solid #d9d9de;padding:6px 10px;text-align:left\">Word</th><th style=\"border:1px solid #d9d9de;padding:6px 10px;text-align:left\">Meaning</th><th style=\"border:1px solid #d9d9de;padding:6px 10px;text-align:left\">Example</th></tr>" +
        "<tr><td style=\"border:1px solid #d9d9de;padding:6px 10px\">____</td><td style=\"border:1px solid #d9d9de;padding:6px 10px\">____</td><td style=\"border:1px solid #d9d9de;padding:6px 10px\">____</td></tr>" +
        "<tr><td style=\"border:1px solid #d9d9de;padding:6px 10px\">____</td><td style=\"border:1px solid #d9d9de;padding:6px 10px\">____</td><td style=\"border:1px solid #d9d9de;padding:6px 10px\">____</td></tr>" +
        "</table>"
    }
  },
  {
    id: "compareTable",
    label: { zh: "对比表", en: "Compare & contrast" },
    description: { zh: "两个东西并排比一比。", en: "Put two things side by side." },
    html: {
      zh:
        "<h1>对比:A 和 B</h1>\n" +
        "<table style=\"border-collapse:collapse;width:100%;margin:12px 0\">" +
        "<tr><th style=\"border:1px solid #d9d9de;padding:6px 10px;text-align:left\">方面</th><th style=\"border:1px solid #d9d9de;padding:6px 10px;text-align:left\">A</th><th style=\"border:1px solid #d9d9de;padding:6px 10px;text-align:left\">B</th></tr>" +
        "<tr><td style=\"border:1px solid #d9d9de;padding:6px 10px\">相同点</td><td style=\"border:1px solid #d9d9de;padding:6px 10px\">____</td><td style=\"border:1px solid #d9d9de;padding:6px 10px\">____</td></tr>" +
        "<tr><td style=\"border:1px solid #d9d9de;padding:6px 10px\">不同点</td><td style=\"border:1px solid #d9d9de;padding:6px 10px\">____</td><td style=\"border:1px solid #d9d9de;padding:6px 10px\">____</td></tr>" +
        "</table>",
      en:
        "<h1>Compare: A vs B</h1>\n" +
        "<table style=\"border-collapse:collapse;width:100%;margin:12px 0\">" +
        "<tr><th style=\"border:1px solid #d9d9de;padding:6px 10px;text-align:left\">Aspect</th><th style=\"border:1px solid #d9d9de;padding:6px 10px;text-align:left\">A</th><th style=\"border:1px solid #d9d9de;padding:6px 10px;text-align:left\">B</th></tr>" +
        "<tr><td style=\"border:1px solid #d9d9de;padding:6px 10px\">In common</td><td style=\"border:1px solid #d9d9de;padding:6px 10px\">____</td><td style=\"border:1px solid #d9d9de;padding:6px 10px\">____</td></tr>" +
        "<tr><td style=\"border:1px solid #d9d9de;padding:6px 10px\">Different</td><td style=\"border:1px solid #d9d9de;padding:6px 10px\">____</td><td style=\"border:1px solid #d9d9de;padding:6px 10px\">____</td></tr>" +
        "</table>"
    }
  },
  {
    id: "quizSheet",
    label: { zh: "自测卷", en: "Quiz sheet" },
    description: { zh: "给自己出几道题。", en: "Write yourself a few questions." },
    html: {
      zh:
        "<h1>自测卷</h1>\n" +
        "<ol><li>问题一?<p>答:____</p></li><li>问题二?<p>答:____</p></li><li>问题三?<p>答:____</p></li></ol>",
      en:
        "<h1>Quiz sheet</h1>\n" +
        "<ol><li>Question 1?<p>Answer: ____</p></li><li>Question 2?<p>Answer: ____</p></li><li>Question 3?<p>Answer: ____</p></li></ol>"
    }
  }
];

export function listSourceTemplates(): SourceTemplate[] {
  return TEMPLATES;
}

export function getSourceTemplate(id: SourceTemplateId): SourceTemplate | undefined {
  return TEMPLATES.find((template) => template.id === id);
}

/** The template's layout HTML in the ACTIVE locale (or "" for the blank template). */
export function templateHtml(id: SourceTemplateId, locale: Locale = getLocale()): string {
  return getSourceTemplate(id)?.html[locale] ?? "";
}
