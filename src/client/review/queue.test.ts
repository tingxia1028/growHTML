// Queue policy unit tests (REV-1) — the deterministic ordering law, exhaustively:
// rule 1 (mistakes never-reviewed / failed-last) before rule 2 (quiz/flashcard/
// review-pack least-recently-reviewed); never-reviewed beats reviewed; ties → older
// first; retirement (pass/skip) semantics; foreign verbs/subjects ignored; empties.

import { describe, expect, it } from "vitest";
import {
  buildReviewQueue,
  MISTAKE_CONTENT_TYPE,
  REVIEWABLE_CONTENT_TYPES,
  type ReviewEventLike,
  type ReviewQueueNote
} from "./queue";

const note = (id: string, contentType: string, createdAt?: string): ReviewQueueNote => ({
  id,
  sourceId: "src_1",
  contentType,
  content: {},
  createdAt
});

const review = (noteId: string, createdAt: string, result?: string): ReviewEventLike => ({
  verb: "note.review",
  createdAt,
  subject: { noteId },
  payload: result ? { result } : undefined
});

const ids = (items: { note: { id: string } }[]) => items.map((item) => item.note.id);

describe("queue type constants (read from the real registrations)", () => {
  it("mistake type is the textbook kit's real id", () => {
    expect(MISTAKE_CONTENT_TYPE).toBe("textbook.mistake");
  });
  it("rule-2 material is exactly quiz / flashcard / review-pack", () => {
    expect([...REVIEWABLE_CONTENT_TYPES].sort()).toEqual(["flashcard", "quiz", "textbook.review-pack"]);
  });
});

describe("buildReviewQueue — empty states", () => {
  it("no notes → empty queue (events alone queue nothing)", () => {
    expect(buildReviewQueue({ notes: [], reviewEvents: [review("n1", "2026-01-01T00:00:00.000Z", "fail")] })).toEqual([]);
  });

  it("notes of non-review types → empty queue", () => {
    const notes = [
      note("n1", "markdown"),
      note("n2", "bookmark"),
      note("n3", "textbook.explanation"),
      note("n4", "textbook.exercise")
    ];
    expect(buildReviewQueue({ notes, reviewEvents: [] })).toEqual([]);
  });
});

describe("buildReviewQueue — rule 1 (mistakes) before rule 2 (review material)", () => {
  it("a never-reviewed mistake precedes every quiz/flashcard/review-pack item", () => {
    const notes = [
      note("q1", "quiz", "2026-01-01T00:00:00.000Z"),
      note("m1", MISTAKE_CONTENT_TYPE, "2026-06-01T00:00:00.000Z"), // newer, still first
      note("f1", "flashcard", "2026-01-02T00:00:00.000Z"),
      note("p1", "textbook.review-pack", "2026-01-03T00:00:00.000Z")
    ];
    const queue = buildReviewQueue({ notes, reviewEvents: [] });
    expect(ids(queue)).toEqual(["m1", "q1", "f1", "p1"]);
    expect(queue[0].reason).toBe("mistake-new");
  });

  it("a failed-last mistake bumps to the front even when review material was never reviewed", () => {
    const notes = [
      note("f1", "flashcard", "2026-01-01T00:00:00.000Z"),
      note("m1", MISTAKE_CONTENT_TYPE, "2026-01-02T00:00:00.000Z")
    ];
    const queue = buildReviewQueue({
      notes,
      reviewEvents: [review("m1", "2026-06-01T00:00:00.000Z", "fail")]
    });
    expect(ids(queue)).toEqual(["m1", "f1"]);
    expect(queue[0]).toMatchObject({ reason: "mistake-failed", lastResult: "fail", lastReviewedAt: "2026-06-01T00:00:00.000Z" });
  });
});

describe("buildReviewQueue — mistake retirement (rule 1 is literal)", () => {
  it("a mistake whose LAST review passed is retired from the queue", () => {
    const notes = [note("m1", MISTAKE_CONTENT_TYPE)];
    const queue = buildReviewQueue({ notes, reviewEvents: [review("m1", "2026-06-01T00:00:00.000Z", "pass")] });
    expect(queue).toEqual([]);
  });

  it("a mistake whose LAST review was skipped is also retired (reviewed, not failed)", () => {
    const notes = [note("m1", MISTAKE_CONTENT_TYPE)];
    const queue = buildReviewQueue({ notes, reviewEvents: [review("m1", "2026-06-01T00:00:00.000Z", "skip")] });
    expect(queue).toEqual([]);
  });

  it("the LATEST event decides: fail→pass retires, pass→fail re-queues", () => {
    const notes = [note("m1", MISTAKE_CONTENT_TYPE), note("m2", MISTAKE_CONTENT_TYPE)];
    const events = [
      review("m1", "2026-06-01T00:00:00.000Z", "fail"),
      review("m1", "2026-06-02T00:00:00.000Z", "pass"),
      review("m2", "2026-06-01T00:00:00.000Z", "pass"),
      review("m2", "2026-06-02T00:00:00.000Z", "fail")
    ];
    const queue = buildReviewQueue({ notes, reviewEvents: events });
    expect(ids(queue)).toEqual(["m2"]);
    expect(queue[0].reason).toBe("mistake-failed");
  });

  it("within rule 1, never-reviewed mistakes come before failed ones; failed order by fail time", () => {
    const notes = [
      note("mFailLate", MISTAKE_CONTENT_TYPE, "2026-01-01T00:00:00.000Z"),
      note("mNew", MISTAKE_CONTENT_TYPE, "2026-05-01T00:00:00.000Z"),
      note("mFailEarly", MISTAKE_CONTENT_TYPE, "2026-01-02T00:00:00.000Z")
    ];
    const events = [
      review("mFailLate", "2026-06-10T00:00:00.000Z", "fail"),
      review("mFailEarly", "2026-06-01T00:00:00.000Z", "fail")
    ];
    expect(ids(buildReviewQueue({ notes, reviewEvents: events }))).toEqual(["mNew", "mFailEarly", "mFailLate"]);
  });
});

