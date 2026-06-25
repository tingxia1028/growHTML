// Textbook Learning Kit — the React half (render + edit) for the 3 MVP Study Block
// types. Pairs with the React-free specs in ./contentTypes. Renders never throw on a
// bad/foreign shape (they coerce defensively, like the built-in plugins), so a stale
// or hand-rolled note can't crash the note list.

import { renderNoteContent } from "../../adapters/notes/render";
import type { NoteEditInput, NoteRenderInput } from "../../client/notes/noteTypeRegistry";
import type { KitNoteTypePlugin } from "../types";
import type { ExerciseContent, ExplanationContent, MistakeContent, ReviewPackContent } from "./contentTypes";

// One-item-per-line <textarea> helpers for the string[] fields.
const linesToArray = (text: string): string[] =>
  text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
const arrayToLines = (items: string[] | undefined): string => (items ?? []).join("\n");

// Prose → sanitized markdown HTML (same safe renderer the markdown note uses).
function Prose({ text }: { text: string }) {
  return <div className="note-rendered" dangerouslySetInnerHTML={{ __html: renderNoteContent("markdown", text).html }} />;
}

// —— Explanation ————————————————————————————————————————————————————————————
function asExplanation(content: unknown): ExplanationContent {
  const c = (content ?? {}) as Partial<ExplanationContent>;
  return {
    title: typeof c.title === "string" ? c.title : "",
    level: c.level === "simple" || c.level === "advanced" ? c.level : "standard",
    explanation: typeof c.explanation === "string" ? c.explanation : "",
    analogy: typeof c.analogy === "string" ? c.analogy : undefined,
    keyPoints: Array.isArray(c.keyPoints) ? c.keyPoints.map(String) : [],
    commonMisunderstandings: Array.isArray(c.commonMisunderstandings) ? c.commonMisunderstandings.map(String) : []
  };
}

function ExplanationRender({ content }: NoteRenderInput) {
  const c = asExplanation(content);
  return (
    <div className="note-rendered tb-card tb-explanation">
      <div className="tb-card-head">
        <span className="tb-card-kind">Explanation</span>
        <span className="tb-badge" data-level={c.level}>{c.level}</span>
      </div>
      {c.title ? <h4 className="tb-card-title">{c.title}</h4> : null}
      {c.explanation ? <Prose text={c.explanation} /> : null}
      {c.analogy ? (
        <p className="tb-analogy">
          <strong>Analogy:</strong> {c.analogy}
        </p>
      ) : null}
      {c.keyPoints.length ? (
        <div className="tb-section">
          <strong>Key points</strong>
          <ul>{c.keyPoints.map((point, i) => <li key={i}>{point}</li>)}</ul>
        </div>
      ) : null}
      {c.commonMisunderstandings.length ? (
        <div className="tb-section tb-warn">
          <strong>Common misunderstandings</strong>
          <ul>{c.commonMisunderstandings.map((point, i) => <li key={i}>{point}</li>)}</ul>
        </div>
      ) : null}
    </div>
  );
}

function ExplanationEditor({ content, onChange }: NoteEditInput) {
  const c = asExplanation(content);
  return (
    <div className="note-edit tb-edit tb-edit-explanation">
      <input
        className="note-edit-field tb-explanation-title"
        placeholder="Title"
        value={c.title}
        onChange={(e) => onChange({ ...c, title: e.target.value })}
      />
      <select
        className="note-edit-field tb-explanation-level"
        value={c.level}
        onChange={(e) => onChange({ ...c, level: e.target.value as ExplanationContent["level"] })}
      >
        <option value="simple">simple</option>
        <option value="standard">standard</option>
        <option value="advanced">advanced</option>
      </select>
      <textarea
        className="note-edit note-edit-text tb-explanation-text"
        placeholder="Explanation (markdown)…"
        value={c.explanation}
        onChange={(e) => onChange({ ...c, explanation: e.target.value })}
      />
      <input
        className="note-edit-field tb-explanation-analogy"
        placeholder="Analogy (optional)"
        value={c.analogy ?? ""}
        onChange={(e) => onChange({ ...c, analogy: e.target.value || undefined })}
      />
      <textarea
        className="note-edit note-edit-text tb-explanation-keypoints"
        placeholder="Key points (one per line)"
        value={arrayToLines(c.keyPoints)}
        onChange={(e) => onChange({ ...c, keyPoints: linesToArray(e.target.value) })}
      />
      <textarea
        className="note-edit note-edit-text tb-explanation-misconceptions"
        placeholder="Common misunderstandings (one per line)"
        value={arrayToLines(c.commonMisunderstandings)}
        onChange={(e) => onChange({ ...c, commonMisunderstandings: linesToArray(e.target.value) })}
      />
    </div>
  );
}

