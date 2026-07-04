// @vitest-environment jsdom
// OnboardingPanel (SHELL-2) — the checklist view over the pure steps + io seam:
// six steps render, done badges derive from injected data, newly-done steps LATCH
// into the prefs block through the checklist's OWN write seam (full-block PUT with
// the other fields preserved — the no-clobber contract), 载入示例文档 is idempotent,
// dismiss persists + closes via the shell nav bus, and the 导入分享包 step opens the
// EXISTING SvpackImportDialog.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import "./OnboardingPanel";

import { getView, type WorkspaceContext } from "../workspace/viewRegistry";
import { registerShellNavigator, type ShellNavTarget } from "../workspace/shellNav";
import type { OnboardingState, SourceRecord } from "../data/entityClient";
import { SAMPLE_SOURCE_TITLE } from "../../core/demo/sampleDoc";
import { setLocale } from "../i18n";
import { setOnboardingIoForTests, type OnboardingIo } from "./onboardingIo";

let container: HTMLDivElement;
let root: Root;
let targets: ShellNavTarget[];

const freshState = (over: Partial<OnboardingState> = {}): OnboardingState => ({
  dismissed: false,
  completedAt: null,
  doneSteps: [],
  sampleSourceId: null,
  ...over
});

const source = (id: string, title: string): SourceRecord => ({ id, title }) as SourceRecord;

type IoOverrides = Partial<OnboardingIo>;

function stubIo(over: IoOverrides = {}) {
  const io: OnboardingIo = {
    fetchState: async () => freshState(),
    saveState: vi.fn(async () => ({})),
    fetchAllNotes: async () => [],
    fetchEvents: async () => [],
    fetchSealedPacks: async () => [],
    fetchTrash: async () => ({ retentionDays: 30, sources: [], notes: [] }),
    fetchSpeechStatus: async () => ({ tts: { available: false, lane: "edge" }, stt: { available: false, lane: "local" } }),
    fetchChatSessions: async () => [],
    fetchProviders: async () => ({ active: { id: "mock", kind: "mock" }, providers: [], envProviderId: null }),
    seedSample: vi.fn(async (title: string) => source("src_seeded", title)),
    ...over
  };
  setOnboardingIoForTests(io);
  return io;
}

function ctxWith(over: Partial<Record<keyof WorkspaceContext, unknown>> = {}): WorkspaceContext {
  return {
    sources: [],
    notes: [],
    sourceLayers: [],
    layersVersion: 0,
    activeSourceId: "",
    setActiveSourceId: vi.fn(),
    loadSources: vi.fn(async () => {}),
    refreshLayers: vi.fn(),
    ...over
  } as unknown as WorkspaceContext;
}

beforeEach(() => {
  setLocale("zh");
  targets = [];
  registerShellNavigator((target) => targets.push(target));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setOnboardingIoForTests(null);
  registerShellNavigator(null);
});

async function renderPanel(ctx: WorkspaceContext) {
  await act(async () => {
    root.render(
      getView("onboarding.checklist")!.render({ id: "onboarding", kind: "onboarding.checklist" } as never, ctx) as React.ReactElement
    );
  });
}

