// Onboarding checklist steps (SHELL-2, docs/design/app-shell-ux.md §2) — the SIX
// steps 导入文档 → 接入 AI → 做笔记 → 看分层 → 导入笔记 → 复习, each with a PURE
// done-detection over an injected data snapshot (no DOM spying, no fetching here —
// the panel assembles the snapshot through its io seam and ctx).
//
// Done-detection sources, honestly stated:
//   • import-doc   — sources exist (vault data).
//   • connect-ai   — the ACTIVE provider kind ≠ "mock" (the A1 registry readout).
//   • first-note   — any note exists (vault data).
//   • see-layers   — the doc wanted "any layer.toggle memory event", but MEM-1's verb
//     enum is CLOSED and layer.toggle is DELIBERATELY unmapped (commandCapture.ts) —
//     no layer verb exists. Substitute (the doc's own fallback rule: pure functions
//     over vault state): a layer currently toggled OFF, or a user-created custom
//     layer, on the active source — direct evidence the Layers surface was used.
//   • import-pack  — a sealed .svpack import exists (vault-wide) OR an imported
//     (.studypack) layer is visible on the active source.
//   • review-once  — any note.review memory event (MEM-1 verb; read via the
//     listMemoryEvents binding).
// Completions LATCH into the persisted `doneSteps` (prefs block), so deleting data
// later never un-ticks a step.

import type { OnboardingState } from "../data/entityClient";
import { defineMessages, type LocalizedText } from "../i18n";

/** The layer facts a predicate needs (a StudyLayerRecord subset — injectable). */
export type OnboardingLayerFacts = {
  enabled: boolean;
  importMode?: string;
  role?: string;
  sealed?: boolean;
};

/** Everything the six predicates read — assembled by the panel, injected here. */
export type OnboardingSnapshot = {
  /** All sources in the vault. */
  sourceCount: number;
  /** All notes in the vault (GET /api/notes). */
  noteCount: number;
  /** The ACTIVE provider kind ("mock" | "cli-agent" | "http" | "managed"), or null when unknown. */
  providerKind: string | null;
  /** Layers of the ACTIVE source (owned + presets + custom + imported). */
  layers: OnboardingLayerFacts[];
  /** Installed sealed .svpack imports, vault-wide. */
  sealedPackCount: number;
  /** Trash items available for recovery. */
  trashItemCount: number;
  /** TTS read-aloud capability is available. */
  speechAvailable: boolean;
  /** Persisted chat sessions in the vault. */
  chatSessionCount: number;
  /** Memory events read-back (verbs only — that is all detection needs). */
  events: Array<{ verb: string }>;
};

export type OnboardingStepId =
  | "import-doc"
  | "new-document"
  | "search-vault"
  | "connect-ai"
  | "first-note"
  | "speech-tools"
  | "see-layers"
  | "trash-recovery"
  | "import-pack"
  | "chat-history"
  | "review-once";

export type OnboardingStep = {
  id: OnboardingStepId;
  title: LocalizedText;
  /** The 一句话 explainer under the title. */
  hint: LocalizedText;
  /** Label of the 带我去 action button. */
  goLabel: LocalizedText;
  done(snapshot: OnboardingSnapshot): boolean;
};

