// @vitest-environment jsdom
// PLAT-LAYER Part-2 Slice 4a — CHARACTERIZATION tests for the documents-domain
// orchestration (panes ↔ sourceBundles ↔ activeSourceId ↔ top-level reader state).
//
// TEST-ONLY: ZERO production changes. These pin the CURRENT observable behavior of the
// WorkspaceContext "documents = ONE unit" cluster so the upcoming XL `useDocumentsDomain`
// extraction (Slice 4b) can prove it preserved behavior. See
// docs/implementation/part-2-workspacecontext-split-plan.md §2 (TIER-B / the cycle).
//
// The behaviors pinned (all cited against the real WorkspaceContext.tsx):
//   1. switch source → top-level MIRRORS the focused bundle (mirrorBundleToTopLevel via the
//      focused-source effect ~:1350; the mirror call at :1355 / :1094).
//   2. refocus a CACHED source → NO refetch (the effect reuses hasBundle/getBundle at :1352
//      and only fetches on a cache miss — served from `sourceBundles`).
//   3. refreshAnnotations on a NON-focused source → does NOT overwrite top-level (the
//      `targetId === activeSourceId` back-edge guard at :1157); on the FOCUSED source it does.
//   4. deleteSourceItem on the ACTIVE source → prunes its pane + clears top-level (:1281-1294).
//
// Harness mirrors generatingState.test.tsx / WorkspaceContext.render.test.tsx: mount the
// REAL WorkspaceProvider under a FocusProvider, stub the reader modules + entityClient IO,
// opt into React's act() env, and drive actions through the live context surface captured by
// a tiny consumer. Assertions are on observable state (renderedHtml / notes / anchors /
// openPanes) and on DELTAS in the per-source bundle-fetch count.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Opt into React's act() environment so state updates + effects flush deterministically
// (same as the render-count guard; the shared vitest config has no global act flag and we
// drive our own re-renders through the context actions).
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Reader-module stubs — keep the import graph jsdom-safe (pdf.js / webview native bits).
vi.mock("../PdfReader", () => ({ PdfReader: () => null }));
vi.mock("../ImageReader", () => ({ ImageReader: () => null }));
vi.mock("../WebviewReader", () => ({ WebviewReader: () => null }));
vi.mock("../LocalHtmlReader", () => ({ LocalHtmlReader: () => null }));

import type { AnyAnchor, NoteRecord, PatchRecord, SourceRecord } from "../data/entityClient";
import type { StudyLayerRecord } from "../data/entityClient";

// —— Two DISTINGUISHABLE sources, A and B ————————————————————————————————————————————
// Both are `sourceType: "html"` so the HTML pipeline applies (htmlPipeline: true) and
// `entityClient.rendered(id)` is fetched during fetchSourceBundle — that rendered() call is
// our per-source BUNDLE-FETCH marker (refreshAnnotations does NOT call rendered(), so a
// refresh never inflates the count). No `metadata.originalPath` → isLocalHtml is false →
// rendered() really is called.
const SOURCE_A: SourceRecord = {
  id: "src-A",
  title: "Source A",
  sourceType: "html",
  path: "/a",
  contentHash: "hash-a"
};
const SOURCE_B: SourceRecord = {
  id: "src-B",
  title: "Source B",
  sourceType: "html",
  path: "/b",
  contentHash: "hash-b"
};

type Fixture = {
  rendered: string;
  anchors: AnyAnchor[];
  notes: NoteRecord[];
  patches: PatchRecord[];
  layers: StudyLayerRecord[];
};

function htmlAnchor(id: string, sourceId: string): AnyAnchor {
  return {
    id,
    sourceId,
    anchorKind: "html_selection",
    studyId: `sid-${id}`,
    selector: `[data-study-id="sid-${id}"]`,
    quote: `quote-${id}`
  };
}

function note(id: string, sourceId: string, anchorId: string): NoteRecord {
  return {
    id,
    sourceId,
    anchorIds: [anchorId],
    conceptIds: [],
    contentType: "markdown",
    content: `content-${id}`,
    visibility: "private",
    layerIds: []
  };
}

// Per-source fixtures. `fixtures[id]` is mutable so a test can swap in a NEW annotation set
// and assert a refresh picks it up (test #3's focused-refresh leg).
let fixtures: Record<string, Fixture>;

// Per-source BUNDLE-FETCH counter (bumped only inside `rendered`, which only
// fetchSourceBundle calls). The liveness/no-refetch assertions read deltas off this.
let renderedCalls: Record<string, number>;

// The LIVE sources list `entityClient.sources()` returns — mutable so `deleteSource(id)`
// removes it (mirrors the server: after a delete, the source is gone from the next
// loadSources, which is what prunes its pane).
let liveSources: SourceRecord[];

