// @vitest-environment jsdom
// ReviewPanel (REV-1 + REV-2) — the runner against seeded notes+events through the
// swappable IO seam: queue order rendered, reveal→self-grade emits the RIGHT
// note.review memory event (capture.ts test seams), the AI-check flow with a stubbed
// generate dispatch (check → answer → grade → explain), 存为错题/存为练习 through the
// note-create dispatch, skip semantics, scope toggle, and the end-of-session tally.
// REV-2: 弱项 chips render from digest summaries (human labels, hidden facts
// excluded) and filter the queue; the explain dispatch carries the compact
// profileContext (and omits the key when no facts exist); note.review subjects carry
// contentType so digests can bucket per type.
// REV-3: the SRS surfaces — scheduled-ahead items leave the session and count in
// the header; grading shows the 下次复习 chip and POSTs through the recordGrade
// seam; the all-scheduled empty state offers 提前复习 (the schedule-free queue).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// Stub DiagramNote so the built-in registrations don't pull mermaid/markmap into jsdom.
vi.mock("../../client/DiagramNote", () => ({
  DiagramNote: () => <div className="mock-diagram" />
}));

// Side effects: built-in note types (incl. the core mistake + review.grade types,
// REV-CORE) + Product Kits (textbook) + the view.
import "../../client/notes/builtinNoteTypes";
import "../clientKits";
import "./ReviewPanel";

import { getView, type WorkspaceContext } from "../../client/workspace/viewRegistry";
import { setLocale } from "../../client/i18n";
import type { MemoryDimensionSummary } from "../../core/memory/digest";
import type { MemoryEventInput, NoteRecord, ProfileFactView } from "../../client/data/entityClient";
import {
  flushNow,
  resetMemoryCaptureForTests,
  setMemoryTransportForTests
} from "../../client/memory/capture";
// The review SUPPORT modules stay in core (src/client/review/) — the test drives the
// same seams the panel imports across the boundary.
import { setReviewIoForTests, type GenerateRequest } from "../../client/review/reviewIo";
import { consumePendingReviewScope, setPendingReviewScope } from "../../client/review/reviewScope";
import type { ReviewEventLike } from "../../client/review/queue";
import type { ReviewScheduleRecord } from "../../core/review/schedule";

const SRC = "src_1";

const makeNote = (
  over: Partial<NoteRecord & { createdAt: string }> & { id: string; contentType: string; content: unknown }
): NoteRecord =>
  ({
    sourceId: SRC,
    anchorIds: [],
    conceptIds: [],
    visibility: "private",
    layerIds: [],
    ...over
  }) as NoteRecord;

const mistakeNote = (id: string, over: Partial<NoteRecord & { createdAt: string }> = {}): NoteRecord =>
  makeNote({
    id,
    contentType: "textbook.mistake",
    content: { question: "浮力等于什么?", wrongAnswer: "物体重力", correctAnswer: "排开液体的重力", retryCount: 0, mastery: "weak" },
    ...over
  });

const flashcardNote = (id: string, over: Partial<NoteRecord & { createdAt: string }> = {}): NoteRecord =>
  makeNote({ id, contentType: "flashcard", content: { front: "F正面问题", back: "B背面答案" }, ...over });

const quizNote = (id: string, over: Partial<NoteRecord & { createdAt: string }> = {}): NoteRecord =>
  makeNote({
    id,
    contentType: "quiz",
    content: { question: "Q小测题目", options: ["对的选项", "错的选项"], answerIndex: 0 },
    ...over
  });

const reviewEvent = (noteId: string, createdAt: string, result: string): ReviewEventLike => ({
  verb: "note.review",
  createdAt,
  subject: { noteId },
  payload: { result }
});

// —— REV-2 fixtures: digest summary cells + profile fact views ——————————————
const summaryCell = (
  dimension: MemoryDimensionSummary["dimension"],
  bucket: string,
  fail: number,
  pass: number
): MemoryDimensionSummary => ({
  dimension,
  bucket,
  events: fail + pass,
  counts: { "note.review": fail + pass },
  review: {
    pass,
    fail,
    skip: 0,
    attempts: pass + fail,
    failRatio: pass + fail > 0 ? fail / (pass + fail) : 0
  },
  firstAt: "2026-06-01T00:00:00.000Z",
  lastAt: "2026-06-20T00:00:00.000Z"
});