describe("buildReviewQueue — rule 2 recency ordering", () => {
  it("never-reviewed beats reviewed", () => {
    const notes = [
      note("qReviewed", "quiz", "2026-01-01T00:00:00.000Z"),
      note("qNew", "quiz", "2026-05-01T00:00:00.000Z") // newer note, but never reviewed → first
    ];
    const queue = buildReviewQueue({
      notes,
      reviewEvents: [review("qReviewed", "2026-06-01T00:00:00.000Z", "pass")]
    });
    expect(ids(queue)).toEqual(["qNew", "qReviewed"]);
    expect(queue[0].lastReviewedAt).toBeUndefined();
    expect(queue[1].lastReviewedAt).toBe("2026-06-01T00:00:00.000Z");
  });

  it("least-recently-reviewed first among reviewed items (latest event per note counts)", () => {
    const notes = [
      note("a", "quiz"),
      note("b", "flashcard"),
      note("c", "textbook.review-pack")
    ];
    const events = [
      review("a", "2026-06-01T00:00:00.000Z", "pass"),
      review("a", "2026-06-20T00:00:00.000Z", "pass"), // a's latest = 06-20 (most recent)
      review("b", "2026-06-05T00:00:00.000Z", "fail"),
      review("c", "2026-06-10T00:00:00.000Z", "skip")
    ];
    expect(ids(buildReviewQueue({ notes, reviewEvents: events }))).toEqual(["b", "c", "a"]);
  });

  it("reviewed quiz/flashcard/review-pack notes STAY queued (they are material, not retired)", () => {
    const notes = [note("q1", "quiz")];
    const queue = buildReviewQueue({ notes, reviewEvents: [review("q1", "2026-06-01T00:00:00.000Z", "pass")] });
    expect(ids(queue)).toEqual(["q1"]);
    expect(queue[0]).toMatchObject({ reason: "due", lastResult: "pass" });
  });
});

describe("buildReviewQueue — deterministic tie-breaks", () => {
  it("ties on recency → older note first (createdAt asc)", () => {
    const notes = [
      note("newer", "quiz", "2026-03-01T00:00:00.000Z"),
      note("older", "quiz", "2026-01-01T00:00:00.000Z")
    ];
    // Both never reviewed → tie on recency.
    expect(ids(buildReviewQueue({ notes, reviewEvents: [] }))).toEqual(["older", "newer"]);

    // Both reviewed at the SAME instant → still older note first.
    const sameTime = [
      review("newer", "2026-06-01T00:00:00.000Z", "pass"),
      review("older", "2026-06-01T00:00:00.000Z", "pass")
    ];
    expect(ids(buildReviewQueue({ notes, reviewEvents: sameTime }))).toEqual(["older", "newer"]);
  });

  it("identical createdAt (or missing) → id asc as the final deterministic tie-break", () => {
    const notes = [note("b", "quiz"), note("a", "quiz"), note("c", "flashcard")];
    expect(ids(buildReviewQueue({ notes, reviewEvents: [] }))).toEqual(["a", "b", "c"]);
  });
});

describe("buildReviewQueue — event hygiene", () => {
  it("non-review verbs never count as a review", () => {
    const notes = [note("m1", MISTAKE_CONTENT_TYPE)];
    const events: ReviewEventLike[] = [
      { verb: "note.create", createdAt: "2026-06-01T00:00:00.000Z", subject: { noteId: "m1" }, payload: { result: "pass" } },
      { verb: "note.edit", createdAt: "2026-06-02T00:00:00.000Z", subject: { noteId: "m1" } }
    ];
    const queue = buildReviewQueue({ notes, reviewEvents: events });
    expect(queue).toHaveLength(1);
    expect(queue[0].reason).toBe("mistake-new"); // still counts as never reviewed
  });

  it("events without a subject.noteId (or for unknown notes) are ignored", () => {
    const notes = [note("q1", "quiz")];
    const events: ReviewEventLike[] = [
      { verb: "note.review", createdAt: "2026-06-01T00:00:00.000Z", payload: { result: "pass" } },
      review("someone-else", "2026-06-02T00:00:00.000Z", "fail")
    ];
    const queue = buildReviewQueue({ notes, reviewEvents: events });
    expect(queue[0].lastReviewedAt).toBeUndefined();
  });

  it("accepts capture-shaped events (ts instead of createdAt)", () => {
    const notes = [note("m1", MISTAKE_CONTENT_TYPE)];
    const events: ReviewEventLike[] = [
      { verb: "note.review", ts: "2026-06-01T00:00:00.000Z", subject: { noteId: "m1" }, payload: { result: "pass" } }
    ];
    expect(buildReviewQueue({ notes, reviewEvents: events })).toEqual([]); // pass retires it
  });

  it("a review event without a result payload counts as reviewed-not-failed", () => {
    const mistakes = [note("m1", MISTAKE_CONTENT_TYPE)];
    expect(buildReviewQueue({ notes: mistakes, reviewEvents: [review("m1", "2026-06-01T00:00:00.000Z")] })).toEqual([]);
    // …but for rule-2 material it still just sets recency.
    const quizzes = [note("q1", "quiz"), note("q2", "quiz")];
    const queue = buildReviewQueue({ notes: quizzes, reviewEvents: [review("q1", "2026-06-01T00:00:00.000Z")] });
    expect(ids(queue)).toEqual(["q2", "q1"]);
    expect(queue[1].lastResult).toBeUndefined();
  });
});
