// Study Report Kit — the React half (render + edit) for study-report.report. Pairs with
// the React-free spec in ./contentTypes. Renders NEVER throw on a bad/foreign shape (they
// coerce defensively via asReport, like the reviewPackPlugin), so a stale or hand-rolled
// report can't crash the list. Routes through getNoteType("study-report.report").render —
// the adaptive-note contract (a note-gen plugin has no custom render path).

import { renderNoteContent } from "../../adapters/notes/render";
import type { NoteEditInput, NoteRenderInput } from "../../client/notes/noteTypeRegistry";
import type { KitNoteTypePlugin } from "../types";
import { studyReportSpec, type StudyReportContent } from "./contentTypes";

// One-item-per-line <textarea> helpers for the string[] fields (the tb-edit idiom).
const linesToArray = (text: string): string[] =>
  text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
const arrayToLines = (items: string[] | undefined): string => (items ?? []).join("\n");

// Prose → sanitized markdown HTML (the same safe renderer the markdown note uses).
function Prose({ text }: { text: string }) {
  return <div className="note-rendered" dangerouslySetInnerHTML={{ __html: renderNoteContent("markdown", text).html }} />;
}

// Defensive coercion — the spec's zod parse fills every default, so a partial/foreign
// object becomes a full StudyReportContent (or, on a hard failure, createDefault()).
function asReport(content: unknown): StudyReportContent {
  const result = studyReportSpec.schema.safeParse(content ?? {});
  return result.success ? (result.data as StudyReportContent) : studyReportSpec.createDefault();
}

const STAT_LABELS: { key: keyof StudyReportContent["stats"]; label: string }[] = [
  { key: "reviewsDone", label: "复习次数" },
  { key: "reviewPass", label: "通过" },
  { key: "reviewFail", label: "未过" },
  { key: "notesCreated", label: "新增笔记" },
  { key: "mistakesLogged", label: "错题" },
  { key: "activeDays", label: "活跃天数" },
  { key: "streakDays", label: "连续学习" }
];

function StudyReportRender({ content, mode }: NoteRenderInput) {
  const c = asReport(content);
  const periodLabel = c.period.label || "学习报告";
  if (mode === "card") {
    return (
      <div className="note-rendered sr-card-preview">
        {periodLabel}
        {c.period.from ? `(${c.period.from} ~ ${c.period.to})` : ""} · {c.summary || `复习 ${c.stats.reviewsDone} 次`}
      </div>
    );
  }
  return (
    <div className="note-rendered sr-card sr-report">
      <div className="sr-card-head">
        <span className="sr-card-kind">学习报告</span>
        <span className="sr-period">
          {periodLabel}
          {c.period.from ? ` · ${c.period.from} ~ ${c.period.to}` : ""}
        </span>
      </div>

      <div className="sr-stats-grid">
        {STAT_LABELS.map(({ key, label }) => (
          <div className="sr-stat" key={key} data-stat={key}>
            <span className="sr-stat-value">{c.stats[key]}</span>
            <span className="sr-stat-label">{label}</span>
          </div>
        ))}
      </div>

      {c.summary ? <Prose text={c.summary} /> : null}

      {c.highlights.length ? (
        <div className="sr-section sr-highlights">
          <strong>亮点</strong>
          <ul>{c.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>
        </div>
      ) : null}

      {c.weakAreas.length ? (
        <div className="sr-section sr-warn sr-weak-areas">
          <strong>弱项</strong>
          <ul>
            {c.weakAreas.map((w, i) => (
              <li key={i}>
                <strong>{w.bucket}</strong>
                {w.detail ? ` — ${w.detail}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {c.nextSteps.length ? (
        <div className="sr-section sr-next-steps">
          <strong>下一步</strong>
          <ul>{c.nextSteps.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      ) : null}
    </div>
  );
}

// Edit: textareas for the string[] prose arrays + the summary. "Hide a line" = delete a
// bullet (the user-edit-before-share affordance). Stats/period are deterministic (the
// assembler owns them), so they are NOT editable here — the report is a data snapshot with
// editable prose.
function StudyReportEditor({ content, onChange }: NoteEditInput) {
  const c = asReport(content);
  return (
    <div className="note-edit sr-edit sr-edit-report">
      <textarea
        className="note-edit note-edit-text sr-summary"
        placeholder="小结(markdown)…"
        value={c.summary}
        onChange={(e) => onChange({ ...c, summary: e.target.value })}
      />
      <textarea
        className="note-edit note-edit-text sr-highlights-edit"
        placeholder="亮点(每行一条)"
        value={arrayToLines(c.highlights)}
        onChange={(e) => onChange({ ...c, highlights: linesToArray(e.target.value) })}
      />
      <textarea
        className="note-edit note-edit-text sr-next-steps-edit"
        placeholder="下一步(每行一条)"
        value={arrayToLines(c.nextSteps)}
        onChange={(e) => onChange({ ...c, nextSteps: linesToArray(e.target.value) })}
      />
    </div>
  );
}

// `title`/`aliases` = the slash-palette display meta. `/学习报告` (+ English shorthands)
// resolve. The full study-report.report id matches by itself.
export const studyReportPlugin: KitNoteTypePlugin = {
  label: "Study Report",
  title: { zh: "学习报告", en: "Study Report" },
  aliases: ["学习报告", "报告", "study-report", "report"],
  render: (input) => <StudyReportRender {...input} />,
  edit: (input) => <StudyReportEditor {...input} />
};