const factView = (over: Partial<ProfileFactView> & { key: string; kind: ProfileFactView["kind"] }): ProfileFactView => ({
  title: over.key,
  value: "",
  evidence: [],
  pinned: false,
  hidden: false,
  ...over
});

// The stubbed generate dispatch: deterministic content per operation id.
const CHECK_QUIZ = { question: "检验题Q", options: ["正确项", "错误项"], answerIndex: 0, explanation: "因为如此" };
function generateStub(responses?: { gradeCorrect?: boolean }) {
  return vi.fn(async (request: GenerateRequest) => {
    if (request.promptId === "review.generate-check") return { content: CHECK_QUIZ };
    if (request.promptId === "review.grade-answer") {
      return { content: { correct: responses?.gradeCorrect ?? false, explanation: "不对哦" } };
    }
    if (request.promptId === "review.explain") return { content: "**为什么错了** 详解正文" };
    throw new Error(`unexpected promptId ${request.promptId}`);
  });
}

let posted: MemoryEventInput[][];

beforeEach(() => {
  setLocale("zh");
  posted = [];
  consumePendingReviewScope(); // clear any pending review scope leaked from a prior test
  resetMemoryCaptureForTests();
  setMemoryTransportForTests(async (events) => {
    posted.push(events);
  });
});

afterEach(() => {
  setReviewIoForTests(null);
  setMemoryTransportForTests(null);
  resetMemoryCaptureForTests();
});

async function postedEvents(): Promise<MemoryEventInput[]> {
  await flushNow();
  return posted.flat();
}

function ctxWith(over: Partial<Record<keyof WorkspaceContext, unknown>> = {}): WorkspaceContext {
  return {
    activeSourceId: SRC,
    notes: [],
    dispatch: vi.fn(async () => {}),
    ...over
  } as unknown as WorkspaceContext;
}

async function renderPanel(ctx: WorkspaceContext) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      getView("review.panel")!.render({ id: "review", kind: "review.panel" } as never, ctx) as React.ReactElement
    );
  });
  const cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  const click = async (selector: string) => {
    const target = container.querySelector(selector) as HTMLElement | null;
    expect(target, `missing clickable ${selector}`).toBeTruthy();
    await act(async () => {
      target!.click();
    });
  };
  const type = async (selector: string, value: string) => {
    const input = container.querySelector(selector) as HTMLInputElement;
    expect(input, `missing input ${selector}`).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  return { container, cleanup, click, type };
}

