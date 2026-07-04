// Onboarding IO — the checklist's data edges behind ONE swappable seam (the
// profileIo / reviewIo idiom). Detection reads + the prefs block roundtrip + the
// sample-doc seed all go through existing entityClient bindings; the panel never
// calls fetch. Failures of DETECTION edges degrade to "not done yet" (the panel
// treats them as empty), never to a crash.

import {
  entityClient,
  type AiProvidersInfo,
  type MemoryEventRow,
  type NoteRecord,
  type OnboardingState,
  type SealedPackRow,
  type SourceRecord
} from "../data/entityClient";
import { getSpeechStatus, type SpeechStatusView } from "../speech/speechStatus";
import { getChatSessionIo, type ChatSessionSummary } from "../chat/sessionClient";
import { getTrashIo, type TrashListing } from "../workspace/trashIo";

export type OnboardingIo = {
  /** GET /api/workspace/onboarding — the persisted checklist block. */
  fetchState(): Promise<OnboardingState>;
  /** PUT /api/workspace/onboarding — the checklist's OWN write seam (no clobber). */
  saveState(state: OnboardingState): Promise<unknown>;
  /** GET /api/notes — vault-wide note count for 做第一条笔记. */
  fetchAllNotes(): Promise<NoteRecord[]>;
  /** GET /api/memory/events — note.review detection for 复习一次. */
  fetchEvents(): Promise<MemoryEventRow[]>;
  /** GET /api/svpack — sealed imports for 导入笔记/分享包. */
  fetchSealedPacks(): Promise<SealedPackRow[]>;
  /** GET /api/trash — deleted item count for the recovery step. */
  fetchTrash(): Promise<TrashListing>;
  /** GET /api/speech/status — read-aloud availability. */
  fetchSpeechStatus(): Promise<SpeechStatusView>;
  /** GET /api/chat/sessions — saved chat history summaries. */
  fetchChatSessions(): Promise<ChatSessionSummary[]>;
  /** GET /api/ai/providers — active provider kind for 接入 AI. */
  fetchProviders(): Promise<AiProvidersInfo>;
  /** POST /api/sources/html — seed the sample doc (载入示例文档). */
  seedSample(title: string, content: string): Promise<SourceRecord>;
};

const defaultIo: OnboardingIo = {
  fetchState: () => entityClient.onboardingState().then(({ onboarding }) => onboarding),
  saveState: (state) => entityClient.putOnboardingState(state),
  fetchAllNotes: () => entityClient.allNotes().then(({ notes }) => notes),
  fetchEvents: () => entityClient.listMemoryEvents({ limit: 1000 }).then(({ events }) => events),
  fetchSealedPacks: () => entityClient.sealedImports().then(({ packs }) => packs),
  fetchTrash: () => getTrashIo().fetchTrash(),
  fetchSpeechStatus: () => getSpeechStatus(),
  fetchChatSessions: () => getChatSessionIo().list().then(({ sessions }) => sessions),
  fetchProviders: () => entityClient.aiProviders(),
  seedSample: (title, content) => entityClient.ingestHtml(title, content).then(({ source }) => source)
};

let io: OnboardingIo = defaultIo;

export function getOnboardingIo(): OnboardingIo {
  return io;
}

/** Test seam: override any subset of the IO edges (null restores the real ones). */
export function setOnboardingIoForTests(next: Partial<OnboardingIo> | null): void {
  io = next ? { ...defaultIo, ...next } : defaultIo;
}
