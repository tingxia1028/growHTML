// Subject kits — the React half (render + edit) for the M-B exemplar types
// (subject-kits.md PART 1): 生词卡 / 公式卡 / 时间线. Pairs with the React-free specs
// in ./contentTypes; every display flows through getNoteType().render({mode}) — card is
// the light PreviewCard body (§10.3: 1–3 lines, no interaction), full is the Center
// View. Math renders ONLY through the shared <Latex> seam (PART 4.1); renders never
// throw on a bad/foreign shape (they coerce defensively, like every other plugin).

import type { NoteEditInput, NoteRenderInput } from "../../client/notes/noteTypeRegistry";
import { Latex } from "../../client/notes/Latex";
import type { KitNoteTypePlugin } from "../types";
import type { FormulaContent, TimelineContent, VocabContent } from "./contentTypes";

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const opt = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? "")) : []);

// —— 生词卡 subject.vocab ————————————————————————————————————————————————————
function asVocab(content: unknown): VocabContent {
  const c = (content ?? {}) as Partial<VocabContent>;
  const senses = Array.isArray(c.senses)
    ? c.senses.map((s) => ({
        definition: str((s as { definition?: unknown })?.definition),
        example: opt((s as { example?: unknown })?.example)
      }))
    : [];
  return {
    word: str(c.word),
    phonetic: opt(c.phonetic),
    pos: opt(c.pos),
    senses,
    synonyms: Array.isArray(c.synonyms) ? strings(c.synonyms) : undefined,
    antonyms: Array.isArray(c.antonyms) ? strings(c.antonyms) : undefined,
    tags: Array.isArray(c.tags) ? strings(c.tags) : undefined
    // `srs` is reserved/machine-managed — the renderer/editor never touch it.
  };
}

