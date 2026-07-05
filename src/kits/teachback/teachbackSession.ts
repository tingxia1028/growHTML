// Teach-back session reducer (PRO-2) — a PURE, React-free state machine that drives the
// runner panel (the ReviewPanel index/state discipline, but as a reducer: no React, no
// clock, no I/O). The panel dispatches actions as AI/student turns arrive; the reducer
// owns the phase transitions + the round cap so the flow is deterministic + unit-testable
// without a DOM. All AI I/O rides teachbackIo.ts; this file never generates.
//
// Phases: picking → posing → explaining → probing → assessing → done.
//   picking   — the initial state; the panel offers topic candidates (weakReviewBuckets)
//   empty     — no topics (fresh vault, weakReviewBuckets []) → the delta-5 empty state
//   posing    — a topic was picked; awaiting the AI's opening pose (teach.pose)
//   explaining— the AI posed; awaiting the student's typed explanation
//   probing   — the student explained; awaiting the AI's follow-up probe (teach.probe),
//               bounded to TEACHBACK_MAX_ROUNDS probes
//   assessing — the round cap hit (or the student ended); awaiting the wrap-up
//   done      — the wrap-up landed (the summary is ready to persist)

import type { TeachbackSummaryContent, TeachbackTurnContent } from "./contentTypes";
import { weakReviewBuckets, type ReviewDigestSummaryLike } from "../../client/review/queue";

/** How many topic candidates the pick offers (the strongest weak buckets). */
export const TEACHBACK_TOPIC_LIMIT = 5;

/**
 * Derive teach-back TOPIC candidates from MEM-2 weak buckets (the review queue's own
 * 弱项 rule — imported, not duplicated, so "weak" means the same everywhere). Human
 * buckets first (subject/contentType — a person can teach "浮力", not a sourceId), then
 * capped. Empty on a fresh vault (weakReviewBuckets [] — queue.ts) → the panel's delta-5
 * empty state. PURE.
 */
export function pickTopics(summaries: readonly ReviewDigestSummaryLike[]): string[] {
  const seen = new Set<string>();
  const topics: string[] = [];
  for (const bucket of weakReviewBuckets(summaries)) {
    if (bucket.dimension === "sourceId") continue; // not human-teachable as a topic
    if (seen.has(bucket.bucket)) continue;
    seen.add(bucket.bucket);
    topics.push(bucket.bucket);
    if (topics.length >= TEACHBACK_TOPIC_LIMIT) break;
  }
  return topics;
}

/** Max PROBE rounds before the session wraps up (the REVIEW_SESSION_CAP idiom). */
export const TEACHBACK_MAX_ROUNDS = 3;

export type TeachbackPhase =
  | "picking"
  | "empty"
  | "posing"
  | "explaining"
  | "probing"
  | "assessing"
  | "done";

export type TeachbackSession = {
  phase: TeachbackPhase;
  /** The topic being taught (empty until picked). */
  topic: string;
  /** Candidate topics (weakReviewBuckets bucket names) offered at pick time. */
  topics: string[];
  /** The transcript so far, in order. */
  turns: TeachbackTurnContent[];
  /** How many PROBE rounds have completed (0..TEACHBACK_MAX_ROUNDS). */
  round: number;
  /** The assembled wrap-up summary (present once phase === "done"). */
  wrapUp: TeachbackSummaryContent | null;
};

export type TeachbackAction =
  /** Seed the session with the candidate topics (empty ⇒ the delta-5 empty state). */
  | { type: "init"; topics: string[] }
  /** The user picked a topic → posing. */
  | { type: "pick"; topic: string }
  /** The AI's opening pose arrived → explaining. */
  | { type: "posed"; turn: TeachbackTurnContent }
  /** The student submitted an explanation → probing (or assessing at the cap). */
  | { type: "explain"; text: string }
  /** The AI's follow-up probe arrived → explaining again (round incremented on explain). */
  | { type: "probed"; turn: TeachbackTurnContent }
  /** The user ended early → assessing. */
  | { type: "end" }
  /** The wrap-up summary was assembled → done. */
  | { type: "wrapped"; summary: TeachbackSummaryContent };

export function initialSession(): TeachbackSession {
  return { phase: "picking", topic: "", topics: [], turns: [], round: 0, wrapUp: null };
}

/** The student explanation snippets (their `explain` turns), in order. */
export function studentPoints(session: TeachbackSession): string[] {
  return session.turns.filter((t) => t.role === "student").map((t) => t.text).filter((t) => t.length > 0);
}

/** The AI probe topics still open (the probes' text — what the AI stayed confused about). */
export function openGaps(session: TeachbackSession): string[] {
  return session.turns.filter((t) => t.role === "ai" && t.kind === "probe").map((t) => t.text);
}

/** Whether the probe cap has been reached (the next explain must go to assessing). */
export function atRoundCap(session: TeachbackSession): boolean {
  return session.round >= TEACHBACK_MAX_ROUNDS;
}

// The pure transition. Illegal actions for the current phase are no-ops (return the
// same state) so a double-dispatch or a stray callback can never corrupt the flow.
export function teachbackReducer(session: TeachbackSession, action: TeachbackAction): TeachbackSession {
  switch (action.type) {
    case "init": {
      // Fresh seed → picking, unless there are no topics (delta 5: the empty state).
      const topics = action.topics.filter((t) => t.trim().length > 0);
      return {
        ...initialSession(),
        topics,
        phase: topics.length === 0 ? "empty" : "picking"
      };
    }

    case "pick": {
      const topic = action.topic.trim();
      if (!topic || (session.phase !== "picking" && session.phase !== "empty")) return session;
      return { ...session, phase: "posing", topic, turns: [], round: 0, wrapUp: null };
    }

    case "posed": {
      if (session.phase !== "posing") return session;
      return { ...session, phase: "explaining", turns: [...session.turns, action.turn] };
    }

    case "explain": {
      if (session.phase !== "explaining") return session;
      const text = action.text.trim();
      if (!text) return session;
      const turn: TeachbackTurnContent = {
        role: "student",
        kind: "explain",
        text,
        topic: session.topic,
        round: session.round
      };
      const turns = [...session.turns, turn];
      // One explanation completes a probe round. At the cap → assessing (wrap-up next);
      // otherwise → probing (the AI asks the next follow-up).
      const round = session.round + 1;
      return {
        ...session,
        turns,
        round,
        phase: round >= TEACHBACK_MAX_ROUNDS ? "assessing" : "probing"
      };
    }

    case "probed": {
      if (session.phase !== "probing") return session;
      return { ...session, phase: "explaining", turns: [...session.turns, action.turn] };
    }

    case "end": {
      // End early from any active phase → assessing (unless already done/empty/picking).
      if (session.phase === "explaining" || session.phase === "probing" || session.phase === "posing") {
        return { ...session, phase: "assessing" };
      }
      return session;
    }

    case "wrapped": {
      if (session.phase !== "assessing") return session;
      return { ...session, phase: "done", wrapUp: action.summary };
    }

    default:
      return session;
  }
}