describe("ReviewPanel — queue rendering", () => {
  it("renders the policy order (failed/new mistakes first, then least-recently-reviewed) + the count header", async () => {
    const notes = [
      quizNote("n_q1", { createdAt: "2026-01-01T00:00:00.000Z" }),
      mistakeNote("n_m1", { createdAt: "2026-02-01T00:00:00.000Z" }),
      flashcardNote("n_f1", { createdAt: "2026-01-02T00:00:00.000Z" })
    ];
    setReviewIoForTests({
      fetchEvents: async () => [reviewEvent("n_q1", "2026-06-01T00:00:00.000Z", "pass")],
      generate: generateStub()
    });
    const { container, cleanup, click } = await renderPanel(ctxWith({ notes }));

    expect(container.querySelector(".review-count")!.textContent).toBe("3 项待复习");
    // 1st: the never-reviewed mistake (rule 1) with its explainable reason chip.
    expect(container.querySelector(".review-item")!.getAttribute("data-note-id")).toBe("n_m1");
    expect(container.querySelector(".review-reason")!.textContent).toBe("新错题");

    // Advance by skipping: 2nd = the never-reviewed flashcard, 3rd = the reviewed quiz.
    await click(".review-skip-btn");
    expect(container.querySelector(".review-item")!.getAttribute("data-note-id")).toBe("n_f1");
    await click(".review-skip-btn");
    expect(container.querySelector(".review-item")!.getAttribute("data-note-id")).toBe("n_q1");
    expect(container.querySelector(".review-reason")!.textContent).toBe("待复习");
    cleanup();
  });

  it("shows the empty state when nothing is queue-eligible", async () => {
    setReviewIoForTests({ fetchEvents: async () => [], generate: generateStub() });
    const { container, cleanup } = await renderPanel(
      ctxWith({ notes: [makeNote({ id: "n_md", contentType: "markdown", content: "just prose" })] })
    );
    expect(container.querySelector(".review-empty")).toBeTruthy();
    expect(container.querySelector(".review-count")!.textContent).toBe("0 项待复习");
    cleanup();
  });

  it("flips review chrome to English without Chinese residue", async () => {
    setLocale("en");
    setReviewIoForTests({ fetchEvents: async () => [], generate: generateStub() });
    const { container, cleanup } = await renderPanel(ctxWith({ notes: [] }));

    expect(container.querySelector(".panel-title")!.textContent).toContain("Review");
    expect(container.querySelector(".review-scope")!.textContent).toContain("Current Document");
    expect(container.querySelector(".review-scope")!.textContent).toContain("Vault");
    expect(container.querySelector(".review-count")!.textContent).toBe("0 items to review");
    expect(container.querySelector(".review-empty")!.textContent).toContain("No review items yet");
    expect(container.textContent).not.toContain("复习");
    expect(container.textContent).not.toContain("当前文档");
    expect(container.textContent).not.toContain("暂无待复习");
    cleanup();
  });

  it("全库 scope fetches all notes through the IO seam", async () => {
    const fetchAllNotes = vi.fn(async () => [quizNote("n_other", { sourceId: "src_other" })]);
    setReviewIoForTests({ fetchEvents: async () => [], fetchAllNotes, generate: generateStub() });
    const { container, cleanup, click } = await renderPanel(ctxWith({ notes: [] }));

    expect(container.querySelector(".review-empty")).toBeTruthy(); // 当前文档: nothing
    await click(".review-scope-btn[aria-pressed='false']"); // switch to 全库
    expect(fetchAllNotes).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".review-count")!.textContent).toBe("1 项待复习");
    expect(container.querySelector(".review-item")!.getAttribute("data-note-id")).toBe("n_other");
    cleanup();
  });
});

describe("ReviewPanel — 复习错题 scoped launch", () => {
  it("a pending mistakes scope surfaces ONLY mistake items (consume-once)", async () => {
    const notes = [
      quizNote("n_q1"),
      mistakeNote("n_m1"),
      flashcardNote("n_f1")
    ];
    setReviewIoForTests({ fetchEvents: async () => [], generate: generateStub() });
    setPendingReviewScope("mistakes"); // the 错题本 button armed the launch

    const { container, cleanup } = await renderPanel(ctxWith({ notes }));

    // Only the mistake survives the scoped view; the count + current item reflect it.
    expect(container.querySelector(".review-count")!.textContent).toBe("1 项待复习");
    expect(container.querySelector(".review-item")!.getAttribute("data-note-id")).toBe("n_m1");
    expect(container.querySelector(".review-reason")!.textContent).toBe("新错题");
    cleanup();
  });

  it("the scope is CONSUMED on mount — a second (unscoped) mount is byte-identical", async () => {
    const notes = [quizNote("n_q1"), mistakeNote("n_m1"), flashcardNote("n_f1")];
    setReviewIoForTests({ fetchEvents: async () => [], generate: generateStub() });
    setPendingReviewScope("mistakes");

    const first = await renderPanel(ctxWith({ notes }));
    expect(first.container.querySelector(".review-count")!.textContent).toBe("1 项待复习");
    first.cleanup();

    // No new scope armed → the mount reads null → the FULL queue surfaces exactly as before.
    const second = await renderPanel(ctxWith({ notes }));
    expect(second.container.querySelector(".review-count")!.textContent).toBe("3 项待复习");
    expect(second.container.querySelector(".review-item")!.getAttribute("data-note-id")).toBe("n_m1");
    second.cleanup();
  });
});

