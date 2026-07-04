// Onboarding checklist panel (SHELL-2, docs/design/app-shell-ux.md §2) — the V1
// welcome CHECKLIST (not a spotlight tour): a registered view that the shell shows
// in the CENTER slot on first run (fresh vault + no flag) and that the user menu's
// 帮助/新手引导 entry reopens. Six steps, each 一句话 + 带我去 + auto-done detection
// as a PURE function over injected data (./steps); progress/dismiss persist in the
// `onboarding` block of workspace.json through the checklist's OWN write seam
// (PUT /api/workspace/onboarding — the M1 field-group rule, so the layout writer
// can never clobber it). 载入示例文档 seeds the shared self-verify HTML fixture
// (src/core/demo/sampleDoc) idempotently so steps 3/4 are try-able immediately.
//
// Composition only: navigation goes through the shell nav bus; the 导入分享包 step
// opens the EXISTING SvpackImportDialog (svpackViews); all IO rides ./onboardingIo.

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { defineMessages, resolveText, t, useLocale } from "../i18n";
import { registerView, type WorkspaceContext } from "../workspace/viewRegistry";
import { navigateShell } from "../workspace/shellNav";
import { SvpackImportDialog } from "../workspace/svpackViews";
import { SAMPLE_SOURCE_TITLE, demoHtml } from "../../core/demo/sampleDoc";
import type { OnboardingState } from "../data/entityClient";
import { getOnboardingIo } from "./onboardingIo";
import {
  ONBOARDING_STEPS,
  findSampleSource,
  nextPersistedState,
  stepEffectiveDone,
  type OnboardingSnapshot,
  type OnboardingStepId
} from "./steps";

const EMPTY_STATE: OnboardingState = { dismissed: false, completedAt: null, doneSteps: [], sampleSourceId: null };

const EMPTY_DETECTION = {
  noteCount: 0,
  providerKind: null as string | null,
  sealedPackCount: 0,
  trashItemCount: 0,
  speechAvailable: false,
  chatSessionCount: 0,
  events: [] as Array<{ verb: string }>
};

const onboardingMessages = defineMessages({
  panelLabel: { zh: "新手引导", en: "Onboarding" },
  title: { zh: "欢迎使用 Growte", en: "Welcome to Growte" },
  subtitle: {
    zh: "按清单走完一个学习闭环：读、搜、记、朗读、分层、恢复、分享、复习。",
    en: "Complete the learning loop: read, search, note, speak, layer, recover, share, and review."
  },
  complete: {
    zh: "全部完成——学习闭环已经跑通，随时可以从左下角菜单回到这里。",
    en: "All done. The learning loop is ready; you can return here from the bottom-left menu."
  },
  seedFailed: { zh: "载入示例文档失败——请稍后再试。", en: "Failed to load the sample document. Try again later." },
  done: { zh: "已完成", en: "Done" },
  seeding: { zh: "载入中…", en: "Loading…" },
  loadSample: { zh: "载入示例文档", en: "Load Sample Document" },
  finish: { zh: "完成引导", en: "Finish Onboarding" },
  skip: { zh: "跳过引导", en: "Skip Onboarding" }
});

