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
import { ArtifactCard } from "../workspace/ArtifactCard";
import { getNoteType, type NoteRenderCtx, type NoteRenderMode } from "../notes/noteTypeRegistry";
import { defineMessages, resolveText, t, useLocale, type Locale } from "../i18n";
import { getNoteContentSpec, MISTAKE_CONTENT_TYPE, mistakeSpec } from "../../core/notes/contentTypes";
import type { MemoryDimensionSummary } from "../../core/memory/digest";
import type { NoteRecord, ProfileFactView } from "../data/entityClient";
import { recordMemoryEvent } from "../memory/capture";
import { REVIEW_GRADE_CONTENT_TYPE, type ReviewGradeContent } from "../../core/review/contentTypes";
import { applyReviewOutcome, type ReviewScheduleState } from "../../core/review/schedule";
import { explainPrompt, generateCheckPrompt, gradeAnswerPrompt } from "../../core/review/prompts";
import {
  buildReviewQueue,
  noteMatchesWeakBucket,
  REVIEW_SESSION_CAP,
  reviewDueStats,
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

const reviewMessages = defineMessages({
  newMistake: { zh: "新错题", en: "New Mistake" },
  failedLastTime: { zh: "上次答错", en: "Failed Last Time" },
  due: { zh: "待复习", en: "Due" },
  loadQueueFailed: { zh: "加载复习队列失败", en: "Failed to load review queue" },
  generateCheckFailed: { zh: "生成检验题失败", en: "Failed to generate check question" },
  gradeFailed: { zh: "判分失败", en: "Failed to grade answer" },
  explainFailed: { zh: "生成讲解失败", en: "Failed to generate explanation" },
  detailedExplanation: { zh: "详细讲解", en: "Explain" },
  outcomePass: { zh: "已记为:对", en: "Marked: correct" },
  outcomeFail: { zh: "已记为:错", en: "Marked: missed" },
  outcomeSkip: { zh: "已跳过", en: "Skipped" },
  showAnswer: { zh: "显示答案", en: "Show Answer" },
  skip: { zh: "跳过", en: "Skip" },
  correct: { zh: "我对了", en: "I Got It" },
  missed: { zh: "我错了", en: "I Missed It" },
  next: { zh: "下一项", en: "Next" },
  generating: { zh: "生成中…", en: "Generating…" },
  aiCheck: { zh: "AI 出一道检验题", en: "AI Check Question" },
  answerPlaceholder: { zh: "你的答案…", en: "Your answer…" },
  grading: { zh: "判分中…", en: "Grading…" },
  submitAnswer: { zh: "提交回答", en: "Submit Answer" },
  savedPractice: { zh: "已存为练习", en: "Saved as Practice" },
  savePractice: { zh: "存为练习", en: "Save as Practice" },
  savedMistake: { zh: "已存为错题", en: "Saved as Mistake" },
  saveMistake: { zh: "存为错题", en: "Save as Mistake" },
  panelTitle: { zh: "复习", en: "Review" },
  scopeLabel: { zh: "复习范围", en: "Review Scope" },
  currentDocument: { zh: "当前文档", en: "Current Document" },
  vault: { zh: "全库", en: "Vault" },
  loading: { zh: "加载中…", en: "Loading…" },
  weakSpots: { zh: "弱项:", en: "Weak Spots:" },
  weakGroup: { zh: "弱项", en: "Weak Spots" },
  emptyWeak: {
    zh: "该弱项下暂无可复习条目——再点一次弱项标签可清除筛选。",
    en: "No review items in this weak spot. Click the chip again to clear the filter."
  },
  emptyQueue: {
    zh: "暂无待复习内容。错题、小测、闪卡和复习包会自动进入队列。",
    en: "No review items yet. Mistakes, quizzes, flashcards, and review packs enter this queue automatically."
  },
  progressItem: { zh: "第", en: "Item" },
  progressSuffix: { zh: "项", en: "" },
  roundComplete: { zh: "本轮完成:", en: "Round complete:" },
  right: { zh: "对", en: "correct" },
  wrong: { zh: "错", en: "missed" },
  skipped: { zh: "跳过", en: "skipped" },
  restart: { zh: "再复习一轮", en: "Review Again" },
  selfMissed: { zh: "自评:没答对", en: "Self grade: missed" },
  // REV-3 SRS surfaces
  reviewAhead: { zh: "提前复习", en: "Review Ahead" },
  aheadBadge: { zh: "提前复习中", en: "reviewing ahead" },
  nextDueNow: { zh: "下次复习:现在", en: "Next review: now" },
  nextDueTomorrow: { zh: "下次复习:明天", en: "Next review: tomorrow" }
});

const REASON_LABEL: Record<string, keyof typeof reviewMessages> = {
  "mistake-new": "newMistake",
  "mistake-failed": "failedLastTime",
  due: "due"
};
// REV-2 弱项 reasons are dynamic ("弱项:{bucket}") — they display verbatim via the
// `?? current.reason` fallback below.

/** How many 弱项 chips the header shows (top by fail ratio). */
const WEAK_CHIP_LIMIT = 3;

function pendingLabel(count: number, locale: Locale): string {
  if (locale === "en") return `${count} ${count === 1 ? "item" : "items"} to review`;
  return `${count} 项待复习`;
}

// —— REV-3 label helpers (pure; bilingual by construction) ————————————————————
function scheduledLabel(count: number, locale: Locale): string {
  if (locale === "en") return `${count} scheduled`;
  return `${count} 项已排期`;
}

/** After grading: when the item comes back (0 = now — a fail returns next session). */
function nextDueChipLabel(days: number, locale: Locale): string {
  if (days <= 0) return t(reviewMessages.nextDueNow);
  if (days === 1) return t(reviewMessages.nextDueTomorrow);
  if (locale === "en") return `Next review: in ${days} days`;
  return `下次复习:${days} 天后`;
}

/** The all-scheduled empty state: everything earned its interval. */
function scheduledEmptyLabel(upcoming: number, nextDueAt: string | undefined, locale: Locale): string {
  const day = nextDueAt ? nextDueAt.slice(0, 10) : "";
  if (locale === "en") {
    return `All caught up — ${upcoming} ${upcoming === 1 ? "item is" : "items are"} scheduled ahead${day ? ` (next due ${day})` : ""}.`;
  }
  return `全部完成——${upcoming} 项已排期${day ? `,最近 ${day} 到期` : ""}。`;
}

function progressLabel(index: number, total: number, locale: Locale): string {
  if (locale === "en") return `Item ${index} / ${total}`;
  return `第 ${index} / ${total} 项`;
}

function reasonLabel(reason: string): string {
  if (reason.startsWith("弱项:")) return `${t(reviewMessages.weakGroup)}:${reason.slice("弱项:".length)}`;
  const key = REASON_LABEL[reason];
  return key ? t(reviewMessages[key]) : reason;
}

function weakTitle(bucket: ReviewWeakBucket, locale: Locale): string {
  const ratio = Math.round(bucket.failRatio * 100);
  if (locale === "en") return `Review fail rate ${ratio}% (${bucket.attempts} attempts) - click to filter`;
  return `复习错误率 ${ratio}%(${bucket.attempts} 次作答)— 点击筛选`;
}

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
// `initialFace` is threaded through the render contract's ctx seam: the reveal surface
// passes "back" so an interactive flip-card (flashcard/vocab full) opens straight on its
// ANSWER face — 显示答案 lands on the answer, no second manual flip (N4-D7 wrinkle).
function RenderContent({
  contentType,
  content,
  note,
  mode,
  initialFace
}: {
  contentType: string;
  content: unknown;
  note?: NoteRecord;
  mode: NoteRenderMode;
  initialFace?: NoteRenderCtx["initialFace"];
}) {
  const plugin = getNoteType(contentType);
  if (!plugin) return <div className="review-inert">{typeof content === "string" ? content : JSON.stringify(content)}</div>;
  return <>{plugin.render({ content, note, mode, ...(initialFace ? { ctx: { initialFace } } : {}) })}</>;
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
  const locale = useLocale();
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
  // REV-3 session data: the per-note SRS document (grading advances the local copy
  // so due/upcoming counts stay live), the frozen session clock and note set the
  // stats derive from, and the 提前复习 flag (ahead = the schedule-free legacy queue).
  const [schedule, setSchedule] = useState<ReviewScheduleState>({});
  const [ahead, setAhead] = useState(false);
  const sessionNowRef = useRef(new Date().toISOString());
  const sessionNotesRef = useRef<NoteRecord[]>([]);

  // Current-item state.
  const [revealed, setRevealed] = useState(false);
  const [outcome, setOutcome] = useState<{ result: ReviewResult; mode: ReviewMode; nextDueDays?: number } | null>(
    null
  );
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

  // Build a review SESSION: fetch events (+ all notes for 全库) + the SRS document,
  // run the pure queue policy ONCE (schedule + a frozen session clock arm SRS mode;
  // 提前复习 omits them = the legacy all-due queue), then advance an index over the
  // frozen order. Only mount / scope switch / 再复习一轮 / 提前复习 rebuild it —
  // never a background notes refresh.
  const load = useCallback(async (nextScope: ReviewScope, opts?: { ahead?: boolean }) => {
    const reviewAhead = opts?.ahead === true;
    setQueue(null);
    setLoadError("");
    try {
      const io = getReviewIo();
      const workspace = ctxRef.current;
      const [reviewEvents, notes, summaries, facts, scheduleState] = await Promise.all([
        io.fetchEvents(),
        nextScope === "vault" ? io.fetchAllNotes() : Promise.resolve(workspace.notes),
        io.fetchDigestSummaries(),
        io.fetchProfileFacts(),
        io.fetchSchedule()
      ]);
      const nowIso = new Date().toISOString();
      sessionNowRef.current = nowIso;
      sessionNotesRef.current = notes;
      setDigestSummaries(summaries);
      setProfileFacts(facts);
      setSchedule(scheduleState);
      setQueue(
        buildReviewQueue({
          notes,
          reviewEvents,
          digestSummaries: summaries,
          ...(reviewAhead ? {} : { schedule: scheduleState, now: nowIso, cap: REVIEW_SESSION_CAP })
        })
      );
    } catch (error) {
      setQueue([]);
      setLoadError(error instanceof Error ? error.message : t(reviewMessages.loadQueueFailed));
    }
    setAhead(reviewAhead);
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
  // REV-3 stats: dueness over the session's note set + the LIVE schedule copy
  // (grading advances it), against the frozen session clock — pure, per render.
  const dueStats = reviewDueStats(sessionNotesRef.current, schedule, sessionNowRef.current);
  // REV-CORE: the AI-check flow keys on the registry's `mistake` CAPABILITY
  // (alias-aware — old textbook.mistake records qualify), not a contentType string.
  const isMistakeItem = getNoteContentSpec(current?.note.contentType ?? "")?.mistake === true;
  const itemMode: ReviewMode = isMistakeItem ? "ai-check" : "self";

  // ONE memory event per completed item — the loop's durable output (MEM-1 verb
  // `note.review`; payload result/mode per review-loop.md §2). The subject carries
  // contentType so MEM-2 digests can bucket pass/fail per type — the fuel of the
  // very 弱项 signal this panel consumes.
  // REV-3: a GRADE (pass/fail — never skip) also advances the item's SRS row: the
  // pure engine computes the next row locally (instant 下次复习 chip + live counts)
  // and the SAME outcome is POSTed through the io seam (fire-and-forget — the
  // server recomputes with the identical pure function; a lost write only means
  // the item stays due and returns next session).
  const complete = (result: ReviewResult, mode: ReviewMode) => {
    if (!current || outcome) return;
    recordMemoryEvent(
      "note.review",
      { noteId: current.note.id, sourceId: current.note.sourceId, contentType: current.note.contentType },
      { result, mode }
    );
    let nextDueDays: number | undefined;
    if (result !== "skip") {
      const nextRow = applyReviewOutcome(schedule[current.note.id], result, new Date().toISOString());
      if (nextRow) {
        nextDueDays = nextRow.intervalDays;
        setSchedule((rows) => ({ ...rows, [current.note.id]: nextRow }));
      }
      void getReviewIo()
        .recordGrade({ noteId: current.note.id, result })
        .catch(() => null); // the io seam already degrades; belt over suspenders
    }
    setTally((t) => ({ ...t, [result]: t[result] + 1 }));
    setOutcome({ result, mode, nextDueDays });
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
      setAiError(error instanceof Error ? error.message : t(reviewMessages.generateCheckFailed));
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
      setAiError(error instanceof Error ? error.message : t(reviewMessages.gradeFailed));
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
      setAiError(error instanceof Error ? error.message : t(reviewMessages.explainFailed));
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
    return plugin?.title ? resolveText(plugin.title) : plugin?.label ? resolveText(plugin.label) : contentType;
  };

  const explainButton = (question: string, expected: string | undefined, userAnswer: string) =>
    explanation === null ? (
      <button type="button" className="review-btn review-explain-btn" disabled={busy} onClick={() => void explain(question, expected, userAnswer)}>
        {t(reviewMessages.detailedExplanation)}
      </button>
    ) : null;

  const explanationBlock =
    explanation !== null ? (
      <div className="review-explanation">
        <RenderContent contentType={explainPrompt.outputType} content={explanation} mode="full" />
      </div>
    ) : null;

  const outcomeChip = outcome ? (
    <>
      <span className={`review-outcome review-outcome-${outcome.result}`}>
        {outcome.result === "pass"
          ? t(reviewMessages.outcomePass)
          : outcome.result === "fail"
            ? t(reviewMessages.outcomeFail)
            : t(reviewMessages.outcomeSkip)}
      </span>
      {outcome.nextDueDays !== undefined ? (
        // REV-3: the per-card next-due readout right after grading.
        <span className="review-next-due" data-days={outcome.nextDueDays}>
          {nextDueChipLabel(outcome.nextDueDays, locale)}
        </span>
      ) : null}
    </>
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
          // 显示答案 lands on the ANSWER face directly (no second manual flip): the
          // full render is the answer, so an interactive flip-card opens flipped.
          initialFace={revealed ? "back" : undefined}
        />
      </div>
      {!revealed ? (
        <div className="review-actions">
          <button type="button" className="review-btn review-primary review-reveal-btn" onClick={() => setRevealed(true)}>
            {t(reviewMessages.showAnswer)}
          </button>
          <button type="button" className="review-btn review-skip-btn" onClick={skip}>
            {t(reviewMessages.skip)}
          </button>
        </div>
      ) : !outcome ? (
        <div className="review-actions">
          <button type="button" className="review-btn review-pass-btn" onClick={() => complete("pass", "self")}>
            {t(reviewMessages.correct)}
          </button>
          <button type="button" className="review-btn review-fail-btn" onClick={() => complete("fail", "self")}>
            {t(reviewMessages.missed)}
          </button>
        </div>
      ) : (
        <div className="review-actions review-done">
          {outcomeChip}
          {outcome.result === "fail" ? explainButton(noteText(item.note), undefined, t(reviewMessages.selfMissed)) : null}
          <button type="button" className="review-btn review-primary review-next-btn" onClick={advance}>
            {t(reviewMessages.next)}
          </button>
        </div>
      )}
      {explanationBlock}
    </>
  );

  // A mistake item: the saved mistake preview opens in Center View → AI 出一道检验题 → answer →
  // review.grade-answer → verdict + reveal + optional 存为练习 / 存为错题 / 讲解.
  const mistakeItem = (item: ReviewQueueItem<NoteRecord>) => {
    const quiz = check.quiz;
    const grade = check.grade;
    const expected = quiz ? expectedAnswerFor(quiz) : "";
    return (
      <>
        <div className="review-item-content">
          <ArtifactCard
            block={{
              contentType: item.note.contentType,
              content: item.note.content,
              note: item.note
            }}
          />
        </div>
        {!quiz ? (
          <div className="review-actions">
            <button type="button" className="review-btn review-primary review-ai-check-btn" disabled={busy} onClick={() => void generateCheck()}>
              {busy ? t(reviewMessages.generating) : t(reviewMessages.aiCheck)}
            </button>
            <button type="button" className="review-btn review-skip-btn" onClick={skip}>
              {t(reviewMessages.skip)}
            </button>
          </div>
        ) : !grade ? (
          <div className="review-check">
            <div className="review-check-question">
              <RenderContent contentType={generateCheckPrompt.outputType} content={quiz} mode="card" />
            </div>
            <input
              className="review-answer-input"
              placeholder={t(reviewMessages.answerPlaceholder)}
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
                {busy ? t(reviewMessages.grading) : t(reviewMessages.submitAnswer)}
              </button>
              <button type="button" className="review-btn review-skip-btn" onClick={skip}>
                {t(reviewMessages.skip)}
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
                {check.savedPractice ? t(reviewMessages.savedPractice) : t(reviewMessages.savePractice)}
              </button>
              {!grade.correct ? (
                <button type="button" className="review-btn review-save-mistake-btn" disabled={check.savedMistake} onClick={saveMistake}>
                  {check.savedMistake ? t(reviewMessages.savedMistake) : t(reviewMessages.saveMistake)}
                </button>
              ) : null}
              <button type="button" className="review-btn review-primary review-next-btn" onClick={advance}>
                {t(reviewMessages.next)}
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
        {t(reviewMessages.panelTitle)}
      </div>

      <div className="review-toolbar">
        <div className="review-scope" role="group" aria-label={t(reviewMessages.scopeLabel)}>
          <button
            type="button"
            className={`review-scope-btn${scope === "source" ? " active" : ""}`}
            disabled={!ctx.activeSourceId}
            aria-pressed={scope === "source"}
            onClick={() => setScope("source")}
          >
            {t(reviewMessages.currentDocument)}
          </button>
          <button
            type="button"
            className={`review-scope-btn${scope === "vault" ? " active" : ""}`}
            aria-pressed={scope === "vault"}
            onClick={() => setScope("vault")}
          >
            {t(reviewMessages.vault)}
          </button>
        </div>
        <span className="review-count">
          {queue === null ? (
            t(reviewMessages.loading)
          ) : (
            <>
              {pendingLabel(remaining, locale)}
              {ahead ? (
                <span className="review-ahead-badge"> · {t(reviewMessages.aheadBadge)}</span>
              ) : dueStats.upcoming > 0 ? (
                // REV-3: scheduled-ahead count (live — grading moves items over).
                <span className="review-scheduled-count"> · {scheduledLabel(dueStats.upcoming, locale)}</span>
              ) : null}
            </>
          )}
        </span>
      </div>

      {weakChips.length > 0 ? (
        <div className="review-weak-header" role="group" aria-label={t(reviewMessages.weakGroup)}>
          <span className="review-weak-label">{t(reviewMessages.weakSpots)}</span>
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
                title={weakTitle(bucket, locale)}
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
        weakFilter ? (
          <div className="empty-state review-empty">{t(reviewMessages.emptyWeak)}</div>
        ) : !ahead && dueStats.upcoming > 0 ? (
          // REV-3: nothing DUE but items are scheduled ahead — the healthy SRS
          // state. Offer 提前复习 (rebuilds the schedule-free legacy queue).
          <div className="empty-state review-empty review-empty-scheduled">
            <p>{scheduledEmptyLabel(dueStats.upcoming, dueStats.nextDueAt, locale)}</p>
            <button
              type="button"
              className="review-btn review-primary review-ahead-btn"
              onClick={() => void load(scope, { ahead: true })}
            >
              {t(reviewMessages.reviewAhead)}
            </button>
          </div>
        ) : (
          <div className="empty-state review-empty">{t(reviewMessages.emptyQueue)}</div>
        )
      ) : current ? (
        <section className="review-item" data-note-id={current.note.id} data-reason={current.reason}>
          <header className="review-item-head">
            <span className="review-progress">
              {progressLabel(index + 1, items.length, locale)}
            </span>
            <span className="review-reason" data-reason={current.reason}>
              {reasonLabel(current.reason)}
            </span>
            <span className="review-type">{typeTitle(current.note.contentType)}</span>
          </header>
          {isMistakeItem ? mistakeItem(current) : selfGradeItem(current)}
        </section>
      ) : (
        <section className="review-summary">
          <p className="review-summary-line">
            {t(reviewMessages.roundComplete)}
            {tally.pass} {t(reviewMessages.right)} / {tally.fail} {t(reviewMessages.wrong)}
            {tally.skip ? ` (${t(reviewMessages.skipped)} ${tally.skip})` : ""}
          </p>
          <button type="button" className="review-btn review-primary review-restart-btn" onClick={() => void load(scope)}>
            {t(reviewMessages.restart)}
          </button>
        </section>
      )}
    </aside>
  );
}

registerView({ kind: "review.panel", render: (_node, ctx) => <ReviewPanel ctx={ctx} /> });