describe("ReviewPanel — self-grade flow (quiz/flashcard/review-pack)", () => {
  it("card face first, 显示答案 reveals the full render, 我对了 emits pass/self", async () => {
    setReviewIoForTests({ fetchEvents: async () => [], generate: generateStub() });
    const { container, cleanup, click } = await renderPanel(ctxWith({ notes: [flashcardNote("n_f1")] }));

    // Question face: the flashcard CARD mode (front only — the back stays hidden).
    expect(container.textContent).toContain("F正面问题");
    expect(container.textContent).not.toContain("B背面答案");

    // 显示答案 → the full render is the INTERACTIVE flip card, but the reveal position
    // threads initialFace="back" so it opens straight on the ANSWER face — the back is
    // shown immediately, NO second manual flip (N4-D7 double-reveal wrinkle fixed).
    await click(".review-reveal-btn");
    const flip = container.querySelector(".sv-flip")!;
    expect(flip).toBeTruthy();
    expect(flip.getAttribute("data-face")).toBe("back");
    expect(container.textContent).toContain("B背面答案"); // answer visible without a second flip
    expect(container.textContent).not.toContain("F正面问题"); // the question front is now the hidden face

    await click(".review-pass-btn");
    const events = await postedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      verb: "note.review",
      subject: { noteId: "n_f1", sourceId: SRC },
      payload: { result: "pass", mode: "self" }
    });

    await click(".review-next-btn");
    expect(container.querySelector(".review-summary-line")!.textContent).toContain("1 对 / 0 错");
    cleanup();
  });

  it("我错了 emits fail/self and offers 详细讲解 (review.explain → markdown inline)", async () => {
    const generate = generateStub();
    setReviewIoForTests({ fetchEvents: async () => [], generate });
    const { container, cleanup, click } = await renderPanel(ctxWith({ notes: [quizNote("n_q1")] }));

    await click(".review-reveal-btn");
    await click(".review-fail-btn");
    const events = await postedEvents();
    expect(events[0]).toMatchObject({ payload: { result: "fail", mode: "self" } });

    await click(".review-explain-btn");
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        promptId: "review.explain",
        contentType: "markdown",
        input: expect.objectContaining({ userAnswer: "自评:没答对" })
      })
    );
    expect(container.querySelector(".review-explanation")!.textContent).toContain("详解正文");
    cleanup();
  });

  it("跳过 emits skip and advances straight to the next item / tally", async () => {
    setReviewIoForTests({ fetchEvents: async () => [], generate: generateStub() });
    const { container, cleanup, click } = await renderPanel(ctxWith({ notes: [flashcardNote("n_f1")] }));

    await click(".review-skip-btn");
    const events = await postedEvents();
    expect(events[0]).toMatchObject({
      subject: { noteId: "n_f1", sourceId: SRC },
      payload: { result: "skip", mode: "self" }
    });
    expect(container.querySelector(".review-summary-line")!.textContent).toContain("跳过 1");
    cleanup();
  });
});