const onboardingStepMessages = defineMessages({
  importDocTitle: { zh: "导入第一个文档", en: "Import Your First Document" },
  importDocHint: {
    zh: "把一份 HTML/PDF/网页导入进来，阅读就从这里开始。",
    en: "Import an HTML, PDF, or web page to start reading here."
  },
  importDocGo: { zh: "去导入", en: "Import" },
  newDocumentTitle: { zh: "新建一篇文档", en: "Create a New Document" },
  newDocumentHint: {
    zh: "从资料库新建空白文档，把自己的摘录、题目或草稿先放进来。",
    en: "Create a blank document from Library for your own excerpts, questions, or drafts."
  },
  newDocumentGo: { zh: "去新建", en: "Create" },
  searchTitle: { zh: "用 Ctrl+K 搜索", en: "Search with Ctrl+K" },
  searchHint: {
    zh: "全局搜索可以找笔记、文档，也可以直接打开常用命令。",
    en: "Global search finds notes, documents, and common commands."
  },
  searchGo: { zh: "看快捷键", en: "See Shortcuts" },
  connectAiTitle: { zh: "接入 AI", en: "Connect AI" },
  connectAiHint: {
    zh: "在设置里查看检测到的提供方（本地 CLI/API Key）。",
    en: "Check detected providers in Settings, including local CLI or API keys."
  },
  connectAiGo: { zh: "打开设置", en: "Open Settings" },
  firstNoteTitle: { zh: "做第一条笔记", en: "Create Your First Note" },
  firstNoteHint: {
    zh: "在阅读器里选中一段文字，用浮动工具栏记一条笔记。",
    en: "Select text in the reader and create a note from the floating toolbar."
  },
  firstNoteGo: { zh: "打开文档试试", en: "Try in a Document" },
  speechTitle: { zh: "试试朗读和注音", en: "Try Read-Aloud and Pinyin" },
  speechHint: {
    zh: "选中文本后可以朗读，也可以给生字加拼音。",
    en: "Select text to hear it read aloud or show pinyin for Chinese characters."
  },
  speechGo: { zh: "打开语音设置", en: "Open Speech Settings" },
  layersTitle: { zh: "看分层", en: "Explore Layers" },
  layersHint: {
    zh: "打开层列表，试着开关一个层，笔记会按层过滤。",
    en: "Open Layers and toggle a layer to filter notes by layer."
  },
  layersGo: { zh: "打开层列表", en: "Open Layers" },
  trashTitle: { zh: "认识回收站", en: "Know the Trash" },
  trashHint: {
    zh: "误删的文档和笔记可以在回收站找回。",
    en: "Deleted documents and notes can be restored from Trash."
  },
  trashGo: { zh: "打开回收站", en: "Open Trash" },
  importPackTitle: { zh: "导入笔记/分享包", en: "Import Notes / Share Pack" },
  importPackHint: {
    zh: "导入别人分享的 .svpack，笔记会作为独立的层出现。",
    en: "Import a shared .svpack; its notes appear as a separate layer."
  },
  importPackGo: { zh: "导入 .svpack", en: "Import .svpack" },
  chatHistoryTitle: { zh: "查看会话历史", en: "Use Chat History" },
  chatHistoryHint: {
    zh: "AI 对话会保存成会话，之后可以继续同一个学习上下文。",
    en: "AI chats are saved as sessions so you can continue the same study context later."
  },
  chatHistoryGo: { zh: "打开 AI 对话", en: "Open AI Chat" },
  reviewTitle: { zh: "复习一次", en: "Run a Review" },
  reviewHint: {
    zh: "打开复习面板过一轮，错题/闪卡/小测会自动排队。",
    en: "Open Review and run a round; mistakes, flashcards, and quizzes queue automatically."
  },
  reviewGo: { zh: "去复习", en: "Review" }
});

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: "import-doc",
    title: onboardingStepMessages.importDocTitle,
    hint: onboardingStepMessages.importDocHint,
    goLabel: onboardingStepMessages.importDocGo,
    done: (snapshot) => snapshot.sourceCount > 0
  },
  {
    id: "new-document",
    title: onboardingStepMessages.newDocumentTitle,
    hint: onboardingStepMessages.newDocumentHint,
    goLabel: onboardingStepMessages.newDocumentGo,
    done: (snapshot) => snapshot.sourceCount > 0
  },
  {
    id: "search-vault",
    title: onboardingStepMessages.searchTitle,
    hint: onboardingStepMessages.searchHint,
    goLabel: onboardingStepMessages.searchGo,
    done: (snapshot) => snapshot.events.some((event) => event.verb === "search")
  },
  {
    id: "connect-ai",
    title: onboardingStepMessages.connectAiTitle,
    hint: onboardingStepMessages.connectAiHint,
    goLabel: onboardingStepMessages.connectAiGo,
    done: (snapshot) => snapshot.providerKind !== null && snapshot.providerKind !== "mock"
  },
  {
    id: "first-note",
    title: onboardingStepMessages.firstNoteTitle,
    hint: onboardingStepMessages.firstNoteHint,
    goLabel: onboardingStepMessages.firstNoteGo,
    done: (snapshot) => snapshot.noteCount > 0
  },
  {
    id: "speech-tools",
    title: onboardingStepMessages.speechTitle,
    hint: onboardingStepMessages.speechHint,
    goLabel: onboardingStepMessages.speechGo,
    done: (snapshot) => snapshot.speechAvailable
  },
  {
    id: "see-layers",
    title: onboardingStepMessages.layersTitle,
    hint: onboardingStepMessages.layersHint,
    goLabel: onboardingStepMessages.layersGo,
    done: (snapshot) =>
      snapshot.layers.some((layer) => !layer.enabled) ||
      snapshot.layers.some((layer) => layer.role === "custom")
  },
  {
    id: "trash-recovery",
    title: onboardingStepMessages.trashTitle,
    hint: onboardingStepMessages.trashHint,
    goLabel: onboardingStepMessages.trashGo,
    done: (snapshot) => snapshot.trashItemCount > 0
  },
  {
    id: "import-pack",
    title: onboardingStepMessages.importPackTitle,
    hint: onboardingStepMessages.importPackHint,
    goLabel: onboardingStepMessages.importPackGo,
    done: (snapshot) =>
      snapshot.sealedPackCount > 0 ||
      snapshot.layers.some((layer) => layer.importMode === "imported" || layer.sealed === true)
  },
  {
    id: "chat-history",
    title: onboardingStepMessages.chatHistoryTitle,
    hint: onboardingStepMessages.chatHistoryHint,
    goLabel: onboardingStepMessages.chatHistoryGo,
    done: (snapshot) => snapshot.chatSessionCount > 0
  },
  {
    id: "review-once",
    title: onboardingStepMessages.reviewTitle,
    hint: onboardingStepMessages.reviewHint,
    goLabel: onboardingStepMessages.reviewGo,
    done: (snapshot) => snapshot.events.some((event) => event.verb === "note.review")
  }
];

