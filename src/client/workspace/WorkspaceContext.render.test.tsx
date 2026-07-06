// @vitest-environment jsdom
// PLAT-LAYER Part-2 Slice 0 — the render-count GUARD.
//
// WorkspaceContext exposes a 128-field context value through ONE `useMemo` (the value
// memo). Because React `useContext` re-renders a consumer whenever the context VALUE
// OBJECT IDENTITY changes, every one of the 25 consumers re-renders whenever that memo
// produces a new object. Part-2 will extract domain hooks out of the provider; the danger
// is a domain hook returning a FRESH object each render → the value memo busts every time
// the provider re-renders → all consumers re-render on every keystroke (a real perf
// regression). Today NOTHING guards this. This test is that guard.
//
// It pins the OBSERVABLE re-render contract of the value memo so the whole Part-2 split can
// verify against it:
//
//   1. IDENTITY-STABILITY (the load-bearing assertion): when the provider re-renders for a
//      reason UNRELATED to any consumed field, the value memo must return the SAME object
//      identity, so consumers do NOT re-render. We force such a re-render by bumping a
//      `tick` on a PARENT of the provider — that re-renders <WorkspaceProvider> (new
//      `children` element) and re-runs its value `useMemo`, but none of the memo's deps
//      changed, so a correctly-memoized value keeps its identity. If instead a domain hook
//      (or a stray spread) mints a fresh value object on that render, the consumer
//      re-renders and THIS assertion goes red — which is exactly the §A2 regression. (This
//      is the assertion the liveness probe deliberately trips: patching the provider to
//      `value={{ ...value }}` turns every provider render into a fresh identity and makes
//      this test FAIL.)
//
//   2. NO-OP WRITE: a setter called with the SAME current value → React `useState`
//      Object.is-bails → no state change → the provider doesn't even re-run → 0 re-renders.
//
//   3. REAL CHANGE: a single primitive-field change re-renders consumers EXACTLY once
//      (not 0, not a 2+ cascade from an over-eager memo/effect).
//
// We drive the writes through `setActiveLayout` — it writes a primitive string via
// `useState` (`setActiveLayoutId`) and the id is a DIRECT primitive dep of the value memo,
// so it's the cleanest field to exercise identity behaviour:
//   • no-op   = setActiveLayout("study-vault")  → same as the mounted default → useState bails.
//   • change  = setActiveLayout("three-pane")   → a different real preset id  → one re-render.
// (Array/object-identity fields like `sources`/`anchors` are avoided: their setters mint
// new references, so a "no-op" write there would legitimately re-render.)
//
// Harness mirrors generatingState.test.tsx / draftMaterialize.test.tsx: mount the REAL
// WorkspaceProvider with the entityClient IO stubbed so the 9 mount effects settle to a
// stable render count, then measure render-count DELTAS around each action (never absolute
// counts, so an unrelated effect can't break it). No StrictMode → deterministic counts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, memo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

// Opt this file into React's act() environment so state updates/effects flush deterministically
// (the shared vitest config has no global act flag; the sibling provider tests don't force
// re-renders, we do, so we need it explicit here).
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Reader-module stubs — same reason as the sibling provider tests: keep the import graph
// jsdom-safe (these pull in pdf.js / webview native bits).
vi.mock("../PdfReader", () => ({ PdfReader: () => null }));
vi.mock("../ImageReader", () => ({ ImageReader: () => null }));
vi.mock("../WebviewReader", () => ({ WebviewReader: () => null }));
vi.mock("../LocalHtmlReader", () => ({ LocalHtmlReader: () => null }));

// Stub the entity client so the provider's mount IO (loadSources fetch, operations,
// operationPrefs) resolves empty and mount settles into a stable idle render count.
vi.mock("../data/entityClient", () => ({
  entityClient: {
    sources: vi.fn(() => Promise.resolve({ sources: [] })),
    operations: vi.fn(() => Promise.resolve({ operations: [] })),
    operationPrefs: vi.fn(() => Promise.resolve({ prefs: { order: [], disabled: [], params: {} } }))
  }
}));

import { FocusProvider } from "../focus/FocusContext";
import { WorkspaceProvider, useWorkspace, type WorkspaceContextValue } from "./WorkspaceContext";

