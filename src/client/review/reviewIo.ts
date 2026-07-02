// Review panel IO — the panel's three data edges behind ONE swappable seam (the
// capture.ts test-seam idiom), so the jsdom component tests stub network without
// touching global fetch:
//   events   — the entityClient.listMemoryEvents binding (MEM-2 landed it; this is
//              the documented one-line swap off the interim plain fetch), so review
//              rides the shared VaultTransport like every other data edge.
//   allNotes — the existing entityClient.allNotes binding (全库 scope).
//   generate — the existing entityClient.generateStructured binding — the SAME
//              /api/kits/generate dispatch every kit command uses.

import { entityClient, type NoteRecord } from "../data/entityClient";
import type { ReviewEventLike } from "./queue";

export type GenerateRequest = { promptId: string; contentType: string; input?: Record<string, unknown> };

export type ReviewIo = {
  fetchEvents(): Promise<ReviewEventLike[]>;
  fetchAllNotes(): Promise<NoteRecord[]>;
  generate(request: GenerateRequest): Promise<{ content: unknown }>;
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

const defaultIo: ReviewIo = {
  fetchEvents: fetchEventsViaClient,
  fetchAllNotes: async () => (await entityClient.allNotes()).notes,
  generate: (request) => entityClient.generateStructured(request)
};

let io: ReviewIo = defaultIo;

export function getReviewIo(): ReviewIo {
  return io;
}

/** Test seam: override any subset of the IO edges (null restores the real ones). */
export function setReviewIoForTests(next: Partial<ReviewIo> | null): void {
  io = next ? { ...defaultIo, ...next } : defaultIo;
}
