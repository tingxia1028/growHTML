// Review view (REV-1 + REV-2, review-loop.md §2/§4) — the 复习 surface that CLOSES the
// learning loop: 读→锚→记→问→复→memory→AI 适配. It is deliberately just COMPOSITION of
// existing organs:
//   queue     — the pure policy in ./queue over notes + note.review memory events +
//               [REV-2] MEM-2 digest summaries (weak buckets weight/extend the queue)
//   render    — EVERY piece of note/draft/verdict content displays through the ONE
//               getNoteType(contentType).render contract (mode "card" = the question
//               presentation, mode "full" = the revealed answer) — no bespoke path
//   operations— review.generate-check / review.grade-answer / review.explain, kit-prompt
//               records dispatched through the EXISTING /api/kits/generate binding;
//               [REV-2] explain carries a compact profileContext (the first MEM-3
//               consumer) — the SAME button explains differently per student. The
//               managed-provider privacy gate lives SERVER-SIDE in the generate path
//               (services/ai.ts), where the provider kind is authoritatively known.
//   memory    — every completed item emits ONE note.review event via the MEM-1 capture
//               queue (subject carries noteId/sourceId/contentType so digests can
//               bucket per type); the session tally is component-local (the durable
//               record IS the event stream, consolidated by MEM-2)
//   saving    — 存为练习/存为错题 go through the EXISTING anchor.add-note dispatch
//   弱项 header — [REV-2] top weak buckets as chips (digest summaries, minus facts the
//               user HID on the 画像页); a chip click filters the queue to its bucket
//               (component-local — the session queue itself stays frozen).
// Registered exactly like plugin.manager: registerView + a preset node + an IconRail
// entry (WorkspaceShell side-effect-imports this module).

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpenCheck } from "lucide-react";
import { registerView, type WorkspaceContext } from "../workspace/viewRegistry";
import { getNoteType, type NoteRenderMode } from "../notes/noteTypeRegistry";
import { getNoteContentSpec, MISTAKE_CONTENT_TYPE, mistakeSpec } from "../../core/notes/contentTypes";
import type { MemoryDimensionSummary } from "../../core/memory/digest";
import type { NoteRecord, ProfileFactView } from "../data/entityClient";
import { recordMemoryEvent } from "../memory/capture";
import { REVIEW_GRADE_CONTENT_TYPE, type ReviewGradeContent } from "../../core/review/contentTypes";
import { explainPrompt, generateCheckPrompt, gradeAnswerPrompt } from "../../core/review/prompts";
import {
  buildReviewQueue,
  noteMatchesWeakBucket,
  weakReviewBuckets,
  type ReviewQueueItem,
  type ReviewWeakBucket
} from "./queue";
import { buildProfileContext } from "./profileContext";
import { getReviewIo } from "./reviewIo";

type ReviewScope = "source" | "vault";
type ReviewResult = "pass" | "fail" | "skip";
/** How the outcome was produced: self-graded reveal vs the AI check/grade flow. */
type ReviewMode = "self" | "ai-check";

const REASON_LABEL: Record<string, string> = {
  "mistake-new": "新错题",
  "mistake-failed": "上次答错",
  due: "待复习"
};
// REV-2 弱项 reasons are dynamic ("弱项:{bucket}") — they display verbatim via the
// `?? current.reason` fallback below.

/** How many 弱项 chips the header shows (top by fail ratio). */
const WEAK_CHIP_LIMIT = 3;

// The draft check-question shape (the built-in quiz content). The server already
// validated it against the quiz spec; this is defensive coercion for rendering/grading.
type QuizShape = { question: string; options: string[]; answerIndex: number; explanation?: string };
function asQuizShape(content: unknown): QuizShape {
  const c = (content ?? {}) as Partial<QuizShape>;
  return {
    question: typeof c.question === "string" ? c.question : "",
    options: Array.isArray(c.options) ? c.options.map((o) => String(o ?? "")) : [],
    answerIndex: typeof c.answerIndex === "number" && c.answerIndex >= 0 ? c.answerIndex : 0,
    explanation: typeof c.explanation === "string" ? c.explanation : undefined
  };
}
function asGradeShape(content: unknown): ReviewGradeContent {
  const c = (content ?? {}) as Partial<ReviewGradeContent>;
  return { correct: c.correct === true, explanation: typeof c.explanation === "string" ? c.explanation : "" };
}

