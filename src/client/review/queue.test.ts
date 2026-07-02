// Queue policy unit tests (REV-1 + REV-2) — the deterministic ordering law,
// exhaustively: rule 1 (mistakes never-reviewed / failed-last) before rule 2
// (quiz/flashcard/review-pack least-recently-reviewed); never-reviewed beats
// reviewed; ties → older first; retirement (pass/skip) semantics; foreign
// verbs/subjects ignored; empties. REV-2: weak buckets from digest summaries —
// threshold edges (the profile tier's own 弱项 rules), group-3 insertion + reasons,
// the within-group boost, and the no-digest regression pin (REV-1 stays identical).

import { describe, expect, it } from "vitest";
import { PROFILE_WEAK_FAIL_RATIO, PROFILE_WEAK_MIN_ATTEMPTS } from "../../core/memory/profile";
import {
  buildReviewQueue,
  MISTAKE_CONTENT_TYPE,
  noteMatchesWeakBucket,
  REVIEWABLE_CONTENT_TYPES,
  weakReviewBuckets,
  type ReviewDigestSummaryLike,
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

// ————————————————————————————— REV-2: weak buckets —————————————————————————————

/** A digest summary cell with `fail`/`pass` tallies (attempts/failRatio derived). */
const cell = (
  dimension: ReviewDigestSummaryLike["dimension"],
  bucket: string,
  fail: number,
  pass: number
): ReviewDigestSummaryLike => {
  const attempts = pass + fail;
  return { dimension, bucket, review: { attempts, failRatio: attempts > 0 ? fail / attempts : 0 } };
};

describe("weakReviewBuckets — the profile tier's own 弱项 thresholds (imported, not duplicated)", () => {
  it("a bucket AT the ratio threshold with the minimum attempts is weak (inclusive edges)", () => {
    // The thresholds ARE profile.ts's (imported): ratio ≥ 0.5 over ≥ 3 graded attempts.
    expect(PROFILE_WEAK_FAIL_RATIO).toBe(0.5);
    expect(PROFILE_WEAK_MIN_ATTEMPTS).toBe(3);
    // Exactly at both boundaries (2/4 = 0.5; 3/6 = 0.5 with more attempts) → both weak;
    // equal ratios tie-break by attempts desc.
    const weak = weakReviewBuckets([cell("contentType", "quiz", 2, 2), cell("subject", "textbook", 3, 3)]);
    expect(weak.map((b) => b.bucket)).toEqual(["textbook", "quiz"]);
  });

  it("below either threshold is NOT weak: too few attempts, or too low a ratio", () => {
    expect(
      weakReviewBuckets([
        cell("contentType", "quiz", 2, 0), // ratio 1.0 but only 2 attempts
        cell("subject", "textbook", 1, 2), // 3 attempts but ratio 1/3
        cell("sourceId", "src_1", 0, 0) // nothing graded
      ])
    ).toEqual([]);
  });

  it("sorts strongest first: failRatio desc → attempts desc → dimension order → bucket asc", () => {
    const weak = weakReviewBuckets([
      cell("sourceId", "src_1", 3, 3), // 0.5 / 6
      cell("contentType", "quiz", 3, 3), // 0.5 / 6 — same numbers: dimension order wins
      cell("subject", "textbook", 2, 2), // 0.5 / 4
      cell("contentType", "flashcard", 3, 0) // 1.0 / 3 — strongest ratio first
    ]);
    expect(weak.map((b) => `${b.dimension}:${b.bucket}`)).toEqual([
      "contentType:flashcard",
      "contentType:quiz",
      "sourceId:src_1",
      "subject:textbook"
    ]);
    expect(weak[0]).toEqual({ dimension: "contentType", bucket: "flashcard", failRatio: 1, attempts: 3 });
  });
});

describe("noteMatchesWeakBucket — the note→bucket mapping", () => {
  const weakOf = (summaries: ReviewDigestSummaryLike[]) => weakReviewBuckets(summaries)[0];

  it("contentType and sourceId buckets match their fields verbatim", () => {
    const byType = weakOf([cell("contentType", "quiz", 3, 0)]);
    expect(noteMatchesWeakBucket(note("n1", "quiz"), byType)).toBe(true);
    expect(noteMatchesWeakBucket(note("n1", "flashcard"), byType)).toBe(false);

    const bySource = weakOf([cell("sourceId", "src_1", 3, 0)]);
    expect(noteMatchesWeakBucket(note("n1", "markdown"), bySource)).toBe(true); // fixture sourceId = src_1
    expect(noteMatchesWeakBucket({ id: "n2", contentType: "markdown" }, bySource)).toBe(false); // no sourceId
  });

  it("subject buckets match by kit prefix (the digest engine's kitId fallback)", () => {
    const bySubject = weakOf([cell("subject", "textbook", 3, 0)]);
    expect(noteMatchesWeakBucket(note("n1", "textbook.mistake"), bySubject)).toBe(true);
    expect(noteMatchesWeakBucket(note("n1", "textbook.explanation"), bySubject)).toBe(true);
    expect(noteMatchesWeakBucket(note("n1", "quiz"), bySubject)).toBe(false);
    // A MEM-3 human taxonomy bucket ("浮力") matches no note — header-only signal.
    expect(noteMatchesWeakBucket(note("n1", "quiz"), weakOf([cell("subject", "浮力", 3, 0)]))).toBe(false);
  });
});

describe("buildReviewQueue — rule 3 (weak-bucket insertion)", () => {
  it("a RETIRED mistake (last pass) in a weak bucket re-surfaces, tagged 弱项:{bucket}", () => {
    const notes = [note("m1", MISTAKE_CONTENT_TYPE)];
    const events = [review("m1", "2026-06-01T00:00:00.000Z", "pass")];
    // Without digests it is retired (the REV-1 pin)…
    expect(buildReviewQueue({ notes, reviewEvents: events })).toEqual([]);
    // …with a weak bucket over its contentType it comes back as a group-3 item.
    const queue = buildReviewQueue({
      notes,
      reviewEvents: events,
      digestSummaries: [cell("contentType", MISTAKE_CONTENT_TYPE, 2, 1)]
    });
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      reason: `弱项:${MISTAKE_CONTENT_TYPE}`,
      lastResult: "pass",
      lastReviewedAt: "2026-06-01T00:00:00.000Z"
    });
  });

  it("non-review-material notes in a weak sourceId bucket are pulled in AFTER groups 1/2", () => {
    const notes = [
      note("n_md", "markdown", "2026-01-01T00:00:00.000Z"),
      note("n_quiz", "quiz", "2026-01-02T00:00:00.000Z"),
      note("m1", MISTAKE_CONTENT_TYPE, "2026-01-03T00:00:00.000Z")
    ];
    const queue = buildReviewQueue({
      notes,
      reviewEvents: [],
      digestSummaries: [cell("sourceId", "src_1", 3, 1)]
    });
    // m1 stays rule 1, quiz stays rule 2 (both boosted-but-alone), markdown is rule 3.
    expect(ids(queue)).toEqual(["m1", "n_quiz", "n_md"]);
    expect(queue.map((item) => item.reason)).toEqual(["mistake-new", "due", "弱项:src_1"]);
  });

  it("notes matching NO weak bucket stay excluded — weak buckets never flood unrelated content", () => {
    const notes = [note("n_md", "markdown"), note("n_other", "textbook.explanation")];
    const queue = buildReviewQueue({
      notes,
      reviewEvents: [],
      digestSummaries: [cell("contentType", "quiz", 3, 0)]
    });
    expect(queue).toEqual([]);
  });

  it("a multi-bucket note's reason names the STRONGEST bucket (weakReviewBuckets order)", () => {
    const notes = [note("n_md", "markdown")]; // matches both src_1 and the markdown type bucket
    const queue = buildReviewQueue({
      notes,
      reviewEvents: [],
      digestSummaries: [
        cell("sourceId", "src_1", 2, 2), // 0.5
        cell("contentType", "markdown", 3, 0) // 1.0 — strongest names the reason
      ]
    });
    expect(queue[0].reason).toBe("弱项:markdown");
  });

  it("group-3 ordering is the existing never-reviewed → lastReviewedAt → createdAt → id law", () => {
    const notes = [
      note("w_reviewed", "markdown", "2026-01-01T00:00:00.000Z"),
      note("w_new_b", "markdown", "2026-01-05T00:00:00.000Z"),
      note("w_new_a", "markdown", "2026-01-05T00:00:00.000Z")
    ];
    const queue = buildReviewQueue({
      notes,
      reviewEvents: [review("w_reviewed", "2026-06-01T00:00:00.000Z", "fail")],
      digestSummaries: [cell("contentType", "markdown", 3, 0)]
    });
    expect(ids(queue)).toEqual(["w_new_a", "w_new_b", "w_reviewed"]);
  });
});