function VocabRender({ content, mode }: NoteRenderInput) {
  const c = asVocab(content);
  // CARD: front only (word + first definition) + the flip hint — the back stays for
  // the Center View, deliberately isomorphic to the built-in flashcard card (§1.4).
  if (mode === "card") {
    return (
      <div className="note-rendered sv-card-vocab">
        <p className="sv-vocab-word">{c.word || "(empty vocab)"}</p>
        <p className="sv-vocab-def">{c.senses[0]?.definition ?? ""}</p>
        <p className="sv-card-flashcard-hint">点击翻开查看背面</p>
      </div>
    );
  }
  // FULL: the flip-card layout the flashcard full mode uses (front face ↔ back face),
  // plus synonym/antonym chips. Deck nav across sibling vocab notes rides the D7
  // siblings seam (N4) — not reinvented here.
  return (
    <div className="note-rendered sv-vocab sv-flashcard sv-flashcard-expanded">
      <section className="sv-flashcard-face sv-vocab-front">
        <span className="sv-flashcard-face-label">Front</span>
        <p className="sv-vocab-word">{c.word || "(empty vocab)"}</p>
        {c.phonetic || c.pos ? (
          <p className="sv-vocab-meta">
            {c.phonetic ? <span className="sv-vocab-phonetic">{c.phonetic}</span> : null}
            {c.pos ? <span className="sv-vocab-pos">{c.pos}</span> : null}
          </p>
        ) : null}
      </section>
      <span className="sv-flashcard-swap" aria-hidden="true">
        ↔
      </span>
      <section className="sv-flashcard-face sv-vocab-back">
        <span className="sv-flashcard-face-label">Back</span>
        <ol className="sv-vocab-senses">
          {(c.senses.length ? c.senses : [{ definition: "(no senses)" }]).map((sense, i) => (
            <li key={i} className="sv-vocab-sense">
              <p className="sv-vocab-sense-def">{sense.definition}</p>
              {"example" in sense && sense.example ? <p className="sv-vocab-sense-example">{sense.example}</p> : null}
            </li>
          ))}
        </ol>
        {c.synonyms?.length ? (
          <p className="sv-vocab-chips sv-vocab-synonyms">
            近义 {c.synonyms.map((w, i) => <span key={i} className="sv-vocab-chip">{w}</span>)}
          </p>
        ) : null}
        {c.antonyms?.length ? (
          <p className="sv-vocab-chips sv-vocab-antonyms">
            反义 {c.antonyms.map((w, i) => <span key={i} className="sv-vocab-chip">{w}</span>)}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function VocabEditor({ content, onChange }: NoteEditInput) {
  const c = asVocab(content);
  const setSense = (index: number, patch: Partial<{ definition: string; example?: string }>) => {
    const senses = c.senses.slice();
    senses[index] = { ...senses[index], ...patch };
    onChange({ ...c, senses });
  };
  return (
    <div className="note-edit sv-edit-vocab">
      <input
        className="note-edit-field sv-vocab-edit-word"
        placeholder="单词 / 短语"
        value={c.word}
        onChange={(e) => onChange({ ...c, word: e.target.value })}
      />
      <div className="sv-edit-row">
        <input
          className="note-edit-field sv-vocab-edit-phonetic"
          placeholder="音标 (optional)"
          value={c.phonetic ?? ""}
          onChange={(e) => onChange({ ...c, phonetic: e.target.value || undefined })}
        />
        <input
          className="note-edit-field sv-vocab-edit-pos"
          placeholder="词性 (optional)"
          value={c.pos ?? ""}
          onChange={(e) => onChange({ ...c, pos: e.target.value || undefined })}
        />
      </div>
      {(c.senses.length ? c.senses : [{ definition: "" }]).map((sense, i) => (
        <div key={i} className="sv-edit-row sv-vocab-edit-sense">
          <input
            className="note-edit-field sv-vocab-edit-definition"
            placeholder={`释义 ${i + 1}`}
            value={sense.definition}
            onChange={(e) => setSense(i, { definition: e.target.value })}
          />
          <input
            className="note-edit-field sv-vocab-edit-example"
            placeholder="例句 (optional)"
            value={sense.example ?? ""}
            onChange={(e) => setSense(i, { example: e.target.value || undefined })}
          />
        </div>
      ))}
      <button
        type="button"
        className="link-button sv-vocab-add-sense"
        onClick={() => onChange({ ...c, senses: [...c.senses, { definition: "" }] })}
      >
        + 释义
      </button>
      <input
        className="note-edit-field sv-vocab-edit-synonyms"
        placeholder="近义词（逗号分隔）"
        value={(c.synonyms ?? []).join(", ")}
        onChange={(e) => {
          const list = e.target.value.split(/[,，]/).map((w) => w.trim()).filter(Boolean);
          onChange({ ...c, synonyms: list.length ? list : undefined });
        }}
      />
      <input
        className="note-edit-field sv-vocab-edit-antonyms"
        placeholder="反义词（逗号分隔）"
        value={(c.antonyms ?? []).join(", ")}
        onChange={(e) => {
          const list = e.target.value.split(/[,，]/).map((w) => w.trim()).filter(Boolean);
          onChange({ ...c, antonyms: list.length ? list : undefined });
        }}
      />
    </div>
  );
}

// —— 公式卡 subject.formula ——————————————————————————————————————————————————
function asFormula(content: unknown): FormulaContent {
  const c = (content ?? {}) as Partial<FormulaContent>;
  const variables = Array.isArray(c.variables)
    ? c.variables.map((v) => ({
        symbol: str((v as { symbol?: unknown })?.symbol),
        meaning: str((v as { meaning?: unknown })?.meaning),
        unit: opt((v as { unit?: unknown })?.unit)
      }))
    : [];
  return {
    latex: str(c.latex),
    name: opt(c.name),
    variables,
    derivationRef: opt(c.derivationRef),
    usage: opt(c.usage)
  };
}

function FormulaRender({ content, mode }: NoteRenderInput) {
  const c = asFormula(content);
  // CARD: one line of typeset LaTeX (title comes from `name` via noteCardMeta); no legend.
  if (mode === "card") {
    return (
      <div className="note-rendered sv-card-formula">
        {c.latex ? <Latex value={c.latex} inline /> : <span className="sv-formula-empty">(empty formula)</span>}
      </div>
    );
  }
  // FULL: block math · variable table · usage · derivation link seam (§1.1). Opening
  // the referenced derivation's Center View rides the D7 host seam — the affordance is
  // rendered (data attribute included) but stays inert until that seam lands.
  return (
    <div className="note-rendered sv-formula">
      {c.latex ? <Latex value={c.latex} /> : <p className="sv-formula-empty">(empty formula)</p>}
      {c.variables.length ? (
        <table className="sv-formula-variables">
          <thead>
            <tr>
              <th>符号</th>
              <th>含义</th>
              <th>单位</th>
            </tr>
          </thead>
          <tbody>
            {c.variables.map((variable, i) => (
              <tr key={i}>
                <td className="sv-formula-symbol">
                  <Latex value={variable.symbol} inline />
                </td>
                <td>{variable.meaning}</td>
                <td>{variable.unit ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {c.usage ? (
        <p className="sv-formula-usage">
          <strong>用法:</strong> {c.usage}
        </p>
      ) : null}
      {c.derivationRef ? (
        <span className="sv-formula-derivation-ref" data-note-id={c.derivationRef}>
          → 打开推导
        </span>
      ) : null}
    </div>
  );
}

function FormulaEditor({ content, onChange }: NoteEditInput) {
  const c = asFormula(content);
  const setVariable = (index: number, patch: Partial<{ symbol: string; meaning: string; unit?: string }>) => {
    const variables = c.variables.slice();
    variables[index] = { ...variables[index], ...patch };
    onChange({ ...c, variables });
  };
  return (
    <div className="note-edit sv-edit-formula">
      <input
        className="note-edit-field sv-formula-edit-name"
        placeholder="公式名称 (e.g. 动能定理)"
        value={c.name ?? ""}
        onChange={(e) => onChange({ ...c, name: e.target.value || undefined })}
      />
      <textarea
        className="note-edit note-edit-text sv-formula-edit-latex"
        placeholder="LaTeX, e.g. E_k = \frac{1}{2} m v^2"
        value={c.latex}
        onChange={(e) => onChange({ ...c, latex: e.target.value })}
      />
      {/* Live preview through the SAME <Latex> seam the render uses. */}
      <div className="sv-formula-edit-preview">{c.latex ? <Latex value={c.latex} /> : null}</div>
      {c.variables.map((variable, i) => (
        <div key={i} className="sv-edit-row sv-formula-edit-variable">
          <input
            className="note-edit-field sv-formula-edit-symbol"
            placeholder="符号"
            value={variable.symbol}
            onChange={(e) => setVariable(i, { symbol: e.target.value })}
          />
          <input
            className="note-edit-field sv-formula-edit-meaning"
            placeholder="含义"
            value={variable.meaning}
            onChange={(e) => setVariable(i, { meaning: e.target.value })}
          />
          <input
            className="note-edit-field sv-formula-edit-unit"
            placeholder="单位"
            value={variable.unit ?? ""}
            onChange={(e) => setVariable(i, { unit: e.target.value || undefined })}
          />
        </div>
      ))}
      <button
        type="button"
        className="link-button sv-formula-add-variable"
        onClick={() => onChange({ ...c, variables: [...c.variables, { symbol: "", meaning: "" }] })}
      >
        + 变量
      </button>
      <input
        className="note-edit-field sv-formula-edit-usage"
        placeholder="用法（一句话）"
        value={c.usage ?? ""}
        onChange={(e) => onChange({ ...c, usage: e.target.value || undefined })}
      />
    </div>
  );
}

// —— 时间线 subject.timeline —————————————————————————————————————————————————
function asTimeline(content: unknown): TimelineContent {
  const c = (content ?? {}) as Partial<TimelineContent>;
  const events = Array.isArray(c.events)
    ? c.events.map((e) => ({
        date: str((e as { date?: unknown })?.date),
        title: str((e as { title?: unknown })?.title),
        detail: opt((e as { detail?: unknown })?.detail),
        significance: opt((e as { significance?: unknown })?.significance)
      }))
    : [];
  return { title: str(c.title), events };
}

function TimelineRender({ content, mode }: NoteRenderInput) {
  const c = asTimeline(content);
  // CARD: first event lines only (§10.3 1–3 lines); the count lands in the footer via
  // noteCardMeta's extra, the title via its generic `title` scan.
  if (mode === "card") {
    return (
      <div className="note-rendered sv-card-timeline">
        {(c.events.slice(0, 3).length ? c.events.slice(0, 3) : [{ date: "", title: "(empty timeline)" }]).map(
          (event, i) => (
            <p key={i} className="sv-card-timeline-event">
              <span className="sv-timeline-date">{event.date}</span> {event.title}
            </p>
          )
        )}
      </div>
    );
  }
  // FULL: the vertical timeline (§1.8 sketch) — each node expands to detail/significance
  // via a native <details> (component-local, no host wiring).
  return (
    <div className="note-rendered sv-timeline">
      <ol className="sv-timeline-track">
        {c.events.map((event, i) => {
          const expandable = !!(event.detail || event.significance);
          const head = (
            <>
              <span className="sv-timeline-dot" aria-hidden="true">
                ●
              </span>
              <span className="sv-timeline-date">{event.date}</span>
              <span className="sv-timeline-event-title">{event.title}</span>
            </>
          );
          return (
            <li key={i} className="sv-timeline-node">
              {expandable ? (
                <details className="sv-timeline-details">
                  <summary className="sv-timeline-head">{head}</summary>
                  {event.detail ? <p className="sv-timeline-detail">{event.detail}</p> : null}
                  {event.significance ? <p className="sv-timeline-significance">{event.significance}</p> : null}
                </details>
              ) : (
                <span className="sv-timeline-head">{head}</span>
              )}
            </li>
          );
        })}
      </ol>
      {!c.events.length ? <p className="sv-timeline-empty">(no events)</p> : null}
    </div>
  );
}

function TimelineEditor({ content, onChange }: NoteEditInput) {
  const c = asTimeline(content);
  const setEvent = (
    index: number,
    patch: Partial<{ date: string; title: string; detail?: string; significance?: string }>
  ) => {
    const events = c.events.slice();
    events[index] = { ...events[index], ...patch };
    onChange({ ...c, events });
  };
  return (
    <div className="note-edit sv-edit-timeline">
      <input
        className="note-edit-field sv-timeline-edit-title"
        placeholder="时间线标题"
        value={c.title}
        onChange={(e) => onChange({ ...c, title: e.target.value })}
      />
      {(c.events.length ? c.events : [{ date: "", title: "" }]).map((event, i) => (
        <div key={i} className="sv-edit-row sv-timeline-edit-event">
          <input
            className="note-edit-field sv-timeline-edit-date"
            placeholder="时间"
            value={event.date}
            onChange={(e) => setEvent(i, { date: e.target.value })}
          />
          <input
            className="note-edit-field sv-timeline-edit-event-title"
            placeholder="事件"
            value={event.title}
            onChange={(e) => setEvent(i, { title: e.target.value })}
          />
          <input
            className="note-edit-field sv-timeline-edit-detail"
            placeholder="细节 (optional)"
            value={event.detail ?? ""}
            onChange={(e) => setEvent(i, { detail: e.target.value || undefined })}
          />
          <input
            className="note-edit-field sv-timeline-edit-significance"
            placeholder="意义 (optional)"
            value={event.significance ?? ""}
            onChange={(e) => setEvent(i, { significance: e.target.value || undefined })}
          />
        </div>
      ))}
      <button
        type="button"
        className="link-button sv-timeline-add-event"
        onClick={() => onChange({ ...c, events: [...c.events, { date: "", title: "" }] })}
      >
        + 事件
      </button>
    </div>
  );
}

// —— plugin registrations (SC-0: 中文 title + aliases on every one; hidden:false) ————
// `icon` strings stay on the plugin registration (palette rows). The central
// noteTypeIcon.ICONS rows are DEFERRED to the reader-gated batch: its parity test pairs
// it with annotationLayer.ts's MARKER_GLYPHS, a file the concurrent reader session owns.

export const vocabPlugin: KitNoteTypePlugin = {
  label: "生词卡",
  title: "生词卡",
  aliases: ["生词", "单词", "单词卡", "vocab", "word"],
  icon: "spell-check",
  hidden: false,
  render: (input) => <VocabRender {...input} />,
  edit: (input) => <VocabEditor {...input} />
};

export const formulaPlugin: KitNoteTypePlugin = {
  label: "公式卡",
  title: "公式卡",
  aliases: ["公式", "formula", "latex"],
  icon: "sigma",
  hidden: false,
  // Rich full view (block math + legend) worth centering (§1.1 focusable:true).
  focusable: true,
  render: (input) => <FormulaRender {...input} />,
  edit: (input) => <FormulaEditor {...input} />
};

export const timelinePlugin: KitNoteTypePlugin = {
  label: "时间线",
  title: "时间线",
  aliases: ["年表", "时间轴", "timeline"],
  icon: "history",
  hidden: false,
  // The vertical timeline is a rich, expandable full view (§1.8 focusable:true).
  focusable: true,
  render: (input) => <TimelineRender {...input} />,
  edit: (input) => <TimelineEditor {...input} />
};