// The expected answer for grading — REV-CORE: prefer the check type's REGISTRY
// capability (spec.review.expectedAnswer, declared by gradable types) over poking the
// content shape; the quiz-shape read stays as the defensive fallback.
function expectedAnswerFor(quiz: QuizShape): string {
  const viaSpec = getNoteContentSpec(generateCheckPrompt.outputType)?.review?.expectedAnswer?.(quiz);
  return viaSpec ?? quiz.options[quiz.answerIndex] ?? "";
}

/** A note's content flattened to prompt text — the core spec's own reducer. */
function noteText(note: NoteRecord): string {
  try {
    return getNoteContentSpec(note.contentType)?.toSearchText(note.content) ?? "";
  } catch {
    return "";
  }
}

// EVERY display goes through the registry contract; unknown types degrade to an
// inert text block (they can't be review material, but must never crash the runner).
function RenderContent({ contentType, content, note, mode }: { contentType: string; content: unknown; note?: NoteRecord; mode: NoteRenderMode }) {
  const plugin = getNoteType(contentType);
  if (!plugin) return <div className="review-inert">{typeof content === "string" ? content : JSON.stringify(content)}</div>;
  return <>{plugin.render({ content, note, mode })}</>;
}

// Per-item runner state, reset on every advance.
type CheckFlow = {
  quiz: QuizShape | null;
  userAnswer: string;
  grade: ReviewGradeContent | null;
  savedPractice: boolean;
  savedMistake: boolean;
};
const EMPTY_CHECK: CheckFlow = { quiz: null, userAnswer: "", grade: null, savedPractice: false, savedMistake: false };

