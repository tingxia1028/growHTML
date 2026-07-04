// Onboarding steps (SHELL-2) — the PURE layer: each of the six done-detections over
// an injected snapshot, the first-run predicate (fresh vs existing vault vs flags),
// the latch/complete persistence derivation, and the idempotent sample-doc lookup.

import { describe, expect, it } from "vitest";
import type { OnboardingState } from "../data/entityClient";
import {
  ONBOARDING_STEPS,
  allStepsDone,
  findSampleSource,
  nextPersistedState,
  shouldAutoOpenOnboarding,
  stepEffectiveDone,
  type OnboardingSnapshot
} from "./steps";

const EMPTY: OnboardingSnapshot = {
  sourceCount: 0,
  noteCount: 0,
  providerKind: null,
  layers: [],
  sealedPackCount: 0,
  trashItemCount: 0,
  speechAvailable: false,
  chatSessionCount: 0,
  events: []
};

const state = (over: Partial<OnboardingState> = {}): OnboardingState => ({
  dismissed: false,
  completedAt: null,
  doneSteps: [],
  sampleSourceId: null,
  ...over
});

const step = (id: string) => ONBOARDING_STEPS.find((s) => s.id === id)!;

describe("onboarding step done-detection (pure)", () => {
  it("lists exactly the six designed steps, in the doc's order", () => {
    expect(ONBOARDING_STEPS.map((s) => s.id)).toEqual([
      "import-doc",
      "new-document",
      "search-vault",
      "connect-ai",
      "first-note",
      "speech-tools",
      "see-layers",
      "trash-recovery",
      "import-pack",
      "chat-history",
      "review-once"
    ]);
  });

  it("import-doc: any source in the vault", () => {
    expect(step("import-doc").done(EMPTY)).toBe(false);
    expect(step("import-doc").done({ ...EMPTY, sourceCount: 1 })).toBe(true);
  });

  it("new-document: any source in the vault", () => {
    expect(step("new-document").done(EMPTY)).toBe(false);
    expect(step("new-document").done({ ...EMPTY, sourceCount: 1 })).toBe(true);
  });

  it("search-vault: any captured search command", () => {
    expect(step("search-vault").done(EMPTY)).toBe(false);
    expect(step("search-vault").done({ ...EMPTY, events: [{ verb: "note.review" }] })).toBe(false);
    expect(step("search-vault").done({ ...EMPTY, events: [{ verb: "search" }] })).toBe(true);
  });

  it("connect-ai: a NON-mock active provider; unknown/mock stays undone", () => {
    expect(step("connect-ai").done(EMPTY)).toBe(false); // unknown
    expect(step("connect-ai").done({ ...EMPTY, providerKind: "mock" })).toBe(false);
    expect(step("connect-ai").done({ ...EMPTY, providerKind: "cli-agent" })).toBe(true);
    expect(step("connect-ai").done({ ...EMPTY, providerKind: "http" })).toBe(true);
  });

  it("first-note: any note in the vault", () => {
    expect(step("first-note").done(EMPTY)).toBe(false);
    expect(step("first-note").done({ ...EMPTY, noteCount: 3 })).toBe(true);
  });

  it("speech-tools: read-aloud support is available", () => {
    expect(step("speech-tools").done(EMPTY)).toBe(false);
    expect(step("speech-tools").done({ ...EMPTY, speechAvailable: true })).toBe(true);
  });

  it("see-layers: a toggled-OFF layer or a custom layer (the vault-state substitute — no layer verb exists in MEM-1)", () => {
    expect(step("see-layers").done(EMPTY)).toBe(false);
    // All-default enabled layers (owned + presets) are NOT evidence.
    expect(step("see-layers").done({ ...EMPTY, layers: [{ enabled: true }, { enabled: true, role: "preset" }] })).toBe(
      false
    );
    expect(step("see-layers").done({ ...EMPTY, layers: [{ enabled: true }, { enabled: false }] })).toBe(true);
    expect(step("see-layers").done({ ...EMPTY, layers: [{ enabled: true, role: "custom" }] })).toBe(true);
  });

  it("import-pack: a sealed .svpack import OR an imported (.studypack) layer", () => {
    expect(step("import-pack").done(EMPTY)).toBe(false);
    expect(step("import-pack").done({ ...EMPTY, sealedPackCount: 1 })).toBe(true);
    expect(step("import-pack").done({ ...EMPTY, layers: [{ enabled: true, importMode: "imported" }] })).toBe(true);
    expect(step("import-pack").done({ ...EMPTY, layers: [{ enabled: true, sealed: true }] })).toBe(true);
    expect(step("import-pack").done({ ...EMPTY, layers: [{ enabled: true, importMode: "owned" }] })).toBe(false);
  });

  it("trash-recovery: any recoverable trash item", () => {
    expect(step("trash-recovery").done(EMPTY)).toBe(false);
    expect(step("trash-recovery").done({ ...EMPTY, trashItemCount: 1 })).toBe(true);
  });

  it("chat-history: any persisted chat session", () => {
    expect(step("chat-history").done(EMPTY)).toBe(false);
    expect(step("chat-history").done({ ...EMPTY, chatSessionCount: 1 })).toBe(true);
  });

  it("review-once: any note.review memory event (the MEM-1 verb the ReviewPanel emits)", () => {
    expect(step("review-once").done(EMPTY)).toBe(false);
    expect(step("review-once").done({ ...EMPTY, events: [{ verb: "note.create" }] })).toBe(false);
    expect(step("review-once").done({ ...EMPTY, events: [{ verb: "note.create" }, { verb: "note.review" }] })).toBe(true);
  });

  it("stepEffectiveDone latches: a persisted doneStep stays done even when the data is gone", () => {
    const snapshotWithoutNotes = EMPTY;
    expect(stepEffectiveDone(step("first-note"), state(), snapshotWithoutNotes)).toBe(false);
    expect(stepEffectiveDone(step("first-note"), state({ doneSteps: ["first-note"] }), snapshotWithoutNotes)).toBe(true);
  });
});

