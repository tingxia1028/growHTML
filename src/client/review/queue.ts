// Review queue policy (REV-1 + REV-2 weights) — the PURE, deterministic, explainable
// ordering rule (review-loop.md §2; explicitly NOT SRS — real SRS is a later swap of
// this one function, not a rewrite):
//
//   1. mistake notes (specs declaring the `mistake` capability — the core `mistake`
//      type; old `textbook.mistake` records resolve via the registry alias)
//      never reviewed OR failed last time
//   2. review-material notes (specs declaring `review.reviewable` — quiz/flashcard
//      in core; a kit extends by declaring, e.g. textbook.review-pack),
//      least-recently-reviewed
//      (recency = the latest `note.review` memory event whose subject.noteId matches)
//   3. [REV-2] weak-bucket notes: MEM-2 digest summaries name the (subject |
//      contentType | sourceId) buckets whose graded fail ratio crosses the profile
//      弱项 thresholds; notes in those buckets that rules 1/2 would NOT queue (retired
//      mistakes, non-review-material types) are appended, reason `弱项:{bucket}` —
//      still fully explainable. Weak-bucket membership ALSO boosts ordering WITHIN
//      groups 1/2 (weak-first, then the existing recency/age/id tie-breaks).
//   ties → older note first (createdAt asc), then id asc — fully deterministic.
//   No digest input → byte-identical to the REV-1 queue (regression-pinned).
//
// The function takes PLAIN records (notes + memory-event records + digest summary
// cells) plus the CONTENT-TYPE REGISTRY's declared capabilities (REV-CORE: rule-1/2
// eligibility comes from `spec.mistake` / `spec.review.reviewable`, alias-aware — no
// kit import, no hardcoded type list); it touches no client, no clock — the view
// fetches and passes the records in. Zero new entities: "mastery" is just the
// note.review event stream consolidated by MEM-2 digests (product-kernel §1).

import { PROFILE_WEAK_FAIL_RATIO, PROFILE_WEAK_MIN_ATTEMPTS } from "../../core/memory/profile";
import { getNoteContentSpec } from "../../core/notes/contentTypes";

/** Rule-1 eligibility: the note's spec (alias-aware) declares the mistake capability. */
const isMistakeNote = (note: ReviewQueueNote): boolean =>
  getNoteContentSpec(note.contentType)?.mistake === true;
/** Rule-2 eligibility: the note's spec declares itself review material. */
const isReviewMaterial = (note: ReviewQueueNote): boolean =>
  getNoteContentSpec(note.contentType)?.review?.reviewable === true;

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

export type ReviewReason = "mistake-new" | "mistake-failed" | "due" | `弱项:${string}`;

export type ReviewQueueItem<N extends ReviewQueueNote = ReviewQueueNote> = {
  note: N;
  /** Why it is queued — the explainability the V1 policy promises. */
  reason: ReviewReason;
  /** When it was last reviewed (latest note.review event time); undefined = never. */
  lastReviewedAt?: string;
  /** The latest review's payload.result ("pass" | "fail" | "skip"); undefined = never. */
  lastResult?: string;
};

// —— REV-2: weak buckets from MEM-2 digest summaries ————————————————————————

/**
 * Structural minimum of one MEM-2 digest summary cell — the core
 * `MemoryDimensionSummary` (summarizeMemoryDigests().dimensions) satisfies it.
 */
export type ReviewDigestSummaryLike = {
  dimension: "subject" | "contentType" | "sourceId";
  bucket: string;
  review: { attempts: number; failRatio: number };
};

/** One 弱项 bucket the queue weights by (and the panel renders chips from). */
export type ReviewWeakBucket = {
  dimension: "subject" | "contentType" | "sourceId";
  bucket: string;
  failRatio: number;
  attempts: number;
};

const WEAK_DIMENSION_ORDER: readonly ReviewWeakBucket["dimension"][] = ["subject", "contentType", "sourceId"];

/**
 * Digest summary cells → the 弱项 buckets, strongest first. The thresholds are the
 * profile tier's OWN 弱项 rules (imported, not duplicated), so the queue, the 画像页,
 * and the header chips always agree on what "weak" means. Sort: failRatio desc →
 * attempts desc → dimension order → bucket asc (deterministic, mirrors profile.ts).
 */
export function weakReviewBuckets(summaries: readonly ReviewDigestSummaryLike[]): ReviewWeakBucket[] {
  return summaries
    .filter(
      (cell) =>
        cell.review.attempts >= PROFILE_WEAK_MIN_ATTEMPTS && cell.review.failRatio >= PROFILE_WEAK_FAIL_RATIO
    )
    .map((cell) => ({
      dimension: cell.dimension,
      bucket: cell.bucket,
      failRatio: cell.review.failRatio,
      attempts: cell.review.attempts
    }))
    .sort((a, b) => {
      if (b.failRatio !== a.failRatio) return b.failRatio - a.failRatio;
      if (b.attempts !== a.attempts) return b.attempts - a.attempts;
      const dimension = WEAK_DIMENSION_ORDER.indexOf(a.dimension) - WEAK_DIMENSION_ORDER.indexOf(b.dimension);
      if (dimension !== 0) return dimension;
      return a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0;
    });
}