describe("ReviewPanel — AI check flow (mistake items)", () => {
  it("generate-check → inline draft (question only) → grade-answer → verdict + reveal + fail/ai-check event", async () => {
    const generate = generateStub({ gradeCorrect: false });
    setReviewIoForTests({ fetchEvents: async () => [], generate });
    const { container, cleanup, click, type } = await renderPanel(
      ctxWith({ notes: [mistakeNote("n_m1", { anchorIds: ["anc_1"] })] })
    );

    // The mistake stays compact in the side panel; clicking opens the full Center View.
    expect(container.querySelector(".review-item-content .sv-preview-card")).toBeTruthy();
    expect(container.querySelector(".review-item-content .tb-card.tb-mistake")).toBeNull();
    expect(container.textContent).toContain("浮力等于什么?");

    await click(".review-item-content .sv-preview-card");
    expect(document.body.querySelector(".sv-center-dialog .tb-card.tb-mistake")).toBeTruthy();
    expect(document.body.querySelector(".sv-center-dialog")!.textContent).toContain("排开液体的重力");
    await click(".review-ai-check-btn");
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        promptId: "review.generate-check",
        contentType: "quiz",
        input: expect.objectContaining({ contentType: "textbook.mistake" })
      })
    );
    // Draft renders inline through the quiz CARD face: question, no options, no note saved.
    expect(container.textContent).toContain("检验题Q");
    expect(container.textContent).not.toContain("正确项");

    await type(".review-answer-input", "错误项");
    await click(".review-submit-answer-btn");
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        promptId: "review.grade-answer",
        contentType: "review.grade",
        input: { question: "检验题Q", expected: "正确项", userAnswer: "错误项" }
      })
    );

    // Verdict through the hidden type's registered render + the revealed full quiz.
    expect(container.querySelector(".review-grade-fail")).toBeTruthy();
    expect(container.textContent).toContain("不对哦");
    expect(container.textContent).toContain("正确项"); // options now revealed

    const events = await postedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      verb: "note.review",
      subject: { noteId: "n_m1", sourceId: SRC },
      payload: { result: "fail", mode: "ai-check" }
    });
    cleanup();
  });

  it("a correct answer grades pass/ai-check and offers no 存为错题", async () => {
    setReviewIoForTests({ fetchEvents: async () => [], generate: generateStub({ gradeCorrect: true }) });
    const { container, cleanup, click, type } = await renderPanel(ctxWith({ notes: [mistakeNote("n_m1")] }));

    await click(".review-ai-check-btn");
    await type(".review-answer-input", "正确项");
    await click(".review-submit-answer-btn");

    expect(container.querySelector(".review-grade-pass")).toBeTruthy();
    expect(container.querySelector(".review-save-mistake-btn")).toBeNull();
    expect(container.querySelector(".review-save-practice-btn")).toBeTruthy(); // saving practice is always offered
    const events = await postedEvents();
    expect(events[0]).toMatchObject({ payload: { result: "pass", mode: "ai-check" } });
    cleanup();
  });

  it("存为错题 dispatches the EXISTING note-create with the mistake contentType (and 存为练习 with quiz)", async () => {
    const dispatch = vi.fn(async () => {});
    setReviewIoForTests({ fetchEvents: async () => [], generate: generateStub({ gradeCorrect: false }) });
    const { cleanup, click, type } = await renderPanel(
      ctxWith({ notes: [mistakeNote("n_m1", { anchorIds: ["anc_1"] })], dispatch })
    );

    await click(".review-ai-check-btn");
    await type(".review-answer-input", "错误项");
    await click(".review-submit-answer-btn");

    await click(".review-save-mistake-btn");
    // REV-CORE: NEW 错题 saves write the CORE "mistake" contentType (the reviewed
    // fixture itself stays a LEGACY "textbook.mistake" record — alias-covered).
    expect(dispatch).toHaveBeenCalledWith("anchor.add-note", {
      contentType: "mistake",
      content: expect.objectContaining({
        question: "检验题Q",
        wrongAnswer: "错误项",
        correctAnswer: "正确项",
        mistakeReason: "不对哦",
        retryCount: 0,
        mastery: "weak"
      }),
      anchorIds: ["anc_1"] // reuses the reviewed note's anchors on the active source
    });

    await click(".review-save-practice-btn");
    expect(dispatch).toHaveBeenCalledWith("anchor.add-note", {
      contentType: "quiz",
      content: CHECK_QUIZ,
      anchorIds: ["anc_1"]
    });
    // Grades themselves are never persisted: exactly these two dispatches happened.
    expect(dispatch).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it("a failed check offers 详细讲解 wired with the check question + wrong answer", async () => {
    const generate = generateStub({ gradeCorrect: false });
    setReviewIoForTests({ fetchEvents: async () => [], generate });
    const { container, cleanup, click, type } = await renderPanel(ctxWith({ notes: [mistakeNote("n_m1")] }));

    await click(".review-ai-check-btn");
    await type(".review-answer-input", "错误项");
    await click(".review-submit-answer-btn");
    await click(".review-explain-btn");

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        promptId: "review.explain",
        input: { question: "检验题Q", expected: "正确项", userAnswer: "错误项" }
      })
    );
    expect(container.querySelector(".review-explanation")!.textContent).toContain("详解正文");
    cleanup();
  });
});