describe("buildReviewQueue — the REV-2 within-group boost", () => {
  it("weak-bucket membership floats an item ahead of NEVER-REVIEWED peers in group 2", () => {
    const notes = [
      note("q_fresh", "quiz", "2026-01-01T00:00:00.000Z"), // never reviewed — REV-1 would put it first
      note("f_weak", "flashcard", "2026-05-01T00:00:00.000Z")
    ];
    const events = [review("f_weak", "2026-06-01T00:00:00.000Z", "fail")];
    // REV-1 order (no digests): never-reviewed first.
    expect(ids(buildReviewQueue({ notes, reviewEvents: events }))).toEqual(["q_fresh", "f_weak"]);
    // Weak flashcard bucket → the reviewed-but-weak item is boosted to the front.
    const boosted = buildReviewQueue({
      notes,
      reviewEvents: events,
      digestSummaries: [cell("contentType", "flashcard", 3, 1)]
    });
    expect(ids(boosted)).toEqual(["f_weak", "q_fresh"]);
    expect(boosted[0].reason).toBe("due"); // boosted, not re-tagged — it was already queued
  });

  it("boosts group 1 too, and keeps the existing law within the weak segment", () => {
    // m_weak_old / m_weak_new live in a weak SOURCE; m_plain (the OLDEST) elsewhere.
    const scoped = [
      { ...note("m_weak_old", MISTAKE_CONTENT_TYPE, "2026-01-01T00:00:00.000Z"), sourceId: "src_weak" },
      { ...note("m_weak_new", MISTAKE_CONTENT_TYPE, "2026-03-01T00:00:00.000Z"), sourceId: "src_weak" },
      { ...note("m_plain", MISTAKE_CONTENT_TYPE, "2025-01-01T00:00:00.000Z"), sourceId: "src_calm" }
    ];
    const queue = buildReviewQueue({
      notes: scoped,
      reviewEvents: [],
      digestSummaries: [cell("sourceId", "src_weak", 3, 0)]
    });
    // Weak-first, then createdAt asc within the weak segment; the plain (older!) last.
    expect(ids(queue)).toEqual(["m_weak_old", "m_weak_new", "m_plain"]);
    expect(queue.map((item) => item.reason)).toEqual(["mistake-new", "mistake-new", "mistake-new"]);
  });
});