export function ReviewPanel({ ctx }: { ctx: WorkspaceContext }) {
  // Always read the LATEST workspace data at load time without re-building the
  // session whenever ctx re-renders (e.g. 存为错题 refreshes ctx.notes mid-run).
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const [scope, setScope] = useState<ReviewScope>(() => (ctx.activeSourceId ? "source" : "vault"));
  const [queue, setQueue] = useState<ReviewQueueItem<NoteRecord>[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [index, setIndex] = useState(0);
  const [tally, setTally] = useState({ pass: 0, fail: 0, skip: 0 });
  // REV-2 session data: digest summaries feed the queue weights + 弱项 chips;
  // profile facts feed the explain profileContext (hidden facts honored in both).
  const [digestSummaries, setDigestSummaries] = useState<MemoryDimensionSummary[]>([]);
  const [profileFacts, setProfileFacts] = useState<ProfileFactView[]>([]);
  const [weakFilter, setWeakFilter] = useState<ReviewWeakBucket | null>(null);

  // Current-item state.
  const [revealed, setRevealed] = useState(false);
  const [outcome, setOutcome] = useState<{ result: ReviewResult; mode: ReviewMode } | null>(null);
  const [check, setCheck] = useState<CheckFlow>(EMPTY_CHECK);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiError, setAiError] = useState("");

  const resetItemState = () => {
    setRevealed(false);
    setOutcome(null);
    setCheck(EMPTY_CHECK);
    setExplanation(null);
    setAiError("");
  };

  // Build a review SESSION: fetch events (+ all notes for 全库), run the pure queue
  // policy ONCE, then advance an index over the frozen order. Only mount / scope
  // switch / 再复习一轮 rebuild it — never a background notes refresh.
  const load = useCallback(async (nextScope: ReviewScope) => {
    setQueue(null);
    setLoadError("");
    try {
      const io = getReviewIo();
      const workspace = ctxRef.current;
      const [reviewEvents, notes, summaries, facts] = await Promise.all([
        io.fetchEvents(),
        nextScope === "vault" ? io.fetchAllNotes() : Promise.resolve(workspace.notes),
        io.fetchDigestSummaries(),
        io.fetchProfileFacts()
      ]);
      setDigestSummaries(summaries);
      setProfileFacts(facts);
      setQueue(buildReviewQueue({ notes, reviewEvents, digestSummaries: summaries }));
    } catch (error) {
      setQueue([]);
      setLoadError(error instanceof Error ? error.message : "加载复习队列失败");
    }
    setIndex(0);
    setTally({ pass: 0, fail: 0, skip: 0 });
    setWeakFilter(null);
    resetItemState();
  }, []);

  useEffect(() => {
    void load(scope);
  }, [scope, load]);

  // —— REV-2 弱项 header: top weak buckets (digest summaries), minus the ones whose
  // profile fact the user HID on the 画像页 (hide is honored end-to-end). Chips show
  // HUMAN buckets only (subject/contentType) — the profile tier's own readability rule;
  // sourceId weak buckets still weight the queue silently.
  const hiddenFactKeys = new Set(profileFacts.filter((fact) => fact.hidden).map((fact) => fact.key));
  const weakChips = weakReviewBuckets(digestSummaries)
    .filter((bucket) => bucket.dimension !== "sourceId")
    .filter((bucket) => !hiddenFactKeys.has(`weak:${bucket.dimension}:${bucket.bucket}`))
    .slice(0, WEAK_CHIP_LIMIT);

  // A chip click narrows the SESSION VIEW to that bucket (component-local filter —
  // the frozen queue order is untouched; clicking the active chip clears it).
  const toggleWeakFilter = (bucket: ReviewWeakBucket) => {
    setWeakFilter((active) =>
      active && active.dimension === bucket.dimension && active.bucket === bucket.bucket ? null : bucket
    );
    setIndex(0);
    resetItemState();
  };

  const allItems = queue ?? [];
  const items = weakFilter ? allItems.filter((item) => noteMatchesWeakBucket(item.note, weakFilter)) : allItems;
  const current = index < items.length ? items[index] : null;
  const remaining = items.length - index;
  // REV-CORE: the AI-check flow keys on the registry's `mistake` CAPABILITY
  // (alias-aware — old textbook.mistake records qualify), not a contentType string.
  const isMistakeItem = getNoteContentSpec(current?.note.contentType ?? "")?.mistake === true;
  const itemMode: ReviewMode = isMistakeItem ? "ai-check" : "self";

  // ONE memory event per completed item — the loop's durable output (MEM-1 verb
  // `note.review`; payload result/mode per review-loop.md §2). The subject carries
  // contentType so MEM-2 digests can bucket pass/fail per type — the fuel of the
  // very 弱项 signal this panel consumes.
  const complete = (result: ReviewResult, mode: ReviewMode) => {
    if (!current || outcome) return;
    recordMemoryEvent(
      "note.review",
      { noteId: current.note.id, sourceId: current.note.sourceId, contentType: current.note.contentType },
      { result, mode }
    );
    setTally((t) => ({ ...t, [result]: t[result] + 1 }));
    setOutcome({ result, mode });
  };

  const advance = () => {
    setIndex((i) => i + 1);
    resetItemState();
  };

  const skip = () => {
    complete("skip", itemMode);
    // complete() no-ops when the item already has an outcome; only advance the
    // tally-consistent path (skip is offered only before an outcome exists).
    setIndex((i) => i + 1);
    resetItemState();
  };

  // —— the three operations (kit prompts through the existing generate path) ——————
  const generateCheck = async () => {
    if (!current || busy) return;
    setBusy(true);
    setAiError("");
    try {
      const { content } = await getReviewIo().generate({
        promptId: generateCheckPrompt.id,
        contentType: generateCheckPrompt.outputType,
        input: { noteText: noteText(current.note), contentType: current.note.contentType }
      });
      setCheck((c) => ({ ...c, quiz: asQuizShape(content) }));
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "生成检验题失败");
    } finally {
      setBusy(false);
    }
  };

  const submitAnswer = async () => {
    const quiz = check.quiz;
    const userAnswer = check.userAnswer.trim();
    if (!current || !quiz || !userAnswer || busy) return;
    setBusy(true);
    setAiError("");
    try {
      const expected = expectedAnswerFor(quiz);
      const { content } = await getReviewIo().generate({
        promptId: gradeAnswerPrompt.id,
        contentType: gradeAnswerPrompt.outputType,
        input: { question: quiz.question, expected, userAnswer }
      });
      const grade = asGradeShape(content);
      setCheck((c) => ({ ...c, grade }));
      complete(grade.correct ? "pass" : "fail", "ai-check");
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "判分失败");
    } finally {
      setBusy(false);
    }
  };

  const explain = async (question: string, expected: string | undefined, userAnswer: string) => {
    if (busy) return;
    setBusy(true);
    setAiError("");
    try {
      // REV-2: weave the compact 学生画像 into THIS one operation (the first MEM-3
      // consumer). No facts → the key is omitted entirely, so the built prompt stays
      // byte-identical to REV-1. The managed-provider hard-off gate is server-side in
      // the generate path (services/ai.ts), where the provider kind is known.
      const profileContext = buildProfileContext(profileFacts);
      const { content } = await getReviewIo().generate({
        promptId: explainPrompt.id,
        contentType: explainPrompt.outputType,
        input: { question, expected, userAnswer, ...(profileContext ? { profileContext } : {}) }
      });
      setExplanation(typeof content === "string" ? content : JSON.stringify(content));
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "生成讲解失败");
    } finally {
      setBusy(false);
    }
  };

  // —— optional persistence (the EXISTING note-create dispatch; drafts/grades are
  // otherwise never saved) ————————————————————————————————————————————————
  const itemAnchorIds = (note: NoteRecord): string[] =>
    note.sourceId && note.sourceId === ctx.activeSourceId ? note.anchorIds : [];

  const savePractice = () => {
    if (!current || !check.quiz || check.savedPractice) return;
    void ctx.dispatch("anchor.add-note", {
      contentType: generateCheckPrompt.outputType,
      content: check.quiz,
      anchorIds: itemAnchorIds(current.note)
    });
    setCheck((c) => ({ ...c, savedPractice: true }));
  };

  const saveMistake = () => {
    const quiz = check.quiz;
    const grade = check.grade;
    if (!current || !quiz || !grade || check.savedMistake) return;
    // Validate against the CORE mistake spec before dispatch (the composer idiom).
    // REV-CORE: NEW 错题 saves write the core `"mistake"` contentType (old
    // `textbook.mistake` records keep working through the registry alias).
    const content = mistakeSpec.schema.parse({
      question: quiz.question,
      wrongAnswer: check.userAnswer.trim(),
      correctAnswer: expectedAnswerFor(quiz),
      mistakeReason: grade.explanation,
      retryCount: 0,
      mastery: "weak"
    });
    void ctx.dispatch("anchor.add-note", {
      contentType: MISTAKE_CONTENT_TYPE,
      content,
      anchorIds: itemAnchorIds(current.note)
    });
    setCheck((c) => ({ ...c, savedMistake: true }));
  };

  // —— presentation ————————————————————————————————————————————————————————
  const typeTitle = (contentType: string): string => {
    const plugin = getNoteType(contentType);
    return plugin?.title ?? plugin?.label ?? contentType;
  };

  const explainButton = (question: string, expected: string | undefined, userAnswer: string) =>
    explanation === null ? (
      <button type="button" className="review-btn review-explain-btn" disabled={busy} onClick={() => void explain(question, expected, userAnswer)}>
        详细讲解
      </button>
    ) : null;

  const explanationBlock =
    explanation !== null ? (
      <div className="review-explanation">
        <RenderContent contentType={explainPrompt.outputType} content={explanation} mode="full" />
      </div>
    ) : null;

  const outcomeChip = outcome ? (
    <span className={`review-outcome review-outcome-${outcome.result}`}>
      {outcome.result === "pass" ? "已记为:对" : outcome.result === "fail" ? "已记为:错" : "已跳过"}
    </span>
  ) : null;

  // A reviewable (quiz/flashcard/review-pack) item: card render (the question face) →
  // 显示答案 reveals the full render → self-grade 我对了/我错了.
  const selfGradeItem = (item: ReviewQueueItem<NoteRecord>) => (
    <>
      <div className="review-item-content">
        <RenderContent
          contentType={item.note.contentType}
          content={item.note.content}
          note={item.note}
          mode={revealed ? "full" : "card"}
        />
      </div>
      {!revealed ? (
        <div className="review-actions">
          <button type="button" className="review-btn review-primary review-reveal-btn" onClick={() => setRevealed(true)}>
            显示答案
          </button>
          <button type="button" className="review-btn review-skip-btn" onClick={skip}>
            跳过
          </button>
        </div>
      ) : !outcome ? (
        <div className="review-actions">
          <button type="button" className="review-btn review-pass-btn" onClick={() => complete("pass", "self")}>
            我对了
          </button>
          <button type="button" className="review-btn review-fail-btn" onClick={() => complete("fail", "self")}>
            我错了
          </button>
        </div>
      ) : (
        <div className="review-actions review-done">
          {outcomeChip}
          {outcome.result === "fail" ? explainButton(noteText(item.note), undefined, "自评:没答对") : null}
          <button type="button" className="review-btn review-primary review-next-btn" onClick={advance}>
            下一项
          </button>
        </div>
      )}
      {explanationBlock}
    </>
  );

  // A mistake item: the saved mistake (full render) → AI 出一道检验题 → answer →
  // review.grade-answer → verdict + reveal + optional 存为练习 / 存为错题 / 讲解.
  const mistakeItem = (item: ReviewQueueItem<NoteRecord>) => {
    const quiz = check.quiz;
    const grade = check.grade;
    const expected = quiz ? expectedAnswerFor(quiz) : "";
    return (
      <>
        <div className="review-item-content">
          <RenderContent contentType={item.note.contentType} content={item.note.content} note={item.note} mode="full" />
        </div>
        {!quiz ? (
          <div className="review-actions">
            <button type="button" className="review-btn review-primary review-ai-check-btn" disabled={busy} onClick={() => void generateCheck()}>
              {busy ? "生成中…" : "AI 出一道检验题"}
            </button>
            <button type="button" className="review-btn review-skip-btn" onClick={skip}>
              跳过
            </button>
          </div>
        ) : !grade ? (
          <div className="review-check">
            <div className="review-check-question">
              <RenderContent contentType={generateCheckPrompt.outputType} content={quiz} mode="card" />
            </div>
            <input
              className="review-answer-input"
              placeholder="你的答案…"
              value={check.userAnswer}
              onChange={(e) => setCheck((c) => ({ ...c, userAnswer: e.target.value }))}
            />
            <div className="review-actions">
              <button
                type="button"
                className="review-btn review-primary review-submit-answer-btn"
                disabled={busy || !check.userAnswer.trim()}
                onClick={() => void submitAnswer()}
              >
                {busy ? "判分中…" : "提交回答"}
              </button>
              <button type="button" className="review-btn review-skip-btn" onClick={skip}>
                跳过
              </button>
            </div>
          </div>
        ) : (
          <div className="review-check review-check-graded">
            <RenderContent contentType={REVIEW_GRADE_CONTENT_TYPE} content={grade} mode="full" />
            <div className="review-check-revealed">
              <RenderContent contentType={generateCheckPrompt.outputType} content={quiz} mode="full" />
            </div>
            <div className="review-actions review-done">
              {outcomeChip}
              {!grade.correct ? explainButton(quiz.question, expected, check.userAnswer.trim()) : null}
              <button type="button" className="review-btn review-save-practice-btn" disabled={check.savedPractice} onClick={savePractice}>
                {check.savedPractice ? "已存为练习" : "存为练习"}
              </button>
              {!grade.correct ? (
                <button type="button" className="review-btn review-save-mistake-btn" disabled={check.savedMistake} onClick={saveMistake}>
                  {check.savedMistake ? "已存为错题" : "存为错题"}
                </button>
              ) : null}
              <button type="button" className="review-btn review-primary review-next-btn" onClick={advance}>
                下一项
              </button>
            </div>
            {explanationBlock}
          </div>
        )}
      </>
    );
  };

  return (
    <aside className="review-panel">
      <div className="panel-title">
        <BookOpenCheck size={16} />
        复习
      </div>

      <div className="review-toolbar">
        <div className="review-scope" role="group" aria-label="复习范围">
          <button
            type="button"
            className={`review-scope-btn${scope === "source" ? " active" : ""}`}
            disabled={!ctx.activeSourceId}
            aria-pressed={scope === "source"}
            onClick={() => setScope("source")}
          >
            当前文档
          </button>
          <button
            type="button"
            className={`review-scope-btn${scope === "vault" ? " active" : ""}`}
            aria-pressed={scope === "vault"}
            onClick={() => setScope("vault")}
          >
            全库
          </button>
        </div>
        <span className="review-count">{queue === null ? "加载中…" : `${remaining} 项待复习`}</span>
      </div>

      {weakChips.length > 0 ? (
        <div className="review-weak-header" role="group" aria-label="弱项">
          <span className="review-weak-label">弱项:</span>
          {weakChips.map((bucket) => {
            const active =
              weakFilter !== null && weakFilter.dimension === bucket.dimension && weakFilter.bucket === bucket.bucket;
            return (
              <button
                key={`${bucket.dimension}:${bucket.bucket}`}
                type="button"
                className={`review-weak-chip${active ? " active" : ""}`}
                aria-pressed={active}
                data-dimension={bucket.dimension}
                data-bucket={bucket.bucket}
                title={`复习错误率 ${Math.round(bucket.failRatio * 100)}%(${bucket.attempts} 次作答)— 点击筛选`}
                onClick={() => toggleWeakFilter(bucket)}
              >
                {bucket.dimension === "contentType" ? typeTitle(bucket.bucket) : bucket.bucket}
              </button>
            );
          })}
        </div>
      ) : null}

      {loadError ? <div className="review-error">{loadError}</div> : null}
      {aiError ? <div className="review-error review-ai-error">{aiError}</div> : null}

      {queue === null ? null : items.length === 0 ? (
        <div className="empty-state review-empty">
          {weakFilter
            ? "该弱项下暂无可复习条目——再点一次弱项标签可清除筛选。"
            : "暂无待复习内容。错题、小测、闪卡和复习包会自动进入队列。"}
        </div>
      ) : current ? (
        <section className="review-item" data-note-id={current.note.id} data-reason={current.reason}>
          <header className="review-item-head">
            <span className="review-progress">
              第 {index + 1} / {items.length} 项
            </span>
            <span className="review-reason" data-reason={current.reason}>
              {REASON_LABEL[current.reason] ?? current.reason}
            </span>
            <span className="review-type">{typeTitle(current.note.contentType)}</span>
          </header>
          {isMistakeItem ? mistakeItem(current) : selfGradeItem(current)}
        </section>
      ) : (
        <section className="review-summary">
          <p className="review-summary-line">
            本轮完成:{tally.pass} 对 / {tally.fail} 错{tally.skip ? `(跳过 ${tally.skip})` : ""}
          </p>
          <button type="button" className="review-btn review-primary review-restart-btn" onClick={() => void load(scope)}>
            再复习一轮
          </button>
        </section>
      )}
    </aside>
  );
}

registerView({ kind: "review.panel", render: (_node, ctx) => <ReviewPanel ctx={ctx} /> });