describe("OnboardingPanel", () => {
  it("renders the six steps in order with 带我去 buttons and 0/6 progress on a fresh vault", async () => {
    stubIo();
    await renderPanel(ctxWith());

    const ids = Array.from(container.querySelectorAll(".onboarding-step")).map((el) => el.getAttribute("data-step-id"));
    expect(ids).toEqual([
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
    expect(container.querySelector(".onboarding-progress")!.textContent).toContain("0 / 11");
    expect(container.querySelectorAll(".onboarding-go-btn")).toHaveLength(11);
    expect(container.querySelector(".onboarding-complete")).toBeNull();
  });

  it("flips onboarding copy to English when locale changes", async () => {
    setLocale("en");
    stubIo();
    await renderPanel(ctxWith());

    expect(container.querySelector(".onboarding-title")!.textContent).toBe("Welcome to Growte");
    expect(container.querySelector(".onboarding-step-title")!.textContent).toBe("Import Your First Document");
    expect(container.querySelector(".onboarding-go-btn")!.textContent).toBe("Import");
  });

  it("derives done badges from the injected data and LATCHES them via the scoped write seam", async () => {
    const io = stubIo({
      fetchAllNotes: async () => [{ id: "n1" }] as never,
      fetchEvents: async () => [{ verb: "search" }, { verb: "note.review" }] as never,
      fetchSealedPacks: async () => [{ packId: "p1" }] as never,
      fetchTrash: async () => ({ retentionDays: 30, sources: [{ id: "trash_src" }], notes: [] }) as never,
      fetchSpeechStatus: async () => ({
        tts: { available: true, lane: "edge" },
        stt: { available: false, lane: "local" }
      }),
      fetchChatSessions: async () => [{ id: "chat_1" }] as never,
      fetchProviders: async () => ({ active: { id: "claude-agent", kind: "cli-agent" }, providers: [], envProviderId: "claude-agent" })
    });
    const ctx = ctxWith({
      sources: [source("src_1", "Doc")],
      sourceLayers: [{ enabled: false }, { enabled: true, importMode: "imported" }]
    });
    await renderPanel(ctx);

    // All six detected done → banner + 6/6 + the completedAt-stamping latch PUT.
    expect(container.querySelectorAll(".onboarding-step.done")).toHaveLength(11);
    expect(container.querySelector(".onboarding-progress")!.textContent).toContain("11 / 11");
    expect(container.querySelector(".onboarding-complete")).not.toBeNull();

    const saved = (io.saveState as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as OnboardingState;
    expect(saved.doneSteps).toEqual([
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
    expect(saved.completedAt).not.toBeNull();
    // The block's OTHER fields ride along unclobbered (full-block PUT on the scoped route).
    expect(saved.dismissed).toBe(false);
    expect(saved.sampleSourceId).toBeNull();
  });

  it("persistence roundtrip preserves previously latched steps + fields (no-clobber)", async () => {
    const io = stubIo({
      fetchState: async () => freshState({ doneSteps: ["review-once"], sampleSourceId: "src_sample" }),
      fetchAllNotes: async () => [{ id: "n1" }] as never
    });
    await renderPanel(ctxWith({ sources: [source("src_1", "Doc")] }));

    const saved = (io.saveState as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as OnboardingState;
    // The latch APPENDS the newly-done steps after the stored ones.
    expect(saved.doneSteps).toEqual(["review-once", "import-doc", "new-document", "first-note"]);
    expect(saved.sampleSourceId).toBe("src_sample"); // untouched
    expect(saved.dismissed).toBe(false);
    // Latched review-once renders done even though no event data backs it now.
    expect(container.querySelector('[data-step-id="review-once"]')!.className).toContain("done");
  });

  it("does not PUT at all when the stored block already reflects the data", async () => {
    const io = stubIo({ fetchState: async () => freshState({ doneSteps: ["import-doc", "new-document"] }) });
    await renderPanel(ctxWith({ sources: [source("src_1", "Doc")] }));
    expect(io.saveState).not.toHaveBeenCalled();
  });

  it("载入示例文档 seeds ONCE, remembers + activates the source; re-click just re-activates (idempotent)", async () => {
    const io = stubIo();
    const loadSources = vi.fn(async () => {});
    const setActiveSourceId = vi.fn();
    const ctx = ctxWith({ loadSources, setActiveSourceId });
    await renderPanel(ctx);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".onboarding-sample-btn")!.click();
    });
    expect(io.seedSample).toHaveBeenCalledTimes(1);
    expect((io.seedSample as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(SAMPLE_SOURCE_TITLE);
    expect(loadSources).toHaveBeenCalledTimes(1);
    expect(setActiveSourceId).toHaveBeenCalledWith("src_seeded");
    // The seed id is persisted into the block.
    const saved = (io.saveState as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as OnboardingState;
    expect(saved.sampleSourceId).toBe("src_seeded");

    // Second run against a vault that ALREADY has the sample (by title): no new ingest.
    const io2 = stubIo();
    act(() => root.unmount());
    root = createRoot(container);
    const existing = source("src_existing", SAMPLE_SOURCE_TITLE);
    const setActive2 = vi.fn();
    await renderPanel(ctxWith({ sources: [existing], setActiveSourceId: setActive2 }));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".onboarding-sample-btn")!.click();
    });
    expect(io2.seedSample).not.toHaveBeenCalled();
    expect(setActive2).toHaveBeenCalledWith("src_existing");
  });

  it("a FAILED prefs read disables the automatic latch; explicit dismiss re-reads before writing (no blind clobber)", async () => {
    let reads = 0;
    const io = stubIo({
      fetchState: async () => {
        reads += 1;
        if (reads === 1) throw new Error("transport down");
        return freshState({ doneSteps: ["review-once"] });
      }
    });
    // Data that WOULD latch import-doc if the state were trusted.
    await renderPanel(ctxWith({ sources: [source("src_1", "Doc")] }));
    expect(io.saveState).not.toHaveBeenCalled();

    // The explicit dismiss re-reads the stored block and writes OVER it — the
    // previously latched review-once survives. (A follow-up latch PUT may run once
    // the re-read state lands; the FIRST write is the dismissal.)
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".onboarding-dismiss-btn")!.click();
    });
    const saved = (io.saveState as ReturnType<typeof vi.fn>).mock.calls[0][0] as OnboardingState;
    expect(saved.dismissed).toBe(true);
    expect(saved.doneSteps).toEqual(["review-once"]);
  });

  it("跳过引导 persists dismissed:true and closes via the shell nav bus (re-openable from the menu)", async () => {
    const io = stubIo();
    await renderPanel(ctxWith());

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".onboarding-dismiss-btn")!.click();
    });
    const saved = (io.saveState as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as OnboardingState;
    expect(saved.dismissed).toBe(true);
    expect(targets).toContainEqual({ type: "onboarding", open: false });
  });

  it("带我去 actions open the RIGHT existing surfaces; 导入分享包 opens the svpack import dialog", async () => {
    stubIo();
    await renderPanel(ctxWith());

    const go = async (stepId: string) => {
      await act(async () => {
        container.querySelector<HTMLButtonElement>(`.onboarding-go-btn[data-step-id="${stepId}"]`)!.click();
      });
    };

    await go("import-doc");
    await go("new-document");
    await go("search-vault");
    await go("connect-ai");
    await go("speech-tools");
    await go("see-layers");
    await go("trash-recovery");
    await go("chat-history");
    await go("review-once");
    expect(targets).toEqual([
      { type: "pane", kind: "library" },
      { type: "pane", kind: "library" },
      { type: "modal", kind: "shortcut.help" },
      { type: "modal", kind: "settings.hub" },
      { type: "modal", kind: "settings.hub" },
      { type: "modal", kind: "layer.switcher" },
      { type: "modal", kind: "trash.panel" },
      { type: "pane", kind: "study" },
      { type: "pane", kind: "review.panel" }
    ]);

    // 导入分享包 hosts the EXISTING SvpackImportDialog (portaled to body).
    expect(document.querySelector(".svpack-dialog")).toBeNull();
    await go("import-pack");
    expect(document.querySelector(".svpack-dialog")).not.toBeNull();
    expect(document.querySelector(".svpack-file-pick")).not.toBeNull();
  });
});