describe("shouldAutoOpenOnboarding (first-run predicate)", () => {
  it("opens on a FRESH vault with a pristine block", () => {
    expect(shouldAutoOpenOnboarding({ sourceCount: 0, onboarding: state() })).toBe(true);
  });

  it("never opens on an existing vault (sources present)", () => {
    expect(shouldAutoOpenOnboarding({ sourceCount: 2, onboarding: state() })).toBe(false);
  });

  it("never opens once dismissed — even on a fresh vault", () => {
    expect(shouldAutoOpenOnboarding({ sourceCount: 0, onboarding: state({ dismissed: true }) })).toBe(false);
  });

  it("never opens once completed", () => {
    expect(
      shouldAutoOpenOnboarding({
        sourceCount: 0,
        onboarding: state({ completedAt: "2026-07-02T00:00:00.000Z" })
      })
    ).toBe(false);
  });
});

describe("nextPersistedState (latch + completion derivation)", () => {
  it("returns null when the stored state already reflects the snapshot (no useless PUT)", () => {
    expect(nextPersistedState(state(), EMPTY, "2026-07-02T00:00:00.000Z")).toBeNull();
    expect(
      nextPersistedState(
        state({ doneSteps: ["import-doc", "new-document"] }),
        { ...EMPTY, sourceCount: 1 },
        "2026-07-02T00:00:00.000Z"
      )
    ).toBeNull();
  });

  it("latches newly-done steps while preserving previously latched ones", () => {
    const next = nextPersistedState(
      state({ doneSteps: ["import-doc", "new-document"] }),
      { ...EMPTY, sourceCount: 1, noteCount: 1 },
      "2026-07-02T00:00:00.000Z"
    );
    expect(next).not.toBeNull();
    expect(next!.doneSteps).toEqual(["import-doc", "new-document", "first-note"]);
    expect(next!.completedAt).toBeNull();
  });

  it("stamps completedAt exactly once when all steps are done", () => {
    const fullSnapshot: OnboardingSnapshot = {
      sourceCount: 1,
      noteCount: 1,
      providerKind: "cli-agent",
      layers: [{ enabled: false }, { enabled: true, importMode: "imported" }],
      sealedPackCount: 1,
      trashItemCount: 1,
      speechAvailable: true,
      chatSessionCount: 1,
      events: [{ verb: "search" }, { verb: "note.review" }]
    };
    const first = nextPersistedState(state(), fullSnapshot, "2026-07-02T10:00:00.000Z");
    expect(first!.completedAt).toBe("2026-07-02T10:00:00.000Z");
    expect(allStepsDone(first!, fullSnapshot)).toBe(true);

    // Already complete → nothing more to persist (completedAt never re-stamps).
    expect(nextPersistedState(first!, fullSnapshot, "2026-07-03T00:00:00.000Z")).toBeNull();
  });
});

describe("findSampleSource (idempotent 载入示例文档)", () => {
  const sources = [
    { id: "src_1", title: "别的文档" },
    { id: "src_2", title: "示例文档 · Pressure in Liquids" }
  ];

  it("prefers the remembered sampleSourceId", () => {
    expect(findSampleSource(sources, state({ sampleSourceId: "src_1" }), "示例文档 · Pressure in Liquids")!.id).toBe(
      "src_1"
    );
  });

  it("falls back to the well-known sample title, else null", () => {
    expect(findSampleSource(sources, state(), "示例文档 · Pressure in Liquids")!.id).toBe("src_2");
    expect(findSampleSource([sources[0]], state(), "示例文档 · Pressure in Liquids")).toBeNull();
  });

  it("ignores a stale remembered id (sample was deleted) and re-matches by title", () => {
    expect(findSampleSource(sources, state({ sampleSourceId: "src_gone" }), "示例文档 · Pressure in Liquids")!.id).toBe(
      "src_2"
    );
  });
});
