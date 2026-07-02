// Review plugin — the React half of the HIDDEN `review.grade` type. A grade is a
// transient verdict shown inline in the review runner, never persisted as a note —
// but the adaptive-note contract still holds: IF grade content ever reaches a
// display surface it renders through getNoteType("review.grade").render like every
// other contentType (no bespoke path). `hidden: true` keeps it out of the composer
// type picker AND the slash palette (the SC-0 adapter skips hidden registrations),
// so it is never OFFERED for authoring.

import type { NoteEditInput, NoteRenderInput } from "../../client/notes/noteTypeRegistry";
import type { KitNoteTypePlugin } from "../types";
import type { ReviewGradeContent } from "./contentTypes";

function asGrade(content: unknown): ReviewGradeContent {
  const c = (content ?? {}) as Partial<ReviewGradeContent>;
  return {
    correct: c.correct === true,
    explanation: typeof c.explanation === "string" ? c.explanation : ""
  };
}

function GradeRender({ content }: NoteRenderInput) {
  const grade = asGrade(content);
  return (
    <div className={`note-rendered review-grade ${grade.correct ? "review-grade-pass" : "review-grade-fail"}`}>
      <span className="review-grade-verdict">{grade.correct ? "✓ 答对了" : "✗ 答错了"}</span>
      {grade.explanation ? <p className="review-grade-explanation">{grade.explanation}</p> : null}
    </div>
  );
}

// Grades are machine-made, never authored — the editor exists only to satisfy the
// registry contract (and to let a dev inspect/flip one if it ever lands somewhere).
function GradeEditor({ content, onChange }: NoteEditInput) {
  const grade = asGrade(content);
  return (
    <div className="note-edit review-grade-edit">
      <label className="review-grade-edit-correct">
        <input
          type="checkbox"
          checked={grade.correct}
          onChange={(e) => onChange({ ...grade, correct: e.target.checked })}
        />
        correct
      </label>
      <textarea
        className="note-edit note-edit-text review-grade-edit-explanation"
        placeholder="Explanation"
        value={grade.explanation}
        onChange={(e) => onChange({ ...grade, explanation: e.target.value })}
      />
    </div>
  );
}

export const reviewGradePlugin: KitNoteTypePlugin = {
  label: "检验判定",
  title: "检验判定",
  hidden: true,
  render: (input) => <GradeRender {...input} />,
  edit: (input) => <GradeEditor {...input} />
};