// —— Exercise ———————————————————————————————————————————————————————————————
function asExercise(content: unknown): ExerciseContent {
  const c = (content ?? {}) as Partial<ExerciseContent>;
  const type =
    c.type === "multiple-choice" || c.type === "fill-blank" || c.type === "short-answer"
      ? c.type
      : "single-choice";
  return {
    question: typeof c.question === "string" ? c.question : "",
    type,
    options: Array.isArray(c.options) ? c.options.map(String) : [],
    answer: Array.isArray(c.answer) ? c.answer.map(String) : typeof c.answer === "string" ? c.answer : "",
    explanation: typeof c.explanation === "string" ? c.explanation : "",
    difficulty: c.difficulty === "easy" || c.difficulty === "hard" ? c.difficulty : "medium",
    relatedKnowledgePoints: Array.isArray(c.relatedKnowledgePoints) ? c.relatedKnowledgePoints.map(String) : []
  };
}

function ExerciseRender({ content }: NoteRenderInput) {
  const c = asExercise(content);
  const answer = Array.isArray(c.answer) ? c.answer.join(", ") : c.answer;
  return (
    <div className="note-rendered tb-card tb-exercise">
      <div className="tb-card-head">
        <span className="tb-card-kind">Practice</span>
        <span className="tb-badge" data-type={c.type}>{c.type}</span>
        <span className="tb-badge" data-difficulty={c.difficulty}>{c.difficulty}</span>
      </div>
      {c.question ? <p className="tb-exercise-question">{c.question}</p> : null}
      {c.options && c.options.length ? (
        <ul className="tb-exercise-options">
          {c.options.map((option, i) => <li key={i}>{option}</li>)}
        </ul>
      ) : null}
      <p className="tb-exercise-answer">
        <strong>Answer:</strong> {answer}
      </p>
      {c.explanation ? <Prose text={c.explanation} /> : null}
    </div>
  );
}

function ExerciseEditor({ content, onChange }: NoteEditInput) {
  const c = asExercise(content);
  const answerText = Array.isArray(c.answer) ? c.answer.join("\n") : c.answer;
  const multi = c.type === "multiple-choice";
  return (
    <div className="note-edit tb-edit tb-edit-exercise">
      <input
        className="note-edit-field tb-exercise-question"
        placeholder="Question"
        value={c.question}
        onChange={(e) => onChange({ ...c, question: e.target.value })}
      />
      <select
        className="note-edit-field tb-exercise-type"
        value={c.type}
        onChange={(e) => onChange({ ...c, type: e.target.value as ExerciseContent["type"] })}
      >
        <option value="single-choice">single-choice</option>
        <option value="multiple-choice">multiple-choice</option>
        <option value="fill-blank">fill-blank</option>
        <option value="short-answer">short-answer</option>
      </select>
      <textarea
        className="note-edit note-edit-text tb-exercise-options"
        placeholder="Options (one per line)"
        value={arrayToLines(c.options)}
        onChange={(e) => onChange({ ...c, options: linesToArray(e.target.value) })}
      />
      <textarea
        className="note-edit note-edit-text tb-exercise-answer"
        placeholder={multi ? "Answer(s), one per line" : "Answer"}
        value={answerText}
        onChange={(e) => onChange({ ...c, answer: multi ? linesToArray(e.target.value) : e.target.value })}
      />
      <textarea
        className="note-edit note-edit-text tb-exercise-explanation"
        placeholder="Explanation (markdown)…"
        value={c.explanation}
        onChange={(e) => onChange({ ...c, explanation: e.target.value })}
      />
      <select
        className="note-edit-field tb-exercise-difficulty"
        value={c.difficulty}
        onChange={(e) => onChange({ ...c, difficulty: e.target.value as ExerciseContent["difficulty"] })}
      >
        <option value="easy">easy</option>
        <option value="medium">medium</option>
        <option value="hard">hard</option>
      </select>
    </div>
  );
}