describe("ReviewPanel — REV-2 弱项 header + queue weights", () => {
  it("renders top weak buckets as chips (human titles), boosts the queue, and a click filters it", async () => {
    setReviewIoForTests({
      fetchEvents: async () => [],
      // quiz is the weak TYPE (3/4 failed) → boosted + chip; the subject bucket also chips.
      fetchDigestSummaries: async () => [summaryCell("contentType", "quiz", 3, 1), summaryCell("subject", "浮力", 2, 2)],
      fetchProfileFacts: async () => [],
      generate: generateStub()
    });
    const { container, cleanup, click } = await renderPanel(
      ctxWith({ notes: [flashcardNote("n_f1"), quizNote("n_q1")] })
    );

    // Chips, strongest first: quiz (0.75) → its registered TITLE, then 浮力 verbatim.
    const chips = Array.from(container.querySelectorAll<HTMLButtonElement>(".review-weak-chip"));
    expect(chips.map((chip) => chip.dataset.bucket)).toEqual(["quiz", "浮力"]);
    expect(chips[0].textContent).toBe("小测");
    expect(chips[1].textContent).toBe("浮力");

    // The boost: without digests id-order puts n_f1 first; weak quiz floats n_q1.
    expect(container.querySelector(".review-item")!.getAttribute("data-note-id")).toBe("n_q1");
    expect(container.querySelector(".review-count")!.textContent).toBe("2 项待复习");

    // Chip click = component-local bucket filter; clicking again clears it.
    await click(".review-weak-chip[data-bucket='quiz']");
    expect(container.querySelector(".review-count")!.textContent).toBe("1 项待复习");
    expect(container.querySelector(".review-item")!.getAttribute("data-note-id")).toBe("n_q1");
    expect(container.querySelector(".review-weak-chip[data-bucket='quiz']")!.getAttribute("aria-pressed")).toBe("true");
    await click(".review-weak-chip[data-bucket='quiz']");
    expect(container.querySelector(".review-count")!.textContent).toBe("2 项待复习");
    cleanup();
  });

  it("a passed mistake with NO schedule row queues as 待复习 under SRS (no retirement; weak chip still renders)", async () => {
    // Pre-REV-3 this pinned the 弱项 re-surface of a RETIRED mistake; the panel now
    // runs the queue in SRS mode, where a pass is never retirement — a row-less
    // (legacy-vault) mistake is simply DUE (zero-migration law), reason 待复习.
    // The legacy 弱项 re-surface path stays pinned at the queue level (no `now`).
    setReviewIoForTests({
      fetchEvents: async () => [reviewEvent("n_m1", "2026-06-01T00:00:00.000Z", "pass")],
      fetchDigestSummaries: async () => [summaryCell("contentType", "textbook.mistake", 2, 1)],
      fetchProfileFacts: async () => [],
      generate: generateStub()
    });
    const { container, cleanup } = await renderPanel(ctxWith({ notes: [mistakeNote("n_m1")] }));
    const item = container.querySelector(".review-item")!;
    expect(item.getAttribute("data-note-id")).toBe("n_m1");
    expect(item.getAttribute("data-reason")).toBe("due");
    expect(container.querySelector(".review-reason")!.textContent).toBe("待复习");
    expect(container.querySelector(".review-weak-chip[data-bucket='textbook.mistake']")).toBeTruthy();
    cleanup();
  });

  it("a weak fact the user HID on the 画像页 loses its chip (hide honored end-to-end)", async () => {
    setReviewIoForTests({
      fetchEvents: async () => [],
      fetchDigestSummaries: async () => [summaryCell("contentType", "quiz", 3, 1), summaryCell("subject", "浮力", 2, 2)],
      fetchProfileFacts: async () => [
        factView({ key: "weak:contentType:quiz", kind: "weak", title: "弱项:quiz", hidden: true })
      ],
      generate: generateStub()
    });
    const { container, cleanup } = await renderPanel(ctxWith({ notes: [quizNote("n_q1")] }));
    const chips = Array.from(container.querySelectorAll<HTMLButtonElement>(".review-weak-chip"));
    expect(chips.map((chip) => chip.dataset.bucket)).toEqual(["浮力"]); // quiz chip suppressed
    // The QUEUE weighting itself is digest-driven and unaffected by the display hide.
    expect(container.querySelector(".review-item")!.getAttribute("data-note-id")).toBe("n_q1");
    cleanup();
  });
});