vi.mock("../data/entityClient", () => ({
  entityClient: {
    // Mount IO: both sources exist from the start (loadSources' first-load auto-open will
    // open the first one; the tests then drive explicit open/focus).
    sources: vi.fn(() => Promise.resolve({ sources: liveSources })),
    operations: vi.fn(() => Promise.resolve({ operations: [] })),
    operationPrefs: vi.fn(() => Promise.resolve({ prefs: { order: [], disabled: [], params: {} } })),
    // Bundle IO — keyed by sourceId so A and B are distinguishable.
    rendered: vi.fn((id: string) => {
      renderedCalls[id] = (renderedCalls[id] ?? 0) + 1;
      // fetchSourceBundle only reads `.content`; `.source` is unused there.
      return Promise.resolve({ source: SOURCE_A, content: fixtures[id]?.rendered ?? "" });
    }),
    anchors: vi.fn((id: string) => Promise.resolve({ anchors: fixtures[id]?.anchors ?? [] })),
    notes: vi.fn((id: string) => Promise.resolve({ notes: fixtures[id]?.notes ?? [] })),
    patches: vi.fn((id: string) => Promise.resolve({ patches: fixtures[id]?.patches ?? [] })),
    layers: vi.fn((id: string) => Promise.resolve({ layers: fixtures[id]?.layers ?? [] })),
    // A note delete mutates the server: drop it from the owning source's fixture so the
    // subsequent refresh re-reads the shrunk list.
    deleteNote: vi.fn((noteId: string) => {
      for (const fixture of Object.values(fixtures)) {
        fixture.notes = fixture.notes.filter((n) => n.id !== noteId);
      }
      return Promise.resolve({ ok: true as const });
    }),
    deleteSource: vi.fn((id: string) => {
      liveSources = liveSources.filter((s) => s.id !== id);
      return Promise.resolve({ ok: true as const });
    })
  }
}));

import { entityClient } from "../data/entityClient";
import { FocusProvider } from "../focus/FocusContext";
import { WorkspaceProvider, useWorkspace, type WorkspaceContextValue } from "./WorkspaceContext";

let container: HTMLDivElement;
let root: Root;
let ctx: WorkspaceContextValue;

function Capture() {
  ctx = useWorkspace();
  return null;
}

async function mount() {
  await act(async () => {
    root.render(
      <FocusProvider>
        <WorkspaceProvider>
          <Capture />
        </WorkspaceProvider>
      </FocusProvider>
    );
  });
  // Flush the mount fetch chain (loadSources → auto-open → focused-source bundle load) so
  // the provider settles before a test measures anything.
  await flush();
}

// Settle: run the act() pump a few times so every chained microtask (fetch → setState →
// effect → fetch) drains. The documents cluster chains an effect (focused-source load) off
// an id change off a pane update, so one flush isn't always enough.
async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  fixtures = {
    [SOURCE_A.id]: {
      rendered: "A-html",
      anchors: [htmlAnchor("a1", SOURCE_A.id)],
      notes: [note("n_a", SOURCE_A.id, "a1")],
      patches: [],
      layers: []
    },
    [SOURCE_B.id]: {
      rendered: "B-html",
      anchors: [htmlAnchor("b1", SOURCE_B.id)],
      notes: [note("n_b", SOURCE_B.id, "b1")],
      patches: [],
      layers: []
    }
  };
  renderedCalls = {};
  liveSources = [SOURCE_A, SOURCE_B];
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1400 });
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
  vi.clearAllMocks();
});

// Helper: focus (open-or-focus) a source and settle. openSourceInNewPane opens a tab for the
// id or focuses the already-open one — the multi-doc entry — and the focused-source effect
// then mirrors its bundle to top-level.
async function focusSource(id: string) {
  await act(async () => {
    ctx.openSourceInNewPane(id);
  });
  await flush();
}

