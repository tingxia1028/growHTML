// Subject kits — the React half (render + edit) for the M-B exemplar types
// (subject-kits.md PART 1): 生词卡 / 公式卡 / 时间线. Pairs with the React-free specs
// in ./contentTypes; every display flows through getNoteType().render({mode}) — card is
// the light PreviewCard body (§10.3: 1–3 lines, no interaction), full is the Center
// View. Math renders ONLY through the shared <Latex> seam (PART 4.1); renders never
// throw on a bad/foreign shape (they coerce defensively, like every other plugin).

import type { NoteEditInput, NoteRenderInput } from "../../client/notes/noteTypeRegistry";
import { FlipCard } from "../../client/notes/noteInteractive";
import { Latex } from "../../client/notes/Latex";
import type { KitNoteTypePlugin } from "../types";
import type {
  ArgumentContent,
  CauseEffectContent,
  DerivationContent,
  ExcerptContent,
  ExperimentContent,
  FigureContent,
  FormulaContent,
  GrammarContent,
  TheoremContent,
  TimelineContent,
  VocabContent
} from "./contentTypes";

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

function VocabRender({ content, mode, ctx }: NoteRenderInput) {
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
  // FULL is INTERACTIVE (N4-D7): the flip-card the flashcard full mode uses — the front
  // (word + phonetic/pos) shows until the user flips it to the back (senses + examples +
  // synonym/antonym chips), one face at a time via the shared <FlipCard>. This resolves
  // the flip half of the old deferred siblings-seam comment; DECK NAV across sibling
  // vocab notes stays DEFERRED (render() isn't handed sibling notes — that needs a new
  // ctx sibling seam). Keeps the sv-vocab-* / sv-flashcard-* classes so CSS still matches.
  return (
    <div className="note-rendered sv-vocab sv-flashcard sv-flashcard-expanded">
      <FlipCard
        className="sv-vocab-flip"
        initialFlipped={ctx?.initialFace === "back"}
        front={
          <section className="sv-flashcard-face sv-vocab-front">
            <span className="sv-flashcard-face-label">Front</span>
            <p className="sv-vocab-word">{c.word || "(empty vocab)"}</p>
            {c.phonetic || c.pos ? (
              <p className="sv-vocab-meta">
                {c.phonetic ? <span className="sv-vocab-phonetic">{c.phonetic}</span> : null}
                {c.pos ? <span className="sv-vocab-pos">{c.pos}</span> : null}
              </p>
            ) : null}
            <span className="sv-flashcard-swap" aria-hidden="true">
              ↔
            </span>
          </section>
        }
        back={
          <section className="sv-flashcard-face sv-vocab-back">
            <span className="sv-flashcard-face-label">Back</span>
            <ol className="sv-vocab-senses">
              {(c.senses.length ? c.senses : [{ definition: "(no senses)" }]).map((sense, i) => (
                <li key={i} className="sv-vocab-sense">
                  <p className="sv-vocab-sense-def">{sense.definition}</p>
                  {"example" in sense && sense.example ? (
                    <p className="sv-vocab-sense-example">{sense.example}</p>
                  ) : null}
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
        }
      />
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

// ═══════════════════════════════════════════════════════════════════════════
// M-C — the remaining 8 types' React halves. Same discipline as the M-B trio:
// defensive coercion (asX never throws), card = 1–3 lines / no interaction, full
// = the Center View, math ONLY through the shared <Latex> seam.
// ═══════════════════════════════════════════════════════════════════════════

const optTerm = (v: unknown): "短期" | "长期" | undefined => (v === "短期" || v === "长期" ? v : undefined);

// —— 推导步骤 subject.derivation ——————————————————————————————————————————————
function asDerivation(content: unknown): DerivationContent {
  const c = (content ?? {}) as Partial<DerivationContent>;
  const steps = Array.isArray(c.steps)
    ? c.steps.map((s) => ({
        expr: str((s as { expr?: unknown })?.expr),
        rationale: opt((s as { rationale?: unknown })?.rationale)
      }))
    : [];
  return { title: str(c.title), goal: opt(c.goal), steps, result: opt(c.result) };
}

function DerivationRender({ content, mode }: NoteRenderInput) {
  const c = asDerivation(content);
  // CARD: title (via noteCardMeta) + goal + step count — one compact line.
  if (mode === "card") {
    return (
      <div className="note-rendered sv-card-derivation">
        {c.goal ? <p className="sv-derivation-goal">目标: {c.goal}</p> : null}
        <p className="sv-derivation-count">{c.steps.length} 步推导</p>
      </div>
    );
  }
  // FULL: numbered LaTeX steps, each with a collapsible rationale; boxed result.
  return (
    <div className="note-rendered sv-derivation">
      {c.goal ? (
        <p className="sv-derivation-goal">
          <strong>目标:</strong> {c.goal}
        </p>
      ) : null}
      <ol className="sv-derivation-steps">
        {c.steps.map((step, i) => (
          <li key={i} className="sv-derivation-step">
            <div className="sv-derivation-expr">
              {step.expr ? <Latex value={step.expr} /> : <span className="sv-formula-empty">(empty step)</span>}
            </div>
            {step.rationale ? (
              <details className="sv-derivation-why">
                <summary>为什么</summary>
                <p className="sv-derivation-rationale">{step.rationale}</p>
              </details>
            ) : null}
          </li>
        ))}
      </ol>
      {!c.steps.length ? <p className="sv-formula-empty">(no steps)</p> : null}
      {c.result ? (
        <div className="sv-derivation-result">
          <span className="sv-derivation-result-label">结果</span>
          <Latex value={c.result} />
        </div>
      ) : null}
    </div>
  );
}

function DerivationEditor({ content, onChange }: NoteEditInput) {
  const c = asDerivation(content);
  const setStep = (index: number, patch: Partial<{ expr: string; rationale?: string }>) => {
    const steps = c.steps.slice();
    steps[index] = { ...steps[index], ...patch };
    onChange({ ...c, steps });
  };
  return (
    <div className="note-edit sv-edit-derivation">
      <input
        className="note-edit-field sv-derivation-edit-title"
        placeholder="推导标题"
        value={c.title}
        onChange={(e) => onChange({ ...c, title: e.target.value })}
      />
      <input
        className="note-edit-field sv-derivation-edit-goal"
        placeholder="目标 (optional)"
        value={c.goal ?? ""}
        onChange={(e) => onChange({ ...c, goal: e.target.value || undefined })}
      />
      {(c.steps.length ? c.steps : [{ expr: "" }]).map((step, i) => (
        <div key={i} className="sv-edit-row sv-derivation-edit-step">
          <textarea
            className="note-edit note-edit-text sv-derivation-edit-expr"
            placeholder={`步骤 ${i + 1} (LaTeX)`}
            value={step.expr}
            onChange={(e) => setStep(i, { expr: e.target.value })}
          />
          <input
            className="note-edit-field sv-derivation-edit-rationale"
            placeholder="理由 (optional)"
            value={step.rationale ?? ""}
            onChange={(e) => setStep(i, { rationale: e.target.value || undefined })}
          />
        </div>
      ))}
      <button
        type="button"
        className="link-button sv-derivation-add-step"
        onClick={() => onChange({ ...c, steps: [...c.steps, { expr: "" }] })}
      >
        + 步骤
      </button>
      <textarea
        className="note-edit note-edit-text sv-derivation-edit-result"
        placeholder="结果 (LaTeX, optional)"
        value={c.result ?? ""}
        onChange={(e) => onChange({ ...c, result: e.target.value || undefined })}
      />
    </div>
  );
}

// —— 定理卡 subject.theorem ————————————————————————————————————————————————————
function asTheorem(content: unknown): TheoremContent {
  const c = (content ?? {}) as Partial<TheoremContent>;
  return {
    name: str(c.name),
    statement: str(c.statement),
    conditions: Array.isArray(c.conditions) ? strings(c.conditions) : undefined,
    proof: opt(c.proof),
    usage: opt(c.usage),
    examples: Array.isArray(c.examples) ? strings(c.examples) : undefined
  };
}

function TheoremRender({ content, mode }: NoteRenderInput) {
  const c = asTheorem(content);
  // CARD: name (via noteCardMeta) + first statement line.
  if (mode === "card") {
    return (
      <div className="note-rendered sv-card-theorem">
        <p className="sv-theorem-statement">{c.statement.split(/\r?\n/)[0] || "(empty theorem)"}</p>
      </div>
    );
  }
  // FULL: statement (LaTeX-aware) · conditions · proof (collapsed) · usage · examples.
  return (
    <div className="note-rendered sv-theorem">
      <p className="sv-theorem-statement">
        <Latex value={c.statement} inline />
      </p>
      {c.conditions?.length ? (
        <div className="sv-theorem-conditions">
          <span className="sv-section-label">条件</span>
          <ul>
            {c.conditions.map((cond, i) => (
              <li key={i}>{cond}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {c.proof ? (
        <details className="sv-theorem-proof">
          <summary>证明</summary>
          <p>{c.proof}</p>
        </details>
      ) : null}
      {c.usage ? (
        <p className="sv-theorem-usage">
          <strong>用法:</strong> {c.usage}
        </p>
      ) : null}
      {c.examples?.length ? (
        <div className="sv-theorem-examples">
          <span className="sv-section-label">例</span>
          <ul>
            {c.examples.map((ex, i) => (
              <li key={i}>{ex}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function TheoremEditor({ content, onChange }: NoteEditInput) {
  const c = asTheorem(content);
  const lines = (list?: string[]) => (list ?? []).join("\n");
  const toList = (raw: string) => {
    const list = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    return list.length ? list : undefined;
  };
  return (
    <div className="note-edit sv-edit-theorem">
      <input
        className="note-edit-field sv-theorem-edit-name"
        placeholder="定理名称"
        value={c.name}
        onChange={(e) => onChange({ ...c, name: e.target.value })}
      />
      <textarea
        className="note-edit note-edit-text sv-theorem-edit-statement"
        placeholder="定理内容 (LaTeX-aware)"
        value={c.statement}
        onChange={(e) => onChange({ ...c, statement: e.target.value })}
      />
      <textarea
        className="note-edit note-edit-text sv-theorem-edit-conditions"
        placeholder="前置条件（每行一条）"
        value={lines(c.conditions)}
        onChange={(e) => onChange({ ...c, conditions: toList(e.target.value) })}
      />
      <textarea
        className="note-edit note-edit-text sv-theorem-edit-proof"
        placeholder="证明 (optional)"
        value={c.proof ?? ""}
        onChange={(e) => onChange({ ...c, proof: e.target.value || undefined })}
      />
      <input
        className="note-edit-field sv-theorem-edit-usage"
        placeholder="用法 (optional)"
        value={c.usage ?? ""}
        onChange={(e) => onChange({ ...c, usage: e.target.value || undefined })}
      />
      <textarea
        className="note-edit note-edit-text sv-theorem-edit-examples"
        placeholder="用例（每行一条）"
        value={lines(c.examples)}
        onChange={(e) => onChange({ ...c, examples: toList(e.target.value) })}
      />
    </div>
  );
}

// —— 语法点 subject.grammar ————————————————————————————————————————————————————
function asGrammar(content: unknown): GrammarContent {
  const c = (content ?? {}) as Partial<GrammarContent>;
  const examples = Array.isArray(c.examples)
    ? c.examples.map((e) => ({
        sentence: str((e as { sentence?: unknown })?.sentence),
        note: opt((e as { note?: unknown })?.note)
      }))
    : [];
  return {
    pattern: str(c.pattern),
    meaning: str(c.meaning),
    structure: opt(c.structure),
    examples,
    pitfalls: Array.isArray(c.pitfalls) ? strings(c.pitfalls) : undefined
  };
}

function GrammarRender({ content, mode }: NoteRenderInput) {
  const c = asGrammar(content);
  // CARD: pattern line (title from `pattern` via noteCardMeta fallback).
  if (mode === "card") {
    return (
      <div className="note-rendered sv-card-grammar">
        <p className="sv-grammar-pattern">{c.pattern || "(empty grammar)"}</p>
        {c.meaning ? <p className="sv-grammar-meaning">{c.meaning}</p> : null}
      </div>
    );
  }
  // FULL: pattern + meaning + structure + example rows + pitfalls (warn styling).
  return (
    <div className="note-rendered sv-grammar">
      <p className="sv-grammar-pattern">{c.pattern}</p>
      {c.meaning ? <p className="sv-grammar-meaning">{c.meaning}</p> : null}
      {c.structure ? <p className="sv-grammar-structure">{c.structure}</p> : null}
      {c.examples.length ? (
        <ul className="sv-grammar-examples">
          {c.examples.map((ex, i) => (
            <li key={i} className="sv-grammar-example">
              <span className="sv-grammar-sentence">{ex.sentence}</span>
              {ex.note ? <span className="sv-grammar-note"> — {ex.note}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {c.pitfalls?.length ? (
        <div className="sv-section sv-warn sv-grammar-pitfalls">
          <strong>易错点</strong>
          <ul>
            {c.pitfalls.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function GrammarEditor({ content, onChange }: NoteEditInput) {
  const c = asGrammar(content);
  const setExample = (index: number, patch: Partial<{ sentence: string; note?: string }>) => {
    const examples = c.examples.slice();
    examples[index] = { ...examples[index], ...patch };
    onChange({ ...c, examples });
  };
  return (
    <div className="note-edit sv-edit-grammar">
      <input
        className="note-edit-field sv-grammar-edit-pattern"
        placeholder="语法结构 (e.g. would rather + 动词原形)"
        value={c.pattern}
        onChange={(e) => onChange({ ...c, pattern: e.target.value })}
      />
      <input
        className="note-edit-field sv-grammar-edit-meaning"
        placeholder="含义"
        value={c.meaning}
        onChange={(e) => onChange({ ...c, meaning: e.target.value })}
      />
      <input
        className="note-edit-field sv-grammar-edit-structure"
        placeholder="结构模板 (optional)"
        value={c.structure ?? ""}
        onChange={(e) => onChange({ ...c, structure: e.target.value || undefined })}
      />
      {(c.examples.length ? c.examples : [{ sentence: "" }]).map((ex, i) => (
        <div key={i} className="sv-edit-row sv-grammar-edit-example">
          <input
            className="note-edit-field sv-grammar-edit-sentence"
            placeholder={`例句 ${i + 1}`}
            value={ex.sentence}
            onChange={(e) => setExample(i, { sentence: e.target.value })}
          />
          <input
            className="note-edit-field sv-grammar-edit-note"
            placeholder="注释 (optional)"
            value={ex.note ?? ""}
            onChange={(e) => setExample(i, { note: e.target.value || undefined })}
          />
        </div>
      ))}
      <button
        type="button"
        className="link-button sv-grammar-add-example"
        onClick={() => onChange({ ...c, examples: [...c.examples, { sentence: "" }] })}
      >
        + 例句
      </button>
      <textarea
        className="note-edit note-edit-text sv-grammar-edit-pitfalls"
        placeholder="易错点（每行一条）"
        value={(c.pitfalls ?? []).join("\n")}
        onChange={(e) => {
          const list = e.target.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
          onChange({ ...c, pitfalls: list.length ? list : undefined });
        }}
      />
    </div>
  );
}

// —— 摘抄赏析 subject.excerpt ——————————————————————————————————————————————————
function asExcerpt(content: unknown): ExcerptContent {
  const c = (content ?? {}) as Partial<ExcerptContent>;
  return {
    quote: str(c.quote),
    author: opt(c.author),
    work: opt(c.work),
    comment: str(c.comment),
    devices: Array.isArray(c.devices) ? strings(c.devices) : undefined,
    theme: opt(c.theme)
  };
}

function ExcerptRender({ content, mode }: NoteRenderInput) {
  const c = asExcerpt(content);
  // CARD: the quote (2 lines, blockquote styling); title from `quote` via noteCardMeta.
  if (mode === "card") {
    return (
      <blockquote className="note-rendered sv-card-excerpt">{c.quote || "(empty excerpt)"}</blockquote>
    );
  }
  // FULL: quote block + attribution + comment prose + devices chips + theme.
  return (
    <div className="note-rendered sv-excerpt">
      <blockquote className="sv-excerpt-quote">{c.quote}</blockquote>
      {c.author || c.work ? (
        <p className="sv-excerpt-attribution">
          {c.author ? <span className="sv-excerpt-author">{c.author}</span> : null}
          {c.work ? <span className="sv-excerpt-work">《{c.work}》</span> : null}
        </p>
      ) : null}
      {c.comment ? <p className="sv-excerpt-comment">{c.comment}</p> : null}
      {c.devices?.length ? (
        <p className="sv-excerpt-devices">
          {c.devices.map((d, i) => (
            <span key={i} className="sv-excerpt-device">
              {d}
            </span>
          ))}
        </p>
      ) : null}
      {c.theme ? (
        <p className="sv-excerpt-theme">
          <strong>主题:</strong> {c.theme}
        </p>
      ) : null}
    </div>
  );
}

function ExcerptEditor({ content, onChange }: NoteEditInput) {
  const c = asExcerpt(content);
  return (
    <div className="note-edit sv-edit-excerpt">
      <textarea
        className="note-edit note-edit-text sv-excerpt-edit-quote"
        placeholder="摘抄原文"
        value={c.quote}
        onChange={(e) => onChange({ ...c, quote: e.target.value })}
      />
      <div className="sv-edit-row">
        <input
          className="note-edit-field sv-excerpt-edit-author"
          placeholder="作者 (optional)"
          value={c.author ?? ""}
          onChange={(e) => onChange({ ...c, author: e.target.value || undefined })}
        />
        <input
          className="note-edit-field sv-excerpt-edit-work"
          placeholder="出处/作品 (optional)"
          value={c.work ?? ""}
          onChange={(e) => onChange({ ...c, work: e.target.value || undefined })}
        />
      </div>
      <textarea
        className="note-edit note-edit-text sv-excerpt-edit-comment"
        placeholder="赏析"
        value={c.comment}
        onChange={(e) => onChange({ ...c, comment: e.target.value })}
      />
      <input
        className="note-edit-field sv-excerpt-edit-devices"
        placeholder="修辞手法（逗号分隔）"
        value={(c.devices ?? []).join(", ")}
        onChange={(e) => {
          const list = e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
          onChange({ ...c, devices: list.length ? list : undefined });
        }}
      />
      <input
        className="note-edit-field sv-excerpt-edit-theme"
        placeholder="主题 (optional)"
        value={c.theme ?? ""}
        onChange={(e) => onChange({ ...c, theme: e.target.value || undefined })}
      />
    </div>
  );
}

// —— 论证结构 subject.argument ——————————————————————————————————————————————————
function asArgument(content: unknown): ArgumentContent {
  const c = (content ?? {}) as Partial<ArgumentContent>;
  return {
    claim: str(c.claim),
    grounds: Array.isArray(c.grounds) ? strings(c.grounds) : [],
    warrant: opt(c.warrant),
    evidence: Array.isArray(c.evidence) ? strings(c.evidence) : undefined,
    counter: Array.isArray(c.counter) ? strings(c.counter) : undefined,
    conclusion: opt(c.conclusion)
  };
}

function ArgumentRender({ content, mode }: NoteRenderInput) {
  const c = asArgument(content);
  // CARD: claim line (title from `claim` via noteCardMeta).
  if (mode === "card") {
    return (
      <div className="note-rendered sv-card-argument">
        <p className="sv-argument-claim">{c.claim || "(empty argument)"}</p>
      </div>
    );
  }
  // FULL: Toulmin-style indent tree — claim → grounds → warrant → evidence, then
  // counter + conclusion.
  return (
    <div className="note-rendered sv-argument">
      <p className="sv-argument-claim">
        <span className="sv-section-label">论点</span> {c.claim}
      </p>
      {c.grounds.length ? (
        <div className="sv-argument-grounds">
          <span className="sv-section-label">论据</span>
          <ul>
            {c.grounds.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {c.warrant ? (
        <p className="sv-argument-warrant">
          <span className="sv-section-label">推理</span> {c.warrant}
        </p>
      ) : null}
      {c.evidence?.length ? (
        <div className="sv-argument-evidence">
          <span className="sv-section-label">证据</span>
          <ul>
            {c.evidence.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {c.counter?.length ? (
        <div className="sv-argument-counter">
          <span className="sv-section-label">反驳</span>
          <ul>
            {c.counter.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {c.conclusion ? (
        <p className="sv-argument-conclusion">
          <span className="sv-section-label">结论</span> {c.conclusion}
        </p>
      ) : null}
    </div>
  );
}

function ArgumentEditor({ content, onChange }: NoteEditInput) {
  const c = asArgument(content);
  const listField = (label: string, cls: string, value: string[], apply: (v: string[]) => void) => (
    <textarea
      className={`note-edit note-edit-text ${cls}`}
      placeholder={label}
      value={value.join("\n")}
      onChange={(e) => apply(e.target.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))}
    />
  );
  const optList = (v: string[]) => (v.length ? v : undefined);
  return (
    <div className="note-edit sv-edit-argument">
      <textarea
        className="note-edit note-edit-text sv-argument-edit-claim"
        placeholder="中心论点"
        value={c.claim}
        onChange={(e) => onChange({ ...c, claim: e.target.value })}
      />
      {listField("论据（每行一条）", "sv-argument-edit-grounds", c.grounds, (v) => onChange({ ...c, grounds: v }))}
      <input
        className="note-edit-field sv-argument-edit-warrant"
        placeholder="推理/逻辑 (optional)"
        value={c.warrant ?? ""}
        onChange={(e) => onChange({ ...c, warrant: e.target.value || undefined })}
      />
      {listField("证据（每行一条, optional）", "sv-argument-edit-evidence", c.evidence ?? [], (v) =>
        onChange({ ...c, evidence: optList(v) })
      )}
      {listField("反驳（每行一条, optional）", "sv-argument-edit-counter", c.counter ?? [], (v) =>
        onChange({ ...c, counter: optList(v) })
      )}
      <input
        className="note-edit-field sv-argument-edit-conclusion"
        placeholder="结论 (optional)"
        value={c.conclusion ?? ""}
        onChange={(e) => onChange({ ...c, conclusion: e.target.value || undefined })}
      />
    </div>
  );
}

// —— 人物卡 subject.figure ——————————————————————————————————————————————————————
function asFigure(content: unknown): FigureContent {
  const c = (content ?? {}) as Partial<FigureContent>;
  const relations = Array.isArray(c.relations)
    ? c.relations.map((r) => ({
        name: str((r as { name?: unknown })?.name),
        relation: str((r as { relation?: unknown })?.relation)
      }))
    : undefined;
  return {
    name: str(c.name),
    era: opt(c.era),
    role: opt(c.role),
    facts: Array.isArray(c.facts) ? strings(c.facts) : [],
    works: Array.isArray(c.works) ? strings(c.works) : undefined,
    significance: opt(c.significance),
    relations
  };
}

function FigureRender({ content, mode }: NoteRenderInput) {
  const c = asFigure(content);
  // CARD: name (via noteCardMeta) + role.
  if (mode === "card") {
    return (
      <div className="note-rendered sv-card-figure">
        {c.role ? <p className="sv-figure-role">{c.role}</p> : null}
        {c.era ? <p className="sv-figure-era">{c.era}</p> : null}
      </div>
    );
  }
  // FULL: fact sheet — era/role header, facts, works, significance, relations.
  return (
    <div className="note-rendered sv-figure">
      {c.era || c.role ? (
        <p className="sv-figure-header">
          {c.era ? <span className="sv-figure-era">{c.era}</span> : null}
          {c.role ? <span className="sv-figure-role">{c.role}</span> : null}
        </p>
      ) : null}
      {c.facts.length ? (
        <ul className="sv-figure-facts">
          {c.facts.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      ) : null}
      {c.works?.length ? (
        <div className="sv-figure-works">
          <span className="sv-section-label">作品</span>
          <ul>
            {c.works.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {c.significance ? (
        <p className="sv-figure-significance">
          <strong>意义:</strong> {c.significance}
        </p>
      ) : null}
      {c.relations?.length ? (
        <div className="sv-figure-relations">
          <span className="sv-section-label">关系</span>
          <ul>
            {c.relations.map((r, i) => (
              <li key={i}>
                <span className="sv-figure-relation-name">{r.name}</span>
                <span className="sv-figure-relation-rel"> — {r.relation}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function FigureEditor({ content, onChange }: NoteEditInput) {
  const c = asFigure(content);
  const setRelation = (index: number, patch: Partial<{ name: string; relation: string }>) => {
    const relations = (c.relations ?? []).slice();
    relations[index] = { ...relations[index], ...patch };
    onChange({ ...c, relations });
  };
  return (
    <div className="note-edit sv-edit-figure">
      <input
        className="note-edit-field sv-figure-edit-name"
        placeholder="人物姓名"
        value={c.name}
        onChange={(e) => onChange({ ...c, name: e.target.value })}
      />
      <div className="sv-edit-row">
        <input
          className="note-edit-field sv-figure-edit-era"
          placeholder="时代 (optional)"
          value={c.era ?? ""}
          onChange={(e) => onChange({ ...c, era: e.target.value || undefined })}
        />
        <input
          className="note-edit-field sv-figure-edit-role"
          placeholder="身份/角色 (optional)"
          value={c.role ?? ""}
          onChange={(e) => onChange({ ...c, role: e.target.value || undefined })}
        />
      </div>
      <textarea
        className="note-edit note-edit-text sv-figure-edit-facts"
        placeholder="关键事迹（每行一条）"
        value={c.facts.join("\n")}
        onChange={(e) =>
          onChange({ ...c, facts: e.target.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) })
        }
      />
      <textarea
        className="note-edit note-edit-text sv-figure-edit-works"
        placeholder="代表作品（每行一条, optional）"
        value={(c.works ?? []).join("\n")}
        onChange={(e) => {
          const list = e.target.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
          onChange({ ...c, works: list.length ? list : undefined });
        }}
      />
      <input
        className="note-edit-field sv-figure-edit-significance"
        placeholder="历史意义 (optional)"
        value={c.significance ?? ""}
        onChange={(e) => onChange({ ...c, significance: e.target.value || undefined })}
      />
      {(c.relations ?? []).map((r, i) => (
        <div key={i} className="sv-edit-row sv-figure-edit-relation">
          <input
            className="note-edit-field sv-figure-edit-relation-name"
            placeholder="相关人物"
            value={r.name}
            onChange={(e) => setRelation(i, { name: e.target.value })}
          />
          <input
            className="note-edit-field sv-figure-edit-relation-rel"
            placeholder="关系"
            value={r.relation}
            onChange={(e) => setRelation(i, { relation: e.target.value })}
          />
        </div>
      ))}
      <button
        type="button"
        className="link-button sv-figure-add-relation"
        onClick={() => onChange({ ...c, relations: [...(c.relations ?? []), { name: "", relation: "" }] })}
      >
        + 关系
      </button>
    </div>
  );
}

// —— 因果链 subject.cause-effect ————————————————————————————————————————————————
function asCauseEffect(content: unknown): CauseEffectContent {
  const c = (content ?? {}) as Partial<CauseEffectContent>;
  const causes = Array.isArray(c.causes)
    ? c.causes.map((x) => ({
        factor: str((x as { factor?: unknown })?.factor),
        category: opt((x as { category?: unknown })?.category)
      }))
    : [];
  const effects = Array.isArray(c.effects)
    ? c.effects.map((x) => ({
        outcome: str((x as { outcome?: unknown })?.outcome),
        term: optTerm((x as { term?: unknown })?.term)
      }))
    : [];
  return { title: str(c.title), event: str(c.event), causes, effects };
}

function CauseEffectRender({ content, mode }: NoteRenderInput) {
  const c = asCauseEffect(content);
  // CARD: event + cause/effect counts (title via noteCardMeta's `title` scan; the
  // event line + counts fill the card body).
  if (mode === "card") {
    return (
      <div className="note-rendered sv-card-cause-effect">
        <p className="sv-cause-effect-event">{c.event || "(empty chain)"}</p>
        <p className="sv-cause-effect-count">
          {c.causes.length} 因 · {c.effects.length} 果
        </p>
      </div>
    );
  }
  // FULL: cause → event → effect layout.
  return (
    <div className="note-rendered sv-cause-effect">
      <div className="sv-cause-effect-flow">
        <div className="sv-cause-effect-causes">
          <span className="sv-section-label">起因</span>
          <ul>
            {c.causes.map((x, i) => (
              <li key={i}>
                {x.category ? <span className="sv-cause-effect-category">[{x.category}]</span> : null}
                {x.factor}
              </li>
            ))}
          </ul>
        </div>
        <div className="sv-cause-effect-pivot">
          <span className="sv-cause-effect-arrow" aria-hidden="true">
            →
          </span>
          <span className="sv-cause-effect-event">{c.event}</span>
          <span className="sv-cause-effect-arrow" aria-hidden="true">
            →
          </span>
        </div>
        <div className="sv-cause-effect-effects">
          <span className="sv-section-label">结果</span>
          <ul>
            {c.effects.map((x, i) => (
              <li key={i}>
                {x.term ? <span className="sv-cause-effect-term">[{x.term}]</span> : null}
                {x.outcome}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function CauseEffectEditor({ content, onChange }: NoteEditInput) {
  const c = asCauseEffect(content);
  const setCause = (index: number, patch: Partial<{ factor: string; category?: string }>) => {
    const causes = c.causes.slice();
    causes[index] = { ...causes[index], ...patch };
    onChange({ ...c, causes });
  };
  const setEffect = (index: number, patch: Partial<{ outcome: string; term?: "短期" | "长期" }>) => {
    const effects = c.effects.slice();
    effects[index] = { ...effects[index], ...patch };
    onChange({ ...c, effects });
  };
  return (
    <div className="note-edit sv-edit-cause-effect">
      <input
        className="note-edit-field sv-cause-effect-edit-title"
        placeholder="标题"
        value={c.title}
        onChange={(e) => onChange({ ...c, title: e.target.value })}
      />
      <input
        className="note-edit-field sv-cause-effect-edit-event"
        placeholder="核心事件"
        value={c.event}
        onChange={(e) => onChange({ ...c, event: e.target.value })}
      />
      {(c.causes.length ? c.causes : [{ factor: "" }]).map((x, i) => (
        <div key={i} className="sv-edit-row sv-cause-effect-edit-cause">
          <input
            className="note-edit-field sv-cause-effect-edit-factor"
            placeholder={`起因 ${i + 1}`}
            value={x.factor}
            onChange={(e) => setCause(i, { factor: e.target.value })}
          />
          <input
            className="note-edit-field sv-cause-effect-edit-category"
            placeholder="类别 (optional)"
            value={x.category ?? ""}
            onChange={(e) => setCause(i, { category: e.target.value || undefined })}
          />
        </div>
      ))}
      <button
        type="button"
        className="link-button sv-cause-effect-add-cause"
        onClick={() => onChange({ ...c, causes: [...c.causes, { factor: "" }] })}
      >
        + 起因
      </button>
      {(c.effects.length ? c.effects : [{ outcome: "" }]).map((x, i) => (
        <div key={i} className="sv-edit-row sv-cause-effect-edit-effect">
          <input
            className="note-edit-field sv-cause-effect-edit-outcome"
            placeholder={`结果 ${i + 1}`}
            value={x.outcome}
            onChange={(e) => setEffect(i, { outcome: e.target.value })}
          />
          <select
            className="note-edit-field sv-cause-effect-edit-term"
            value={x.term ?? ""}
            onChange={(e) =>
              setEffect(i, { term: e.target.value === "短期" || e.target.value === "长期" ? e.target.value : undefined })
            }
          >
            <option value="">—</option>
            <option value="短期">短期</option>
            <option value="长期">长期</option>
          </select>
        </div>
      ))}
      <button
        type="button"
        className="link-button sv-cause-effect-add-effect"
        onClick={() => onChange({ ...c, effects: [...c.effects, { outcome: "" }] })}
      >
        + 结果
      </button>
    </div>
  );
}

// —— 实验记录 subject.experiment ————————————————————————————————————————————————
function asExperiment(content: unknown): ExperimentContent {
  const c = (content ?? {}) as Partial<ExperimentContent>;
  return {
    title: str(c.title),
    purpose: str(c.purpose),
    materials: Array.isArray(c.materials) ? strings(c.materials) : undefined,
    procedure: Array.isArray(c.procedure) ? strings(c.procedure) : [],
    observations: Array.isArray(c.observations) ? strings(c.observations) : undefined,
    conclusion: opt(c.conclusion),
    safety: Array.isArray(c.safety) ? strings(c.safety) : undefined
  };
}

function ExperimentRender({ content, mode }: NoteRenderInput) {
  const c = asExperiment(content);
  // CARD: conclusion or purpose line (title from `title` via noteCardMeta).
  if (mode === "card") {
    return (
      <div className="note-rendered sv-card-experiment">
        <p className="sv-experiment-line">{c.conclusion || c.purpose || "(empty experiment)"}</p>
      </div>
    );
  }
  // FULL: purpose · materials · numbered procedure · observations · conclusion +
  // a safety callout in warn styling.
  return (
    <div className="note-rendered sv-experiment">
      {c.purpose ? (
        <p className="sv-experiment-purpose">
          <span className="sv-section-label">目的</span> {c.purpose}
        </p>
      ) : null}
      {c.materials?.length ? (
        <div className="sv-experiment-materials">
          <span className="sv-section-label">材料</span>
          <ul>
            {c.materials.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {c.procedure.length ? (
        <div className="sv-experiment-procedure">
          <span className="sv-section-label">步骤</span>
          <ol>
            {c.procedure.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {c.observations?.length ? (
        <div className="sv-experiment-observations">
          <span className="sv-section-label">现象</span>
          <ul>
            {c.observations.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {c.conclusion ? (
        <p className="sv-experiment-conclusion">
          <span className="sv-section-label">结论</span> {c.conclusion}
        </p>
      ) : null}
      {c.safety?.length ? (
        <div className="sv-section sv-warn sv-experiment-safety">
          <strong>安全提示</strong>
          <ul>
            {c.safety.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ExperimentEditor({ content, onChange }: NoteEditInput) {
  const c = asExperiment(content);
  const listField = (
    label: string,
    cls: string,
    value: string[],
    apply: (v: string[]) => void
  ) => (
    <textarea
      className={`note-edit note-edit-text ${cls}`}
      placeholder={label}
      value={value.join("\n")}
      onChange={(e) => apply(e.target.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))}
    />
  );
  const optList = (v: string[]) => (v.length ? v : undefined);
  return (
    <div className="note-edit sv-edit-experiment">
      <input
        className="note-edit-field sv-experiment-edit-title"
        placeholder="实验标题"
        value={c.title}
        onChange={(e) => onChange({ ...c, title: e.target.value })}
      />
      <textarea
        className="note-edit note-edit-text sv-experiment-edit-purpose"
        placeholder="实验目的"
        value={c.purpose}
        onChange={(e) => onChange({ ...c, purpose: e.target.value })}
      />
      {listField("材料（每行一条, optional）", "sv-experiment-edit-materials", c.materials ?? [], (v) =>
        onChange({ ...c, materials: optList(v) })
      )}
      {listField("步骤（每行一条）", "sv-experiment-edit-procedure", c.procedure, (v) =>
        onChange({ ...c, procedure: v })
      )}
      {listField("现象（每行一条, optional）", "sv-experiment-edit-observations", c.observations ?? [], (v) =>
        onChange({ ...c, observations: optList(v) })
      )}
      <input
        className="note-edit-field sv-experiment-edit-conclusion"
        placeholder="结论 (optional)"
        value={c.conclusion ?? ""}
        onChange={(e) => onChange({ ...c, conclusion: e.target.value || undefined })}
      />
      {listField("安全提示（每行一条, optional）", "sv-experiment-edit-safety", c.safety ?? [], (v) =>
        onChange({ ...c, safety: optList(v) })
      )}
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

// —— M-C plugin registrations —————————————————————————————————————————————————

export const derivationPlugin: KitNoteTypePlugin = {
  label: "推导步骤",
  title: "推导步骤",
  aliases: ["推导", "derivation", "steps"],
  icon: "list-ordered",
  hidden: false,
  // Step-through + block math full view is worth centering (§1.2).
  focusable: true,
  render: (input) => <DerivationRender {...input} />,
  edit: (input) => <DerivationEditor {...input} />
};

export const theoremPlugin: KitNoteTypePlugin = {
  label: "定理卡",
  title: "定理卡",
  aliases: ["定理", "theorem"],
  icon: "scroll-text",
  hidden: false,
  render: (input) => <TheoremRender {...input} />,
  edit: (input) => <TheoremEditor {...input} />
};

export const grammarPlugin: KitNoteTypePlugin = {
  label: "语法点",
  title: "语法点",
  aliases: ["语法", "grammar"],
  icon: "languages",
  hidden: false,
  render: (input) => <GrammarRender {...input} />,
  edit: (input) => <GrammarEditor {...input} />
};

export const excerptPlugin: KitNoteTypePlugin = {
  label: "摘抄赏析",
  title: "摘抄赏析",
  aliases: ["摘抄", "赏析", "excerpt", "quote"],
  icon: "quote",
  hidden: false,
  render: (input) => <ExcerptRender {...input} />,
  edit: (input) => <ExcerptEditor {...input} />
};

export const argumentPlugin: KitNoteTypePlugin = {
  label: "论证结构",
  title: "论证结构",
  aliases: ["论证", "argument"],
  icon: "scale",
  hidden: false,
  // The Toulmin indent tree is a rich full view (§1.7).
  focusable: true,
  render: (input) => <ArgumentRender {...input} />,
  edit: (input) => <ArgumentEditor {...input} />
};

export const figurePlugin: KitNoteTypePlugin = {
  label: "人物卡",
  title: "人物卡",
  aliases: ["人物", "figure", "person"],
  icon: "user-round",
  hidden: false,
  render: (input) => <FigureRender {...input} />,
  edit: (input) => <FigureEditor {...input} />
};

export const causeEffectPlugin: KitNoteTypePlugin = {
  label: "因果链",
  title: "因果链",
  aliases: ["因果", "cause-effect", "因果链"],
  icon: "waypoints",
  hidden: false,
  // The cause → event → effect layout is a rich full view (§1.10).
  focusable: true,
  render: (input) => <CauseEffectRender {...input} />,
  edit: (input) => <CauseEffectEditor {...input} />
};

export const experimentPlugin: KitNoteTypePlugin = {
  label: "实验记录",
  title: "实验记录",
  aliases: ["实验", "experiment"],
  icon: "flask-conical",
  hidden: false,
  // The sectioned experiment sheet is a rich full view (§1.11).
  focusable: true,
  render: (input) => <ExperimentRender {...input} />,
  edit: (input) => <ExperimentEditor {...input} />
};