describe("ReviewPanel — REV-3 SRS surfaces", () => {
  const DAY_MS = 86_400_000;
  /** A schedule row due `days` from now (positive = scheduled ahead). */
  const rowDueIn = (days: number, over: Partial<ReviewScheduleRecord> = {}): ReviewScheduleRecord => ({
    due: new Date(Date.now() + days * DAY_MS).toISOString(),
    intervalDays: Math.max(0, days),
    ease: 2.5,
    streak: 1,
    reviews: 1,
    lapses: 0,
    lastReviewedAt: new Date(Date.now() - DAY_MS).toISOString(),
    lastResult: "pass",
    ...over
  });

  it("scheduled-ahead items leave the session and count in the header (· N 项已排期)", async () => {
    setReviewIoForTests({
      fetchEvents: async () => [],
      fetchSchedule: async () => ({ n_f1: rowDueIn(3) }), // interval running → excluded
      generate: generateStub()
    });
    const { container, cleanup } = await renderPanel(
      ctxWith({ notes: [flashcardNote("n_f1"), quizNote("n_q1")] })
    );
    expect(container.querySelector(".review-count")!.textContent).toBe("1 项待复习 · 1 项已排期");
    expect(container.querySelector(".review-item")!.getAttribute("data-note-id")).toBe("n_q1");
    cleanup();
  });

  it("grading shows the 下次复习 chip (first pass ⇒ 明天) and advances through the recordGrade seam", async () => {
    const recordGrade = vi.fn(async () => null);
    setReviewIoForTests({
      fetchEvents: async () => [],
      fetchSchedule: async () => ({}),
      recordGrade,
      generate: generateStub()
    });
    const { container, cleanup, click } = await renderPanel(ctxWith({ notes: [flashcardNote("n_f1")] }));

    await click(".review-reveal-btn");
    await click(".review-pass-btn");
    const chip = container.querySelector(".review-next-due")!;
    expect(chip.getAttribute("data-days")).toBe("1"); // legacy vault: FIRST grade materializes 1d
    expect(chip.textContent).toBe("下次复习:明天");
    expect(recordGrade).toHaveBeenCalledWith({ noteId: "n_f1", result: "pass" });
    // The header's scheduled count moved live: the graded card is now 已排期.
    expect(container.querySelector(".review-scheduled-count")!.textContent).toContain("1 项已排期");
    cleanup();
  });

  it("a fail comes back NOW (chip 现在, data-days 0) and still records the grade", async () => {
    const recordGrade = vi.fn(async () => null);
    setReviewIoForTests({
      fetchEvents: async () => [],
      fetchSchedule: async () => ({}),
      recordGrade,
      generate: generateStub()
    });
    const { container, cleanup, click } = await renderPanel(ctxWith({ notes: [quizNote("n_q1")] }));

    await click(".review-reveal-btn");
    await click(".review-fail-btn");
    const chip = container.querySelector(".review-next-due")!;
    expect(chip.getAttribute("data-days")).toBe("0");
    expect(chip.textContent).toBe("下次复习:现在");
    expect(recordGrade).toHaveBeenCalledWith({ noteId: "n_q1", result: "fail" });
    cleanup();
  });

  it("skip neither advances the schedule nor calls recordGrade (not a grade)", async () => {
    const recordGrade = vi.fn(async () => null);
    setReviewIoForTests({
      fetchEvents: async () => [],
      fetchSchedule: async () => ({}),
      recordGrade,
      generate: generateStub()
    });
    const { container, cleanup, click } = await renderPanel(ctxWith({ notes: [flashcardNote("n_f1")] }));
    await click(".review-skip-btn");
    expect(recordGrade).not.toHaveBeenCalled();
    expect(container.querySelector(".review-next-due")).toBeNull();
    cleanup();
  });

  it("all scheduled ⇒ the 提前复习 empty state; the button rebuilds the schedule-free queue", async () => {
    setReviewIoForTests({
      fetchEvents: async () => [],
      fetchSchedule: async () => ({ n_f1: rowDueIn(2), n_q1: rowDueIn(5) }),
      generate: generateStub()
    });
    const { container, cleanup, click } = await renderPanel(
      ctxWith({ notes: [flashcardNote("n_f1"), quizNote("n_q1")] })
    );

    const empty = container.querySelector(".review-empty-scheduled")!;
    expect(empty.textContent).toContain("2 项已排期");
    expect(container.querySelector(".review-item")).toBeNull();

    await click(".review-ahead-btn");
    // 提前复习 = the legacy queue: both items back, header badge instead of counts.
    expect(container.querySelector(".review-count")!.textContent).toBe("2 项待复习 · 提前复习中");
    expect(container.querySelector(".review-item")).toBeTruthy();
    cleanup();
  });

  it("English SRS chrome has no Chinese residue (scheduled count, next-due chip, review-ahead)", async () => {
    setLocale("en");
    const recordGrade = vi.fn(async () => null);
    setReviewIoForTests({
      fetchEvents: async () => [],
      fetchSchedule: async () => ({ n_q1: rowDueIn(4) }),
      recordGrade,
      generate: generateStub()
    });
    const { container, cleanup, click } = await renderPanel(
      ctxWith({ notes: [flashcardNote("n_f1"), quizNote("n_q1")] })
    );
    expect(container.querySelector(".review-count")!.textContent).toBe("1 item to review · 1 scheduled");
    await click(".review-reveal-btn");
    await click(".review-pass-btn");
    expect(container.querySelector(".review-next-due")!.textContent).toBe("Next review: tomorrow");
    expect(container.textContent).not.toContain("已排期");
    expect(container.textContent).not.toContain("下次复习");
    cleanup();
  });
});