export function OnboardingPanel({ ctx }: { ctx: WorkspaceContext }) {
  useLocale();
  // Always read the LATEST workspace data without re-subscribing effects to every
  // ctx re-render (the ReviewPanel ctxRef idiom).
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const [state, setState] = useState<OnboardingState | null>(null);
  // Whether `state` came from a SUCCESSFUL read. The scoped route merges the block
  // as a whole, so a PUT derived from a failed read (pristine default) would clobber
  // stored progress — automatic latching therefore requires a loaded state, and the
  // explicit writes (dismiss / sample id) re-read first via freshestState().
  const [stateLoaded, setStateLoaded] = useState(false);
  const stateRef = useRef<{ state: OnboardingState | null; loaded: boolean }>({ state: null, loaded: false });
  stateRef.current = { state, loaded: stateLoaded };

  const [detection, setDetection] = useState(EMPTY_DETECTION);
  const [svpackOpen, setSvpackOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState("");
  // Serializes latch PUTs (a save in flight suppresses re-entry, not correctness —
  // the next detection pass re-derives any missed latch from the same pure fn).
  const savingRef = useRef(false);

  // Prefs load — once. A failed read degrades to the pristine default for DISPLAY
  // only (stateLoaded stays false, so nothing is auto-persisted from it).
  useEffect(() => {
    let cancelled = false;
    getOnboardingIo()
      .fetchState()
      .then((next) => {
        if (cancelled) return;
        setState(next);
        setStateLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setState(EMPTY_STATE);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** The most trustworthy base for an EXPLICIT write: the loaded state, else one
      re-read attempt, else (last resort — user intent beats a dead endpoint) the
      local view state. */
  const freshestState = useCallback(async (): Promise<OnboardingState> => {
    const { state: current, loaded } = stateRef.current;
    if (loaded && current) return current;
    try {
      const fetched = await getOnboardingIo().fetchState();
      setState(fetched);
      setStateLoaded(true);
      return fetched;
    } catch {
      return current ?? EMPTY_STATE;
    }
  }, []);

  // Detection reads — re-run when the workspace visibly changes (new source/note/
  // layer activity). Each edge degrades to its empty default on failure.
  const [detectTick, setDetectTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const io = getOnboardingIo();
    void (async () => {
      const [notes, providers, sealed, trash, speech, sessions, events] = await Promise.all([
        io.fetchAllNotes().catch(() => []),
        io.fetchProviders().catch(() => null),
        io.fetchSealedPacks().catch(() => []),
        io.fetchTrash().catch(() => ({ sources: [], notes: [] })),
        io.fetchSpeechStatus().catch(() => null),
        io.fetchChatSessions().catch(() => []),
        io.fetchEvents().catch(() => [])
      ]);
      if (cancelled) return;
      setDetection({
        noteCount: notes.length,
        providerKind: providers?.active.kind ?? null,
        sealedPackCount: sealed.length,
        trashItemCount: trash.sources.length + trash.notes.length,
        speechAvailable: !!speech?.tts.available,
        chatSessionCount: sessions.length,
        events
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [detectTick, ctx.sources.length, ctx.notes.length, ctx.layersVersion]);

  const snapshot: OnboardingSnapshot = {
    sourceCount: ctx.sources.length,
    noteCount: detection.noteCount,
    providerKind: detection.providerKind,
    layers: ctx.sourceLayers,
    sealedPackCount: detection.sealedPackCount,
    trashItemCount: detection.trashItemCount,
    speechAvailable: detection.speechAvailable,
    chatSessionCount: detection.chatSessionCount,
    events: detection.events
  };

  // LATCH newly-done steps (+ completedAt) into the prefs block — pure derivation,
  // scoped-route PUT, no-op when the stored state already matches. Requires a
  // SUCCESSFULLY loaded state (see stateLoaded above — no blind clobber).
  useEffect(() => {
    if (!state || !stateLoaded || savingRef.current) return;
    const next = nextPersistedState(state, snapshot, new Date().toISOString());
    if (!next) return;
    savingRef.current = true;
    getOnboardingIo()
      .saveState(next)
      .then(() => setState(next))
      .catch(() => {
        // Persistence hiccup — the latch re-derives on the next pass.
      })
      .finally(() => {
        savingRef.current = false;
      });
    // snapshot is derived state; its inputs are listed instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, stateLoaded, detection, ctx.sources.length, ctx.sourceLayers]);

  const persist = useCallback(async (next: OnboardingState) => {
    setState(next);
    try {
      await getOnboardingIo().saveState(next);
    } catch {
      // Keep the optimistic local state; the block re-syncs on next open.
    }
  }, []);

  // 载入示例文档 — idempotent: an existing sample (by remembered id, then by the
  // well-known title) is just re-activated; otherwise ingest the shared fixture once.
  const loadSample = useCallback(
    async (thenClose: boolean) => {
      if (seeding) return;
      setSeeding(true);
      setSeedError("");
      try {
        const workspace = ctxRef.current;
        const current = await freshestState();
        const existing = findSampleSource(workspace.sources, current, SAMPLE_SOURCE_TITLE);
        let sourceId = existing?.id ?? null;
        if (!sourceId) {
          const source = await getOnboardingIo().seedSample(SAMPLE_SOURCE_TITLE, demoHtml);
          sourceId = source.id;
          await workspace.loadSources();
        }
        if (sourceId !== current.sampleSourceId) {
          await persist({ ...current, sampleSourceId: sourceId });
        }
        workspace.setActiveSourceId(sourceId);
        setDetectTick((tick) => tick + 1);
        if (thenClose) navigateShell({ type: "onboarding", open: false });
      } catch {
        setSeedError(t(onboardingMessages.seedFailed));
      } finally {
        setSeeding(false);
      }
    },
    [freshestState, persist, seeding]
  );

  // 带我去 — every action opens an EXISTING surface (aggregation, zero re-implementation).
  const goTo = (stepId: OnboardingStepId) => {
    switch (stepId) {
      case "import-doc":
      case "new-document":
        navigateShell({ type: "pane", kind: "library" });
        return;
      case "search-vault":
        navigateShell({ type: "modal", kind: "shortcut.help" });
        return;
      case "connect-ai":
        navigateShell({ type: "modal", kind: "settings.hub" });
        return;
      case "first-note": {
        // Needs a document in the CENTER slot — activate one (seed if none), then
        // hand the center back to the reader so text can be selected.
        const workspace = ctxRef.current;
        if (workspace.sources.length > 0) {
          workspace.setActiveSourceId(workspace.activeSourceId || workspace.sources[0].id);
          navigateShell({ type: "onboarding", open: false });
        } else {
          void loadSample(true);
        }
        return;
      }
      case "speech-tools":
        navigateShell({ type: "modal", kind: "settings.hub" });
        return;
      case "see-layers":
        navigateShell({ type: "modal", kind: "layer.switcher" });
        return;
      case "trash-recovery":
        navigateShell({ type: "modal", kind: "trash.panel" });
        return;
      case "import-pack":
        setSvpackOpen(true);
        return;
      case "chat-history":
        navigateShell({ type: "pane", kind: "study" });
        return;
      case "review-once":
        navigateShell({ type: "pane", kind: "review.panel" });
        return;
    }
  };

  const dismiss = () => {
    void freshestState().then((base) => persist({ ...base, dismissed: true }));
    navigateShell({ type: "onboarding", open: false });
  };

  const effectiveState = state ?? EMPTY_STATE;
  const doneCount = ONBOARDING_STEPS.filter((step) => stepEffectiveDone(step, effectiveState, snapshot)).length;
  const allDone = doneCount === ONBOARDING_STEPS.length;

  return (
    <section className="onboarding-panel" aria-label={t(onboardingMessages.panelLabel)}>
      <div className="onboarding-card">
        <header className="onboarding-head">
          <span className="onboarding-head-icon" aria-hidden="true">
            <Sparkles size={18} />
          </span>
          <div className="onboarding-head-text">
            <h2 className="onboarding-title">{t(onboardingMessages.title)}</h2>
            <p className="onboarding-subtitle">{t(onboardingMessages.subtitle)}</p>
          </div>
          <span className="onboarding-progress" data-done={doneCount}>
            {doneCount} / {ONBOARDING_STEPS.length}
          </span>
        </header>

        {allDone ? <p className="onboarding-complete">{t(onboardingMessages.complete)}</p> : null}

        <ol className="onboarding-steps">
          {ONBOARDING_STEPS.map((step, index) => {
            const done = stepEffectiveDone(step, effectiveState, snapshot);
            return (
              <li key={step.id} className={`onboarding-step${done ? " done" : ""}`} data-step-id={step.id}>
                <span className="onboarding-step-mark" aria-hidden="true">
                  {done ? "✓" : index + 1}
                </span>
                <div className="onboarding-step-body">
                  <span className="onboarding-step-title">{resolveText(step.title)}</span>
                  <span className="onboarding-step-hint">{resolveText(step.hint)}</span>
                </div>
                {done ? (
                  <span className="onboarding-step-done-label">{t(onboardingMessages.done)}</span>
                ) : (
                  <button
                    type="button"
                    className="onboarding-go-btn"
                    data-step-id={step.id}
                    disabled={seeding && step.id === "first-note"}
                    onClick={() => goTo(step.id)}
                  >
                    {resolveText(step.goLabel)}
                  </button>
                )}
              </li>
            );
          })}
        </ol>

        {seedError ? <p className="onboarding-error">{seedError}</p> : null}

        <footer className="onboarding-foot">
          <button
            type="button"
            className="onboarding-sample-btn"
            disabled={seeding}
            onClick={() => void loadSample(false)}
          >
            {seeding ? t(onboardingMessages.seeding) : t(onboardingMessages.loadSample)}
          </button>
          <span className="onboarding-foot-gap" />
          <button type="button" className="onboarding-dismiss-btn" onClick={dismiss}>
            {allDone ? t(onboardingMessages.finish) : t(onboardingMessages.skip)}
          </button>
        </footer>
      </div>

      {svpackOpen ? (
        <SvpackImportDialog
          onClose={() => setSvpackOpen(false)}
          onCommitted={() => {
            ctxRef.current.refreshLayers();
            setDetectTick((tick) => tick + 1);
          }}
        />
      ) : null}
    </section>
  );
}

registerView({ kind: "onboarding.checklist", render: (_node, ctx) => <OnboardingPanel ctx={ctx} /> });
