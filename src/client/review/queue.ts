// Review queue policy (REV-1) — the PURE, deterministic, explainable ordering rule
// (review-loop.md §2; explicitly NOT SRS — real SRS is a later swap of this one
// function, not a rewrite):
//
//   1. mistake notes (textbook.mistake) never reviewed OR failed last time
//   2. quiz / flashcard / review-pack notes, least-recently-reviewed
//      (recency = the latest `note.review` memory event whose subject.noteId matches)
//   ties → older note first (createdAt asc), then id asc — fully deterministic.
//
// The function takes PLAIN records (notes + memory-event records) and touches no
// registry, no client, no clock — the view fetches and passes them in. Zero new
// entities: "mastery" is just the note.review event stream (product-kernel §1).

import { mistakeSpec, reviewPackSpec } from "../../kits/textbook-learning/contentTypes";

/** The mistake type that seeds queue rule 1 — read from the kit's spec (the real id). */
export const MISTAKE_CONTENT_TYPE = mistakeSpec.contentType;
/** The rule-2 "review material" types: built-in quiz/flashcard + the kit review pack. */
export const REVIEWABLE_CONTENT_TYPES: readonly string[] = ["quiz", "flashcard", reviewPackSpec.contentType];

// Structural minimum of a note the policy needs. Client NoteRecord satisfies it
// (createdAt is on the wire even though the client type omits it — optional here, and
// absent values still order deterministically via the id tie-break).
export type ReviewQueueNote = {
  id: string;
  sourceId?: string;
  contentType: string;
  content?: unknown;
  createdAt?: string;
};

// Structural minimum of a memory-event record: the server's MemoryEventRecord shape
// (GET /api/memory/events) — createdAt IS the event time; `ts` is accepted as the
// capture-queue wire fallback so tests can pass capture-shaped inputs.
export type ReviewEventLike = {
  verb?: string;
  createdAt?: string;
  ts?: string;
  subject?: { noteId?: string };
  payload?: Record<string, unknown>;
};

export type ReviewReason = "mistake-new" | "mistake-failed" | "due";

export type ReviewQueueItem<N extends ReviewQueueNote = ReviewQueueNote> = {
  note: N;
  /** Why it is queued — the explainability the V1 policy promises. */
  reason: ReviewReason;
  /** When it was last reviewed (latest note.review event time); undefined = never. */
  lastReviewedAt?: string;
  /** The latest review's payload.result ("pass" | "fail" | "skip"); undefined = never. */
  lastResult?: string;
};

const eventTime = (event: ReviewEventLike): string => event.createdAt ?? event.ts ?? "";

/** The latest note.review event per noteId (later time wins; equal times → later index). */
function latestReviewByNote(reviewEvents: readonly ReviewEventLike[]): Map<string, ReviewEventLike> {
  const latest = new Map<string, ReviewEventLike>();
  for (const event of reviewEvents) {
    if (event.verb !== "note.review") continue;
    const noteId = event.subject?.noteId;
    if (!noteId) continue;
    const current = latest.get(noteId);
    if (!current || eventTime(event) >= eventTime(current)) latest.set(noteId, event);
  }
  return latest;
}

// Least-recently-reviewed first: never-reviewed (no lastReviewedAt) beats reviewed;
// then lastReviewedAt asc; ties → older note first (createdAt asc), then id asc.
function byRecencyThenAge<N extends ReviewQueueNote>(a: ReviewQueueItem<N>, b: ReviewQueueItem<N>): number {
  const aReviewed = a.lastReviewedAt !== undefined;
  const bReviewed = b.lastReviewedAt !== undefined;
  if (aReviewed !== bReviewed) return aReviewed ? 1 : -1;
  if (aReviewed && bReviewed && a.lastReviewedAt !== b.lastReviewedAt) {
    return (a.lastReviewedAt as string) < (b.lastReviewedAt as string) ? -1 : 1;
  }
  const aCreated = a.note.createdAt ?? "";
  const bCreated = b.note.createdAt ?? "";
  if (aCreated !== bCreated) return aCreated < bCreated ? -1 : 1;
  return a.note.id < b.note.id ? -1 : a.note.id > b.note.id ? 1 : 0;
}

export function buildReviewQueue<N extends ReviewQueueNote>(input: {
  notes: readonly N[];
  reviewEvents: readonly ReviewEventLike[];
}): ReviewQueueItem<N>[] {
  const latest = latestReviewByNote(input.reviewEvents);

  const mistakes: ReviewQueueItem<N>[] = [];
  const due: ReviewQueueItem<N>[] = [];

  for (const note of input.notes) {
    const last = latest.get(note.id);
    const lastReviewedAt = last ? eventTime(last) || undefined : undefined;
    const lastResult = typeof last?.payload?.result === "string" ? (last.payload.result as string) : undefined;

    if (note.contentType === MISTAKE_CONTENT_TYPE) {
      // Rule 1 — literally "never reviewed OR failed last time". A pass retires the
      // mistake from the queue; a skip counts as reviewed-not-failed (also retires —
      // the V1 literal rule; a re-surface policy is a REV-2 policy swap).
      if (!last) mistakes.push({ note, reason: "mistake-new", lastReviewedAt, lastResult });
      else if (lastResult === "fail") mistakes.push({ note, reason: "mistake-failed", lastReviewedAt, lastResult });
      continue;
    }

    if (REVIEWABLE_CONTENT_TYPES.includes(note.contentType)) {
      due.push({ note, reason: "due", lastReviewedAt, lastResult });
    }
    // Every other contentType is not review material — never queued (V1).
  }

  mistakes.sort(byRecencyThenAge);
  due.sort(byRecencyThenAge);
  return [...mistakes, ...due];
}