// —— Mistake ————————————————————————————————————————————————————————————————
function asMistake(content: unknown): MistakeContent {
  const c = (content ?? {}) as Partial<MistakeContent>;
  const mastery =
    c.mastery === "unknown" || c.mastery === "improving" || c.mastery === "mastered" ? c.mastery : "weak";
  return {
    exerciseNoteId: typeof c.exerciseNoteId === "string" ? c.exerciseNoteId : undefined,
    question: typeof c.question === "string" ? c.question : "",
    wrongAnswer: typeof c.wrongAnswer === "string" ? c.wrongAnswer : "",
    correctAnswer: typeof c.correctAnswer === "string" ? c.correctAnswer : "",
    mistakeReason: typeof c.mistakeReason === "string" ? c.mistakeReason : undefined,
    correction: typeof c.correction === "string" ? c.correction : undefined,
    retryCount: typeof c.retryCount === "number" ? c.retryCount : 0,
    mastery
  };
}

function MistakeRender({ content }: NoteRenderInput) {
  const c = asMistake(content);
  return (
    <div className="note-rendered tb-card tb-mistake">
      <div className="tb-card-head">
        <span className="tb-card-kind">Mistake</span>
        <span className="tb-badge" data-mastery={c.mastery}>{c.mastery}</span>
        {c.retryCount > 0 ? <span className="tb-badge">retries: {c.retryCount}</span> : null}
      </div>
      {c.question ? <p className="tb-mistake-question">{c.question}</p> : null}
      <p className="tb-mistake-wrong">
        <strong>My answer:</strong> {c.wrongAnswer}
      </p>
      <p className="tb-mistake-correct">
        <strong>Correct:</strong> {c.correctAnswer}
      </p>
      {c.mistakeReason ? <Prose text={`**Why I missed it:** ${c.mistakeReason}`} /> : null}
      {c.correction ? <Prose text={c.correction} /> : null}
    </div>
  );
}

function MistakeEditor({ content, onChange }: NoteEditInput) {
  const c = asMistake(content);
  return (
    <div className="note-edit tb-edit tb-edit-mistake">
      <input
        className="note-edit-field tb-mistake-question"
        placeholder="Question"
        value={c.question}
        onChange={(e) => onChange({ ...c, question: e.target.value })}
      />
      <input
        className="note-edit-field tb-mistake-wrong"
        placeholder="My (wrong) answer"
        value={c.wrongAnswer}
        onChange={(e) => onChange({ ...c, wrongAnswer: e.target.value })}
      />
      <input
        className="note-edit-field tb-mistake-correct"
        placeholder="Correct answer"
        value={c.correctAnswer}
        onChange={(e) => onChange({ ...c, correctAnswer: e.target.value })}
      />
      <textarea
        className="note-edit note-edit-text tb-mistake-reason"
        placeholder="Why I missed it (optional)"
        value={c.mistakeReason ?? ""}
        onChange={(e) => onChange({ ...c, mistakeReason: e.target.value || undefined })}
      />
      <select
        className="note-edit-field tb-mistake-mastery"
        value={c.mastery}
        onChange={(e) => onChange({ ...c, mastery: e.target.value as MistakeContent["mastery"] })}
      >
        <option value="unknown">unknown</option>
        <option value="weak">weak</option>
        <option value="improving">improving</option>
        <option value="mastered">mastered</option>
      </select>
    </div>
  );
}

