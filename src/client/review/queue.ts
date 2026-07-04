// Review queue policy (REV-1 + REV-2 weights + REV-3 SRS) — the PURE, deterministic,
// explainable ordering rule (review-loop.md §2/§4). REV-3 delivers the "later swap"
// the V1 header promised: passing `now` (+ the per-note schedule document) arms SRS
// mode — non-due items leave the queue, overdue floats first, grading advances the
// schedule (the panel POSTs /api/review/grade). WITHOUT `now` the function is
// byte-identical to the REV-1/2 queue (regression-pinned) — that legacy mode is also
// the 提前复习 path (review ahead = ignore the schedule).
//
// The V1 law it swaps in on top of:
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
import { isDueAt, type ReviewScheduleRecord, type ReviewScheduleState } from "../../core/review/schedule";

/**
 * REV-3 session cap — the dailyish load limit the panel passes in SRS mode
 * (review-loop.md leaves the number to config; classic SRS defaults sit at 20–50).
 * The cap trims the SESSION, never the due COUNT (reviewDueStats stays uncapped).
 */
export const REVIEW_SESSION_CAP = 50;

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
  /** REV-3: the note's SRS row (SRS mode only; undefined = never graded ⇒ due). */
  schedule?: ReviewScheduleRecord;
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
  /**
   * REV-3: the per-note SRS document (review-schedule.json via GET
   * /api/review/schedule). Only read in SRS mode; {} = legacy vault = all due.
   */
  schedule?: ReviewScheduleState;
  /**
   * REV-3: the session clock — PASSING IT ARMS SRS MODE (clock-injected purity):
   * scheduled-not-due notes leave the queue entirely (mistakes and weak pull-ins
   * included — an earned interval is respected everywhere), and in-group order
   * becomes due-time asc: never-graded first (they are "overdue since forever" —
   * the REV-1 never-reviewed-first law generalized), then most-overdue first;
   * equal due-times fall back to the existing recency/age/id tie-breaks, so a
   * record-less vault orders EXACTLY like REV-1/2 on first load. Omitting `now`
   * keeps the legacy queue byte-identical — that is also the 提前复习 path.
   */
  now?: string;
  /** Session cap (REVIEW_SESSION_CAP) — trims the assembled queue, ≤0/absent = off. */
  cap?: number;
}): ReviewQueueItem<N>[] {
  const srs = input.now !== undefined;
  const now = input.now ?? "";
  const scheduleByNote: ReviewScheduleState = input.schedule ?? {};
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
    const record = srs ? scheduleByNote[note.id] : undefined;

    // SRS gate: a scheduled-not-due note is excluded EVERYWHERE (rules 1/2/3) — an
    // earned interval is respected even against the weak-bucket pull (弱项 still
    // boosts/extends among DUE items; it never drags a just-passed card back early).
    if (srs && !isDueAt(record, now)) continue;

    if (isMistakeNote(note)) {
      if (srs) {
        // SRS rule 1 — mistakes ride the SAME scheduler (no type fork): due-now
        // mistakes always queue; the reason stays explainable. Never graded AND
        // never reviewed → 新错题; last outcome fail (row or event) → 上次答错;
        // otherwise it is a scheduled recurrence (or a legacy pass/skip with no
        // row — the zero-migration "all due on first load") → 待复习.
        const failedLast = record ? record.lastResult === "fail" : lastResult === "fail";
        const reason: ReviewReason =
          !record && !last ? "mistake-new" : failedLast ? "mistake-failed" : "due";
        mistakes.push({ note, reason, lastReviewedAt, lastResult, schedule: record });
        continue;
      }
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
      due.push({ note, reason: "due", lastReviewedAt, lastResult, schedule: record });
      continue;
    }

    // Rule 3 — every other contentType is not review material under rules 1/2 (the
    // V1 law), but a weak bucket pulls it in anyway: THIS is where digests bend the
    // queue toward what the student keeps failing.
    const bucket = weakBucketOf(note);
    if (bucket) weak.push({ note, reason: `弱项:${bucket.bucket}`, lastReviewedAt, lastResult, schedule: record });
  }

  // REV-3 in-group order: due-time asc — never-graded rows sort as "" (before any
  // ISO: overdue-since-forever, the REV-1 never-reviewed-first law generalized),
  // then most-overdue first; equal due-times fall through to the recency/age/id
  // law, so a record-less (legacy) vault orders exactly like REV-1/2.
  const byDueThenRecency = (a: ReviewQueueItem<N>, b: ReviewQueueItem<N>): number => {
    const aDue = a.schedule?.due ?? "";
    const bDue = b.schedule?.due ?? "";
    if (aDue !== bDue) return aDue < bDue ? -1 : 1;
    return byRecencyThenAge(a, b);
  };
  const inGroupOrder = srs ? byDueThenRecency : byRecencyThenAge;

  // Within groups 1/2, weak-bucket members float first (the REV-2 boost), then the
  // mode's in-group order. With no weak buckets the boost is a universal tie — the
  // comparator degenerates and legacy output is REV-1-identical.
  const byWeakThenOrder = (a: ReviewQueueItem<N>, b: ReviewQueueItem<N>): number => {
    const aWeak = weakBucketOf(a.note) !== undefined;
    const bWeak = weakBucketOf(b.note) !== undefined;
    if (aWeak !== bWeak) return aWeak ? -1 : 1;
    return inGroupOrder(a, b);
  };

  mistakes.sort(byWeakThenOrder);
  due.sort(byWeakThenOrder);
  weak.sort(inGroupOrder); // all group-3 items are weak — the boost is uniform here
  const assembled = [...mistakes, ...due, ...weak];
  // The dailyish session cap (REV-3): mistakes keep priority by construction (they
  // are assembled first). ≤0/absent = uncapped (legacy + 提前复习).
  return input.cap !== undefined && input.cap > 0 ? assembled.slice(0, input.cap) : assembled;
}

// —— REV-3: header/due stats (uncapped — the cap trims sessions, not counts) ————

export type ReviewDueStats = {
  /** Notes that would enter SRS groups 1/2 right now (due or never graded). */
  due: number;
  /** Eligible notes scheduled AHEAD (their interval is still running). */
  upcoming: number;
  /** Earliest future due among `upcoming` — the 最近到期 the empty state shows. */
  nextDueAt?: string;
};

/**
 * Dueness stats over the capability-ELIGIBLE notes (mistake / review.reviewable
 * specs — exactly the rule-1/2 population; weak-bucket pull-ins are digest extras
 * and deliberately not counted). Pure + clock-injected like the queue itself.
 */
export function reviewDueStats(
  notes: readonly ReviewQueueNote[],
  schedule: ReviewScheduleState,
  now: string
): ReviewDueStats {
  let due = 0;
  let upcoming = 0;
  let nextDueAt: string | undefined;
  for (const note of notes) {
    if (!isMistakeNote(note) && !isReviewMaterial(note)) continue;
    const record = schedule[note.id];
    if (isDueAt(record, now)) {
      due += 1;
      continue;
    }
    upcoming += 1;
    const dueAt = (record as ReviewScheduleRecord).due;
    if (nextDueAt === undefined || dueAt < nextDueAt) nextDueAt = dueAt;
  }
  return { due, upcoming, nextDueAt };
}