describe("ReviewPanel — REV-2 profileContext into review.explain", () => {
  const PROFILE_FACTS: ProfileFactView[] = [
    factView({
      key: "weak:subject:浮力",
      kind: "weak",
      title: "弱项:浮力",
      value: "复习错误率 67%(4/6 次未过,学科)"
    }),
    factView({
      key: "weak:contentType:quiz",
      kind: "weak",
      title: "弱项:quiz",
      value: "复习错误率 60%(3/5 次未过,类型)",
      hidden: true // hidden → must NOT appear in the context
    }),
    factView({ key: "activity:streak", kind: "activity", title: "连续学习", value: "3 天(至 2026-07-01)" })
  ];
  const EXPECTED_CONTEXT = "弱项:浮力 — 复习错误率 67%(4/6 次未过,学科)\n连续学习 — 3 天(至 2026-07-01)";

  it("the explain dispatch carries the compact context (hidden facts excluded)", async () => {
    const generate = generateStub();
    setReviewIoForTests({
      fetchEvents: async () => [],
      fetchDigestSummaries: async () => [],
      fetchProfileFacts: async () => PROFILE_FACTS,
      generate
    });
    const { cleanup, click } = await renderPanel(ctxWith({ notes: [quizNote("n_q1")] }));

    await click(".review-reveal-btn");
    await click(".review-fail-btn");
    await click(".review-explain-btn");

    const explainCall = generate.mock.calls.find(([request]) => request.promptId === "review.explain")![0];
    expect(explainCall.input!.profileContext).toBe(EXPECTED_CONTEXT);
    expect(explainCall.input!.profileContext).not.toContain("弱项:quiz");
    cleanup();
  });

  it("no facts → the explain input has NO profileContext key (REV-1 wire shape)", async () => {
    const generate = generateStub();
    setReviewIoForTests({
      fetchEvents: async () => [],
      fetchDigestSummaries: async () => [],
      fetchProfileFacts: async () => [],
      generate
    });
    const { cleanup, click } = await renderPanel(ctxWith({ notes: [quizNote("n_q1")] }));

    await click(".review-reveal-btn");
    await click(".review-fail-btn");
    await click(".review-explain-btn");

    const explainCall = generate.mock.calls.find(([request]) => request.promptId === "review.explain")![0];
    expect("profileContext" in explainCall.input!).toBe(false);
    cleanup();
  });

  it("note.review subjects now carry contentType — the fuel of the 弱项 signal", async () => {
    setReviewIoForTests({
      fetchEvents: async () => [],
      fetchDigestSummaries: async () => [],
      fetchProfileFacts: async () => [],
      generate: generateStub()
    });
    const { cleanup, click } = await renderPanel(ctxWith({ notes: [flashcardNote("n_f1")] }));
    await click(".review-reveal-btn");
    await click(".review-pass-btn");
    const events = await postedEvents();
    expect(events[0]).toMatchObject({
      verb: "note.review",
      subject: { noteId: "n_f1", sourceId: SRC, contentType: "flashcard" }
    });
    cleanup();
  });
});