// —— Review Pack ————————————————————————————————————————————————————————————
function asReviewPack(content: unknown): ReviewPackContent {
  const c = (content ?? {}) as Partial<ReviewPackContent>;
  const scope = (c.scope ?? {}) as Partial<ReviewPackContent["scope"]>;
  const flashcards = Array.isArray(c.flashcards)
    ? c.flashcards.map((f) => ({ front: String((f as { front?: unknown }).front ?? ""), back: String((f as { back?: unknown }).back ?? "") }))
    : [];
  return {
    title: typeof c.title === "string" ? c.title : "",
    scope: { sourceId: typeof scope.sourceId === "string" ? scope.sourceId : "" },
    summary: typeof c.summary === "string" ? c.summary : "",
    keyPoints: Array.isArray(c.keyPoints) ? c.keyPoints.map(String) : [],
    weakPoints: Array.isArray(c.weakPoints) ? c.weakPoints.map(String) : [],
    flashcards,
    exercises: Array.isArray(c.exercises) ? c.exercises.map(String) : []
  };
}

function ReviewPackRender({ content }: NoteRenderInput) {
  const c = asReviewPack(content);
  return (
    <div className="note-rendered tb-card tb-review-pack">
      <div className="tb-card-head">
        <span className="tb-card-kind">Review Pack</span>
      </div>
      {c.title ? <h4 className="tb-card-title">{c.title}</h4> : null}
      {c.summary ? <Prose text={c.summary} /> : null}
      {c.keyPoints.length ? (
        <div className="tb-section">
          <strong>Key points</strong>
          <ul>{c.keyPoints.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </div>
      ) : null}
      {c.weakPoints.length ? (
        <div className="tb-section tb-warn">
          <strong>Weak points</strong>
          <ul>{c.weakPoints.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </div>
      ) : null}
      {c.flashcards.length ? (
        <div className="tb-section">
          <strong>Flashcards</strong>
          <ul className="tb-review-flashcards">
            {c.flashcards.map((f, i) => (
              <li key={i}>
                <strong>{f.front}</strong> — {f.back}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ReviewPackEditor({ content, onChange }: NoteEditInput) {
  const c = asReviewPack(content);
  return (
    <div className="note-edit tb-edit tb-edit-review-pack">
      <input
        className="note-edit-field tb-review-title"
        placeholder="Title"
        value={c.title}
        onChange={(e) => onChange({ ...c, title: e.target.value })}
      />
      <textarea
        className="note-edit note-edit-text tb-review-summary"
        placeholder="Summary (markdown)…"
        value={c.summary}
        onChange={(e) => onChange({ ...c, summary: e.target.value })}
      />
      <textarea
        className="note-edit note-edit-text tb-review-keypoints"
        placeholder="Key points (one per line)"
        value={arrayToLines(c.keyPoints)}
        onChange={(e) => onChange({ ...c, keyPoints: linesToArray(e.target.value) })}
      />
      <textarea
        className="note-edit note-edit-text tb-review-weakpoints"
        placeholder="Weak points (one per line)"
        value={arrayToLines(c.weakPoints)}
        onChange={(e) => onChange({ ...c, weakPoints: linesToArray(e.target.value) })}
      />
    </div>
  );
}

export const explanationPlugin: KitNoteTypePlugin = {
  label: "Explanation",
  render: (input) => <ExplanationRender {...input} />,
  edit: (input) => <ExplanationEditor {...input} />
};
export const reviewPackPlugin: KitNoteTypePlugin = {
  label: "Review Pack",
  render: (input) => <ReviewPackRender {...input} />,
  edit: (input) => <ReviewPackEditor {...input} />
};
export const exercisePlugin: KitNoteTypePlugin = {
  label: "Practice",
  render: (input) => <ExerciseRender {...input} />,
  edit: (input) => <ExerciseEditor {...input} />
};
export const mistakePlugin: KitNoteTypePlugin = {
  label: "Mistake",
  render: (input) => <MistakeRender {...input} />,
  edit: (input) => <MistakeEditor {...input} />
};
