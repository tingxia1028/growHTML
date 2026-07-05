// Teach-back panel IO — the runner's data edges behind ONE swappable seam (the reviewIo
// idiom), so the jsdom panel test stubs network without touching global fetch:
//   generate         — the EXISTING entityClient.generateStructured binding — the SAME
//                      /api/kits/generate dispatch every kit command uses (the STRUCTURED
//                      seam; the mock echoes each prompt's mockContent). NO chat route:
//                      teach-back rides structured generation only, so profileContext
//                      auto-gates server-side (applyProfileContextGate) exactly like
//                      review.explain — no leak lane.
//   digestSummaries  — entityClient.memoryDigests → the weak buckets the topic-pick +
//                      the probe's weakestTopic steer on (MEM-2/MEM-3).
//   profileFacts     — entityClient.memoryProfile → the compact profileContext appended
//                      to pose/probe (auto-gated for managed providers).
// Every edge DEGRADES, not breaks (the reviewIo law): no digests → no topics → the
// delta-5 empty state; no profile → generic (unpersonalized) confusion.

import { summarizeMemoryDigests, type MemoryDimensionSummary } from "../../core/memory/digest";
import { entityClient, type ProfileFactView } from "../../client/data/entityClient";

export type TeachbackGenerateRequest = {
  promptId: string;
  contentType: string;
  input?: Record<string, unknown>;
};

export type TeachbackIo = {
  /** Structured generation (mock echoes the prompt's mockContent) — the ONLY AI edge. */
  generate(request: TeachbackGenerateRequest): Promise<{ content: unknown }>;
  /** Weak-bucket digest summaries → topic candidates + the probe's weakest topic. */
  fetchDigestSummaries(): Promise<MemoryDimensionSummary[]>;
  /** The learner profile facts → the compact profileContext (auto-gated). */
  fetchProfileFacts(): Promise<ProfileFactView[]>;
};

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

const defaultIo: TeachbackIo = {
  generate: (request) => entityClient.generateStructured(request),
  fetchDigestSummaries: fetchDigestSummariesViaClient,
  fetchProfileFacts: fetchProfileFactsViaClient
};

let io: TeachbackIo = defaultIo;

export function getTeachbackIo(): TeachbackIo {
  return io;
}

/** Test seam: override any subset of the IO edges (null restores the real ones). */
export function setTeachbackIoForTests(next: Partial<TeachbackIo> | null): void {
  io = next ? { ...defaultIo, ...next } : defaultIo;
}