describe("buildReviewQueue — no-digest regression (REV-1 pinned)", () => {
  const notes = [
    note("m1", MISTAKE_CONTENT_TYPE, "2026-01-01T00:00:00.000Z"),
    note("q1", "quiz", "2026-01-02T00:00:00.000Z"),
    note("f1", "flashcard", "2026-01-03T00:00:00.000Z"),
    note("md", "markdown", "2026-01-04T00:00:00.000Z")
  ];
  const events = [
    review("q1", "2026-06-01T00:00:00.000Z", "pass"),
    review("m1", "2026-06-02T00:00:00.000Z", "fail")
  ];

  it("absent digestSummaries ≡ empty digestSummaries ≡ all-below-threshold digests", () => {
    const base = buildReviewQueue({ notes, reviewEvents: events });
    expect(buildReviewQueue({ notes, reviewEvents: events, digestSummaries: [] })).toEqual(base);
    expect(
      buildReviewQueue({
        notes,
        reviewEvents: events,
        digestSummaries: [cell("contentType", "quiz", 1, 2), cell("sourceId", "src_1", 1, 1)]
      })
    ).toEqual(base);
    // And the base IS the REV-1 order with REV-1 reasons — no new fields, no group 3.
    expect(ids(base)).toEqual(["m1", "f1", "q1"]);
    expect(base.map((item) => item.reason)).toEqual(["mistake-failed", "due", "due"]);
  });
});