/** Latched-or-live done: persisted doneSteps win, else the pure predicate. */
export function stepEffectiveDone(
  step: OnboardingStep,
  state: Pick<OnboardingState, "doneSteps">,
  snapshot: OnboardingSnapshot
): boolean {
  return state.doneSteps.includes(step.id) || step.done(snapshot);
}

/** All six done (drives `completedAt`). */
export function allStepsDone(state: Pick<OnboardingState, "doneSteps">, snapshot: OnboardingSnapshot): boolean {
  return ONBOARDING_STEPS.every((step) => stepEffectiveDone(step, state, snapshot));
}

/**
 * The persistence step (pure): latch newly-done steps into `doneSteps` and stamp
 * `completedAt` the first time all six are done. Returns null when the stored state
 * already reflects the snapshot — the caller then skips the PUT entirely.
 */
export function nextPersistedState(
  prev: OnboardingState,
  snapshot: OnboardingSnapshot,
  nowIso: string
): OnboardingState | null {
  const doneIds = ONBOARDING_STEPS.filter((step) => stepEffectiveDone(step, prev, snapshot)).map(
    (step) => step.id as string
  );
  const newIds = doneIds.filter((id) => !prev.doneSteps.includes(id));
  const complete = doneIds.length === ONBOARDING_STEPS.length;
  const needsCompletion = complete && prev.completedAt === null;
  if (newIds.length === 0 && !needsCompletion) return null;
  return {
    ...prev,
    doneSteps: [...prev.doneSteps, ...newIds],
    completedAt: needsCompletion ? nowIso : prev.completedAt
  };
}

/**
 * First-run predicate (§2): auto-open ONLY on a fresh vault (no sources) that has
 * never seen the checklist (no dismiss, never completed). Any flag wins over "fresh".
 */
export function shouldAutoOpenOnboarding(input: {
  sourceCount: number;
  onboarding: Pick<OnboardingState, "dismissed" | "completedAt">;
}): boolean {
  if (input.onboarding.dismissed || input.onboarding.completedAt !== null) return false;
  return input.sourceCount === 0;
}

/**
 * Locate an already-seeded sample doc (idempotent 载入示例文档): the remembered
 * sampleSourceId wins; else match the sample's well-known title.
 */
export function findSampleSource<T extends { id: string; title: string }>(
  sources: readonly T[],
  state: Pick<OnboardingState, "sampleSourceId">,
  sampleTitle: string
): T | null {
  const byId = state.sampleSourceId ? sources.find((source) => source.id === state.sampleSourceId) : undefined;
  return byId ?? sources.find((source) => source.title === sampleTitle) ?? null;
}
