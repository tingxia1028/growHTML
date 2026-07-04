// The React half of the CORE `mistake` (错题) note type — moved out of the textbook
// kit by REV-CORE (kit-flatten-and-core-review.md §1): 错题 is the mission loop's
// rule-1 material, so both halves are core built-ins now. Markup/classes are
// UNCHANGED from the kit's MistakeRender (tb-mistake / tb-card …) so existing CSS
// and e2e selectors keep working; old `textbook.mistake` records reach this render
// through the registry's contentType alias (getNoteType is alias-aware).
// Importing this module registers the type (the built-in side-effect pattern).

import { renderNoteContent } from "../../adapters/notes/render";
import { MISTAKE_CONTENT_TYPE, type MistakeContent } from "../../core/notes/contentTypes";
import { registerNoteType, type NoteEditInput, type NoteRenderInput } from "./noteTypeRegistry";

// Prose → sanitized markdown HTML (same safe renderer the markdown note uses).
function Prose({ text }: { text: string }) {
  return <div className="note-rendered" dangerouslySetInnerHTML={{ __html: renderNoteContent("markdown", text).html }} />;
}

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

function MistakeRender({ content, mode }: NoteRenderInput) {
  const c = asMistake(content);
  if (mode === "card") {
    return <div className="note-rendered tb-card-preview tb-mistake-preview">{c.question || c.correction || "(empty mistake)"}</div>;
  }
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

// A CORE registration (no pluginId): 错题 is never gated by kit install state —
// same display meta the kit registration carried, so `/错题` keeps resolving.
registerNoteType({
  contentType: MISTAKE_CONTENT_TYPE,
  label: "Mistake",
  title: { zh: "错题", en: "Mistake" },
  aliases: ["错题本", "订正", "mistake"],
  render: (input) => <MistakeRender {...input} />,
  edit: (input) => <MistakeEditor {...input} />
});