/**
 * Does a note belong to a digest bucket? contentType/sourceId match their fields
 * verbatim; a `subject` bucket matches by KIT PREFIX (`textbook` ⇒ `textbook.*`) —
 * the digest engine's own fallback writes `subject.kitId` into that dimension, and
 * kit note types are `${kitId}.…` by convention. MEM-3 taxonomy buckets (e.g. a
 * human 学科 like "浮力") simply match no note here — they still surface in the
 * 弱项 header, they just can't pull specific notes into the queue yet.
 */
export function noteMatchesWeakBucket(note: ReviewQueueNote, bucket: ReviewWeakBucket): boolean {
  switch (bucket.dimension) {
    case "contentType":
      return note.contentType === bucket.bucket;
    case "sourceId":
      return note.sourceId === bucket.bucket;
    case "subject":
      return note.contentType.startsWith(`${bucket.bucket}.`);
  }
}

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
  /** REV-2: MEM-2 digest summary cells. Absent/empty ⇒ the exact REV-1 queue. */
  digestSummaries?: readonly ReviewDigestSummaryLike[];
}): ReviewQueueItem<N>[] {
  const latest = latestReviewByNote(input.reviewEvents);
  // Strongest-first weak buckets; a note's reason names the FIRST bucket it matches.
  // Membership is resolved once per note (the sort comparator reads the cache).
  const weakBuckets = input.digestSummaries ? weakReviewBuckets(input.digestSummaries) : [];
  const weakByNote = new Map<string, ReviewWeakBucket>();
  if (weakBuckets.length > 0) {
    for (const note of input.notes) {
      const bucket = weakBuckets.find((cell) => noteMatchesWeakBucket(note, cell));
      if (bucket) weakByNote.set(note.id, bucket);
    }
  }
  const weakBucketOf = (note: N): ReviewWeakBucket | undefined => weakByNote.get(note.id);

  const mistakes: ReviewQueueItem<N>[] = [];
  const due: ReviewQueueItem<N>[] = [];
  const weak: ReviewQueueItem<N>[] = [];

  for (const note of input.notes) {
    const last = latest.get(note.id);
    const lastReviewedAt = last ? eventTime(last) || undefined : undefined;
    const lastResult = typeof last?.payload?.result === "string" ? (last.payload.result as string) : undefined;

    if (isMistakeNote(note)) {
      // Rule 1 — literally "never reviewed OR failed last time". A pass retires the
      // mistake from the queue; a skip counts as reviewed-not-failed (also retires —
      // the V1 literal rule; rule 3 below is the REV-2 re-surface policy: a retired
      // mistake in a weak bucket comes back as a 弱项 item).
      if (!last) mistakes.push({ note, reason: "mistake-new", lastReviewedAt, lastResult });
      else if (lastResult === "fail") mistakes.push({ note, reason: "mistake-failed", lastReviewedAt, lastResult });
      else {
        const bucket = weakBucketOf(note);
        if (bucket) weak.push({ note, reason: `弱项:${bucket.bucket}`, lastReviewedAt, lastResult });
      }
      continue;
    }

    if (isReviewMaterial(note)) {
      due.push({ note, reason: "due", lastReviewedAt, lastResult });
      continue;
    }

    // Rule 3 — every other contentType is not review material under rules 1/2 (the
    // V1 law), but a weak bucket pulls it in anyway: THIS is where digests bend the
    // queue toward what the student keeps failing.
    const bucket = weakBucketOf(note);
    if (bucket) weak.push({ note, reason: `弱项:${bucket.bucket}`, lastReviewedAt, lastResult });
  }

  // Within groups 1/2, weak-bucket members float first (the REV-2 boost), then the
  // existing REV-1 order. With no weak buckets the boost is a universal tie — the
  // comparator degenerates to byRecencyThenAge and output is REV-1-identical.
  const byWeakThenRecency = (a: ReviewQueueItem<N>, b: ReviewQueueItem<N>): number => {
    const aWeak = weakBucketOf(a.note) !== undefined;
    const bWeak = weakBucketOf(b.note) !== undefined;
    if (aWeak !== bWeak) return aWeak ? -1 : 1;
    return byRecencyThenAge(a, b);
  };

  mistakes.sort(byWeakThenRecency);
  due.sort(byWeakThenRecency);
  weak.sort(byRecencyThenAge); // all group-3 items are weak — the boost is uniform here
  return [...mistakes, ...due, ...weak];
}