let container: HTMLDivElement;
let root: Root;
let ctx: WorkspaceContextValue;

// A render counter that lives OUTSIDE React state — every time the consumer body runs
// (i.e. React re-renders it because the context value identity changed), this bumps.
let renders = 0;
// The last-seen context value REFERENCE — assertion #1 checks this is preserved across a
// forced provider re-render.
let lastValue: WorkspaceContextValue | null = null;

// A handle to force a re-render of the PARENT of the provider, from inside a test. Bumping
// it re-renders <WorkspaceProvider> (new `children` element) WITHOUT touching any of its
// own state — the pure "unrelated re-render" the identity guard needs.
let forceParentRerender!: () => void;

// The consumer: reads the whole context via useWorkspace() (so it subscribes to the value
// object identity, exactly like the 25 real consumers) and records that it rendered.
// Wrapped in React.memo with NO props so it re-renders ONLY when its context subscription
// fires (i.e. the value object identity changed) — NOT merely because a parent re-rendered
// and handed it a fresh element. That isolation is what makes "provider re-rendered but
// value identity was preserved ⇒ 0 consumer re-renders" an honest signal.
const Consumer = memo(function Consumer() {
  ctx = useWorkspace();
  lastValue = ctx;
  renders += 1;
  return null;
});

// A parent that holds a throwaway `tick`. Re-rendering it (via forceParentRerender) forces
// <WorkspaceProvider> to re-render — the value `useMemo` re-runs, but with unchanged deps a
// correctly-memoized value keeps its identity, so <Consumer> must NOT re-render.
function Harness() {
  const [, setTick] = useState(0);
  forceParentRerender = () => setTick((n) => n + 1);
  return (
    <FocusProvider>
      <WorkspaceProvider>
        <Consumer />
      </WorkspaceProvider>
    </FocusProvider>
  );
}

async function mount() {
  await act(async () => {
    root.render(<Harness />);
  });
  // Flush any remaining microtasks/effects (the mount fetch chain) so the render count is
  // settled before the test starts measuring deltas.
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  renders = 0;
  lastValue = null;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1400 });
  // Start from a clean prefs slate so the mounted activeLayoutId is the DEFAULT_LAYOUT_ID
  // ("study-vault") — the value we call the no-op setter with.
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

describe("WorkspaceContext value-memo identity — the re-render guard", () => {
  it("a provider re-render for an UNRELATED reason keeps the value identity → 0 consumer re-renders", async () => {
    await mount();
    expect(ctx.activeLayoutId).toBe("study-vault");

    const before = renders;
    const valueBefore = lastValue;

    // Force <WorkspaceProvider> to re-render WITHOUT changing any of its own state. A
    // correctly-memoized value survives with the SAME identity → the consumer does NOT
    // re-render. (Under the §A2 regression — a domain hook / spread minting a fresh object
    // each render — this delta becomes >0 and the test fails.)
    await act(async () => {
      forceParentRerender();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(renders - before).toBe(0);
    // And the value OBJECT REFERENCE is literally preserved (the direct memo-identity check).
    expect(lastValue).toBe(valueBefore);
  });

  it("a no-op state write does NOT re-render consumers (useState Object.is-bails)", async () => {
    await mount();
    expect(ctx.activeLayoutId).toBe("study-vault");

    const before = renders;
    const valueBefore = lastValue;
    // No-op write: same value → React `useState` Object.is-bails → no state change → the
    // provider doesn't even re-run → the consumer must NOT re-render.
    await act(async () => {
      ctx.setActiveLayout("study-vault");
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(renders - before).toBe(0);
    expect(lastValue).toBe(valueBefore);
    expect(ctx.activeLayoutId).toBe("study-vault");
  });

  it("a single real field change re-renders consumers EXACTLY once", async () => {
    await mount();
    expect(ctx.activeLayoutId).toBe("study-vault");

    const before = renders;
    // Real change: a DIFFERENT valid preset id → useState commits → value memo recomputes
    // (activeLayoutId is a direct primitive dep) → the consumer re-renders — exactly once,
    // not a 2+ cascade from an over-eager memo/effect.
    await act(async () => {
      ctx.setActiveLayout("three-pane");
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(renders - before).toBe(1);
    expect(ctx.activeLayoutId).toBe("three-pane");
  });
});
