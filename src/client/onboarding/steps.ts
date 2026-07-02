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
  /** Memory events read-back (verbs only — that is all detection needs). */
  events: Array<{ verb: string }>;
};

export type OnboardingStepId =
  | "import-doc"
  | "connect-ai"
  | "first-note"
  | "see-layers"
  | "import-pack"
  | "review-once";

export type OnboardingStep = {
  id: OnboardingStepId;
  title: string;
  /** The 一句话 explainer under the title. */
  hint: string;
  /** Label of the 带我去 action button. */
  goLabel: string;
  done(snapshot: OnboardingSnapshot): boolean;
};

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: "import-doc",
    title: "导入第一个文档",
    hint: "把一份 HTML/PDF/网页导入进来,阅读就从这里开始。",
    goLabel: "去导入",
    done: (snapshot) => snapshot.sourceCount > 0
  },
  {
    id: "connect-ai",
    title: "接入 AI",
    hint: "在设置里查看检测到的提供方(本地 CLI/API Key)。",
    goLabel: "打开设置",
    done: (snapshot) => snapshot.providerKind !== null && snapshot.providerKind !== "mock"
  },
  {
    id: "first-note",
    title: "做第一条笔记",
    hint: "在阅读器里选中一段文字,用浮动工具栏记一条笔记。",
    goLabel: "打开文档试试",
    done: (snapshot) => snapshot.noteCount > 0
  },
  {
    id: "see-layers",
    title: "看分层",
    hint: "打开层列表,试着开关一个层,笔记会按层过滤。",
    goLabel: "打开层列表",
    done: (snapshot) =>
      snapshot.layers.some((layer) => !layer.enabled) ||
      snapshot.layers.some((layer) => layer.role === "custom")
  },
  {
    id: "import-pack",
    title: "导入笔记/分享包",
    hint: "导入别人分享的 .svpack,笔记会作为独立的层出现。",
    goLabel: "导入 .svpack",
    done: (snapshot) =>
      snapshot.sealedPackCount > 0 ||
      snapshot.layers.some((layer) => layer.importMode === "imported" || layer.sealed === true)
  },
  {
    id: "review-once",
    title: "复习一次",
    hint: "打开复习面板过一轮,错题/闪卡/小测会自动排队。",
    goLabel: "去复习",
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
