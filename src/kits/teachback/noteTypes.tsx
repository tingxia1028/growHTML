// Teach-back Kit — the React half (render + edit) for the two teachback types. Pairs
// with the React-free specs in ./contentTypes. Every display flows through
// getNoteType().render({mode}) — the ONE adaptive-note contract (card = the light
// preview body, full = the Center View). Renders never throw on a bad/foreign shape
// (they coerce defensively, like every other plugin), so a stale note can't crash a list.

import { renderNoteContent } from "../../adapters/notes/render";
import type { NoteEditInput, NoteRenderInput } from "../../client/notes/noteTypeRegistry";
import type { KitNoteTypePlugin } from "../types";
import type { TeachbackSummaryContent, TeachbackTurnContent } from "./contentTypes";

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? "")) : []);
const linesToArray = (text: string): string[] =>
  text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
const arrayToLines = (items: string[] | undefined): string => (items ?? []).join("\n");

// Prose → sanitized markdown HTML (the safe renderer the markdown note uses).
function Prose({ text }: { text: string }) {
  return <div className="note-rendered" dangerouslySetInnerHTML={{ __html: renderNoteContent("markdown", text).html }} />;
}

// —— Summary (teachback.summary) ————————————————————————————————————————————
function asSummary(content: unknown): TeachbackSummaryContent {
  const c = (content ?? {}) as Partial<TeachbackSummaryContent>;
  const transcript = Array.isArray(c.transcript)
    ? c.transcript.map((t) => asTurn(t))
    : [];
  return {
    topic: str(c.topic),
    explainedWell: strings(c.explainedWell),
    gaps: strings(c.gaps),
    summary: str(c.summary),
    transcript
  };
}

function SummaryRender({ content, mode }: NoteRenderInput) {
  const c = asSummary(content);
  if (mode === "card") {
    return (
      <div className="note-rendered tb2-card-preview tb2-summary-preview">
        {c.summary || c.topic || c.explainedWell[0] || "(空的教回小结)"}
      </div>
    );
  }
  return (
    <div className="note-rendered tb2-card tb2-summary">
      <div className="tb2-card-head">
        <span className="tb2-card-kind">教回小结</span>
        {c.topic ? <span className="tb2-badge">{c.topic}</span> : null}
      </div>
      {c.summary ? <Prose text={c.summary} /> : null}
      {c.explainedWell.length ? (
        <div className="tb2-section">
          <strong>讲清楚的</strong>
          <ul>{c.explainedWell.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </div>
      ) : null}
      {c.gaps.length ? (
        <div className="tb2-section tb2-warn">
          <strong>还没说透的</strong>
          <ul>{c.gaps.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </div>
      ) : null}
      {c.transcript.length ? (
        <details className="tb2-transcript">
          <summary>对话记录({c.transcript.length})</summary>
          <ul className="tb2-transcript-list">
            {c.transcript.map((turn, i) => (
              <li key={i} className={`tb2-turn tb2-turn-${turn.role}`}>
                <span className="tb2-turn-role">{turn.role === "ai" ? "AI" : "我"}</span>
                <span className="tb2-turn-text">{turn.text}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function SummaryEditor({ content, onChange }: NoteEditInput) {
  const c = asSummary(content);
  return (
    <div className="note-edit tb2-edit tb2-edit-summary">
      <input
        className="note-edit-field tb2-summary-topic"
        placeholder="主题"
        value={c.topic}
        onChange={(e) => onChange({ ...c, topic: e.target.value })}
      />
      <textarea
        className="note-edit note-edit-text tb2-summary-text"
        placeholder="小结(markdown)…"
        value={c.summary}
        onChange={(e) => onChange({ ...c, summary: e.target.value })}
      />
      <textarea
        className="note-edit note-edit-text tb2-summary-well"
        placeholder="讲清楚的(每行一条)"
        value={arrayToLines(c.explainedWell)}
        onChange={(e) => onChange({ ...c, explainedWell: linesToArray(e.target.value) })}
      />
      <textarea
        className="note-edit note-edit-text tb2-summary-gaps"
        placeholder="还没说透的(每行一条)"
        value={arrayToLines(c.gaps)}
        onChange={(e) => onChange({ ...c, gaps: linesToArray(e.target.value) })}
      />
    </div>
  );
}

// —— Turn (teachback.turn, hidden) ——————————————————————————————————————————
// hidden:true → never authored from the composer / slash palette. It still renders
// through the registry (the reducer + summary transcript reuse it), so a bare display
// path exists; the editor is a minimal text field (machine turns aren't hand-authored).
function asTurn(content: unknown): TeachbackTurnContent {
  const c = (content ?? {}) as Partial<TeachbackTurnContent>;
  const role = c.role === "student" ? "student" : "ai";
  const kind = c.kind === "probe" || c.kind === "explain" ? c.kind : "pose";
  return {
    role,
    kind,
    text: str(c.text),
    topic: str(c.topic),
    round: typeof c.round === "number" && Number.isFinite(c.round) ? c.round : 0
  };
}

function TurnRender({ content }: NoteRenderInput) {
  const c = asTurn(content);
  return (
    <div className={`note-rendered tb2-turn tb2-turn-${c.role}`}>
      <span className="tb2-turn-role">{c.role === "ai" ? "AI" : "我"}</span>
      <span className="tb2-turn-text">{c.text}</span>
    </div>
  );
}

function TurnEditor({ content, onChange }: NoteEditInput) {
  const c = asTurn(content);
  return (
    <textarea
      className="note-edit note-edit-text tb2-turn-text-edit"
      placeholder="内容…"
      value={c.text}
      onChange={(e) => onChange({ ...c, text: e.target.value })}
    />
  );
}

export const teachbackSummaryPlugin: KitNoteTypePlugin = {
  label: { zh: "教回小结", en: "Teach-back Summary" },
  title: { zh: "教回小结", en: "Teach-back Summary" },
  aliases: ["教回", "费曼", "teachback", "teach-back", "feynman"],
  render: (input) => <SummaryRender {...input} />,
  edit: (input) => <SummaryEditor {...input} />
};

export const teachbackTurnPlugin: KitNoteTypePlugin = {
  label: { zh: "教回对话", en: "Teach-back Turn" },
  // hidden: machine-produced/consumed by the runner reducer — not a composer form.
  hidden: true,
  render: (input) => <TurnRender {...input} />,
  edit: (input) => <TurnEditor {...input} />
};