describe("documents domain — panes ↔ bundles ↔ activeSourceId ↔ top-level reader state", () => {
  it("#1 switch source → top-level MIRRORS the focused bundle (A→B)", async () => {
    await mount();

    // Open both A and B, focus A.
    await focusSource(SOURCE_A.id);
    await focusSource(SOURCE_B.id);
    await focusSource(SOURCE_A.id);

    // Focused on A → top-level reflects A's bundle (renderedHtml/anchors/notes).
    expect(ctx.activeSourceId).toBe(SOURCE_A.id);
    expect(ctx.renderedHtml).toBe("A-html");
    expect(ctx.notes.map((n) => n.id)).toEqual(["n_a"]);
    expect(ctx.anchors.map((a) => a.id)).toEqual(["a1"]);

    // Switch focus to B → top-level now reflects B (NOT A).
    await focusSource(SOURCE_B.id);
    expect(ctx.activeSourceId).toBe(SOURCE_B.id);
    expect(ctx.renderedHtml).toBe("B-html");
    expect(ctx.notes.map((n) => n.id)).toEqual(["n_b"]);
    expect(ctx.anchors.map((a) => a.id)).toEqual(["b1"]);
  });

  it("#2 refocus a CACHED source → NO refetch (served from sourceBundles)", async () => {
    await mount();

    // Focus A → its bundle fetches once (rendered(A) call #1).
    await focusSource(SOURCE_A.id);
    expect(ctx.renderedHtml).toBe("A-html");
    const aFetchesAfterFirst = renderedCalls[SOURCE_A.id] ?? 0;
    expect(aFetchesAfterFirst).toBe(1);

    // Focus B (fetches B), then focus A AGAIN.
    await focusSource(SOURCE_B.id);
    await focusSource(SOURCE_A.id);

    // A is back on top with its bundle, but its fetch count did NOT increase — the effect
    // served A from the `sourceBundles` cache (hasBundle hit → mirror, no fetchSourceBundle).
    expect(ctx.activeSourceId).toBe(SOURCE_A.id);
    expect(ctx.renderedHtml).toBe("A-html");
    expect(renderedCalls[SOURCE_A.id] ?? 0).toBe(aFetchesAfterFirst);
  });

  // #3 characterizes the mirror-scoping half of the `targetId === activeSourceId` guard
  // (WorkspaceContext.tsx :1157) that is REACHABLE from the public context surface:
  //   - a refresh of the FOCUSED source RE-MIRRORS fresh server data into top-level;
  //   - a NON-focused pane's fresh data lands ONLY in its cached bundle (surfaced via
  //     renderedHtmlForPane / paintAnchorsForPane) and NEVER overwrites the focused
  //     source's top-level state.
  // NOTE (honest limitation): `refreshAnnotations` is NOT on the public value surface, and
  // every internal caller (onNoteCreated/onNoteDeleted/onLayersChanged/undoConceptMark, …)
  // invokes it with NO argument → it always targets `activeSourceId`. So the guard's
  // `targetId !== activeSourceId` branch for an EXPLICIT non-active id (the per-pane future)
  // is not black-box reachable today; the extraction must preserve the reachable behavior
  // pinned here (the mirror is scoped to the FOCUSED source). Slice 4b, once it exposes a
  // per-pane refresh, should add the explicit-non-active-id case.
  it("#3 a FOCUSED-source refresh re-mirrors fresh data; a background pane's data never overwrites top-level (the mirror is scoped)", async () => {
    await mount();

    // Open both (B first → B has its own pane + cached bundle), then focus A.
    await focusSource(SOURCE_B.id);
    await focusSource(SOURCE_A.id);
    expect(ctx.activeSourceId).toBe(SOURCE_A.id);
    expect(ctx.renderedHtml).toBe("A-html");
    expect(ctx.notes.map((n) => n.id)).toEqual(["n_a"]);

    // --- FOCUSED-source refresh re-mirrors --------------------------------------------
    // Delete a note on the ACTIVE source A via the public command surface. note.delete's
    // onNoteDeleted fires refreshAnnotations() on the active source → re-fetches A's notes
    // (now empty) and mirrors them to top-level. This is the reachable focused-refresh path.
    await act(async () => {
      await ctx.dispatch("note.delete", { noteId: "n_a", skipConfirm: true });
    });
    await flush();
    expect(ctx.activeSourceId).toBe(SOURCE_A.id);
    expect(ctx.renderedHtml).toBe("A-html"); // rendered html preserved across an annotation refresh
    expect(ctx.notes.map((n) => n.id)).toEqual([]); // top-level re-mirrored A's fresh (empty) notes

    // --- a background pane's fresh data is scoped to its own bundle --------------------
    // B is still open as a NON-focused pane; its cached bundle carries B's data. It must be
    // reachable via the per-pane selectors WITHOUT ever having leaked into A's top-level.
    expect(ctx.renderedHtmlForPane(SOURCE_B.id)).toBe("B-html");
    expect(ctx.paintAnchorsForPane(SOURCE_B.id).paintAnchors.map((a) => a.id)).toEqual(["b1"]);
    // top-level STILL reflects the focused source A (not B) — the mirror never crossed panes.
    expect(ctx.renderedHtml).toBe("A-html");
    expect(ctx.notes.map((n) => n.id)).toEqual([]);
  });

  it("#4 deleteSourceItem on the ACTIVE source → prunes its pane + clears/replaces top-level", async () => {
    // Default window.confirm returns false in jsdom → force it true so delete proceeds.
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      await mount();

      // Open ONLY A, focused + active, top-level shows A.
      await focusSource(SOURCE_A.id);
      expect(ctx.activeSourceId).toBe(SOURCE_A.id);
      expect(ctx.renderedHtml).toBe("A-html");
      expect(ctx.openPanes.some((p) => p.sourceId === SOURCE_A.id)).toBe(true);

      // Delete A (the active source). Its pane is pruned, its bundle evicted; because it was
      // the focused source, top-level clears. loadSources then re-homes focus onto whatever
      // sources remain (B) — so top-level no longer shows A's html either way.
      await act(async () => {
        await ctx.deleteSourceItem(SOURCE_A.id, "Source A");
      });
      await flush();

      expect(ctx.openPanes.some((p) => p.sourceId === SOURCE_A.id)).toBe(false);
      expect(ctx.renderedHtml).not.toBe("A-html");
      expect(entityClient.deleteSource).toHaveBeenCalledWith(SOURCE_A.id);
    } finally {
      confirmSpy.mockRestore();
    }
  });
});
