// Review panel IO — the panel's data edges behind ONE swappable seam (the
// capture.ts test-seam idiom), so the jsdom component tests stub network without
// touching global fetch:
//   events          — the entityClient.listMemoryEvents binding (MEM-2 landed it; this
//                     is the documented one-line swap off the interim plain fetch), so
//                     review rides the shared VaultTransport like every other data edge.
//   allNotes        — the existing entityClient.allNotes binding (全库 scope).
//   digestSummaries — [REV-2] the entityClient.memoryDigests binding folded through the
//                     core summarizer: per-bucket all-time review tallies → queue
//                     weights + the 弱项 header.
//   profileFacts    — [REV-2] the entityClient.memoryProfile binding: merged facts
//                     (incl. hidden flags) → the compact profileContext for explain.
//   generate        — the existing entityClient.generateStructured binding — the SAME
//                     /api/kits/generate dispatch every kit command uses.
//   schedule/grade  — [REV-3] the entityClient.reviewSchedule / recordReviewGrade
//                     bindings: the per-note SRS document in + one grade outcome out.

import { summarizeMemoryDigests, type MemoryDimensionSummary } from "../../core/memory/digest";
import {
  entityClient,
  type NoteRecord,
  type ProfileFactView,
  type RecordReviewGradeInput,
  type ReviewScheduleRecord,
  type ReviewScheduleState
} from "../data/entityClient";
import type { ReviewEventLike } from "./queue";

export type GenerateRequest = { promptId: string; contentType: string; input?: Record<string, unknown> };

export type ReviewIo = {
  fetchEvents(): Promise<ReviewEventLike[]>;
  fetchAllNotes(): Promise<NoteRecord[]>;
  fetchDigestSummaries(): Promise<MemoryDimensionSummary[]>;
  fetchProfileFacts(): Promise<ProfileFactView[]>;
  generate(request: GenerateRequest): Promise<{ content: unknown }>;
  /** [REV-3] The per-note SRS document. Degrades to {} — a legacy/offline vault just queues everything. */
  fetchSchedule(): Promise<ReviewScheduleState>;
  /** [REV-3] Persist one grade outcome. Degrades to null — a lost write only means an extra review later. */
  recordGrade(input: RecordReviewGradeInput): Promise<ReviewScheduleRecord | null>;
};

// The server caps the read-back at 1000 (listMemoryEventsQuerySchema) — ask for the
// max; the queue only needs the LATEST event per note, so older overflow only ever
// makes a note look less-recently-reviewed (safe degradation for V1).
async function fetchEventsViaClient(): Promise<ReviewEventLike[]> {
  try {
    return (await entityClient.listMemoryEvents({ limit: 1000 })).events;
  } catch {
    // Review must degrade, not break: no events just means "everything looks new".
    return [];
  }
}

// Both REV-2 edges share the events edge's law: review must DEGRADE, not break.
// No digests just means "no weak signal" (the queue stays REV-1); no profile just
// means "no personalization" (explain stays generic).
async function fetchDigestSummariesViaClient(): Promise<MemoryDimensionSummary[]> {
  try {
    const { digests } = await entityClient.memoryDigests();
    return summarizeMemoryDigests(digests).dimensions;
  } catch {
    return [];
  }
}

async function fetchProfileFactsViaClient(): Promise<ProfileFactView[]> {
  try {
    return (await entityClient.memoryProfile()).facts;
  } catch {
    return [];
  }
}

// REV-3 edges, same degradation law. A failed schedule read = REV-1 behavior
// (everything due); a failed grade write = the row simply doesn't advance, so the
// item returns next session — always MORE review on failure, never silence.
async function fetchScheduleViaClient(): Promise<ReviewScheduleState> {
  try {
    return (await entityClient.reviewSchedule()).schedule;
  } catch {
    return {};
  }
}

async function recordGradeViaClient(input: RecordReviewGradeInput): Promise<ReviewScheduleRecord | null> {
  try {
    return (await entityClient.recordReviewGrade(input)).schedule;
  } catch {
    return null;
  }
}

const defaultIo: ReviewIo = {
  fetchEvents: fetchEventsViaClient,
  fetchAllNotes: async () => (await entityClient.allNotes()).notes,
  fetchDigestSummaries: fetchDigestSummariesViaClient,
  fetchProfileFacts: fetchProfileFactsViaClient,
  generate: (request) => entityClient.generateStructured(request),
  fetchSchedule: fetchScheduleViaClient,
  recordGrade: recordGradeViaClient
};

let io: ReviewIo = defaultIo;

export function getReviewIo(): ReviewIo {
  return io;
}

/** Test seam: override any subset of the IO edges (null restores the real ones). */
export function setReviewIoForTests(next: Partial<ReviewIo> | null): void {
  io = next ? { ...defaultIo, ...next } : defaultIo;
}
