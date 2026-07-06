// @vitest-environment jsdom
// PLAT-LAYER Part-2 Slice 7a — CHARACTERIZATION tests for the generation-domain back-edges
// that the strong real-provider ORACLES (generatingState / draftMaterialize /
// floatingNoteEditor) do NOT cover: the chat-reply CLASSIFY path.
//
// TEST-ONLY: ZERO production changes. These pin the CURRENT observable behavior of
// `previewClassifiedReply` (and, THROUGH it, the `aiClassify` back-edge that routes ambiguous
// prose to the server form-router) so the `useGenerationDomain` extraction can prove it
// preserved behavior. Harness mirrors documentsDomain.characterization.test.tsx: mount the
// REAL WorkspaceProvider under a FocusProvider, stub the reader modules + entityClient IO,
// opt into React's act() env, and drive the action through the live context surface.
//
// The behaviors pinned (cited against WorkspaceContext.tsx / useGenerationDomain.ts):
//   (a) previewClassifiedReply(AMBIGUOUS PROSE) → the pure heuristic is LOW confidence, so
//       resolveFormAsync invokes the injected `aiClassify` callback, which calls
//       entityClient.classifyForm; the RETURNED form is parked in the generation preview
//       (pendingDraft) with the stubbed contentType/content + classified:true. This is the
//       only black-box path that exercises BOTH previewClassifiedReply's park AND the
//       aiClassify → classifyForm back-edge (aiClassify is not itself on the public surface).
//   (b) previewClassifiedReply(HIGH-CONFIDENCE content, e.g. a ```mermaid``` fence) → the
//       heuristic is authoritative, so classifyForm is NEVER called and the parked draft
//       carries the HEURISTIC's contentType. Pins "heuristic stays primary" (resolveForm §3).
//
// (aiClassify's black-box reachability note: it is NOT a public value field and every caller
// is previewClassifiedReply, so it is exercised THROUGH previewClassifiedReply's low-confidence
// leg — the reachable contract, mirroring how Slice 4a pinned refreshAnnotations through its
// public callers.)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Opt into React's act() environment so state updates + effects flush deterministically.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Reader-module stubs — keep the import graph jsdom-safe (pdf.js / webview native bits).
vi.mock("../PdfReader", () => ({ PdfReader: () => null }));
vi.mock("../ImageReader", () => ({ ImageReader: () => null }));
vi.mock("../WebviewReader", () => ({ WebviewReader: () => null }));
vi.mock("../LocalHtmlReader", () => ({ LocalHtmlReader: () => null }));

// classifyForm is the server form-router the low-confidence AI classify pass calls. We
// return a DISTINGUISHABLE form (a `code-snippet`, which the plain-prose heuristic would
// NEVER produce) so a parked draft carrying it proves the AI back-edge fired end to end.
vi.mock("../data/entityClient", () => ({
  entityClient: {
    sources: vi.fn(() => Promise.resolve({ sources: [] })),
    operations: vi.fn(() => Promise.resolve({ operations: [] })),
    operationPrefs: vi.fn(() => Promise.resolve({ prefs: { order: [], disabled: [], params: {} } })),
    classifyForm: vi.fn(() =>
      Promise.resolve({ contentType: "code-snippet", content: { language: "js", code: "ai()" }, confidence: "high" })
    )
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
  // Flush the mount fetch chain so the provider settles before a test drives anything.
  await flush();
}

async function flush() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
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

describe("generation domain — previewClassifiedReply + the aiClassify back-edge", () => {
  it("(a) AMBIGUOUS prose → aiClassify calls classifyForm and the STUBBED form parks in the preview", async () => {
    await mount();
    expect(ctx.pendingDraft).toBeNull();

    // Plain prose is a LOW-confidence heuristic match → resolveFormAsync consults aiClassify.
    await act(async () => {
      await ctx.previewClassifiedReply("just a sentence of ordinary prose with no structure");
    });
    await flush();

    // The server form-router was consulted with the reply text (the aiClassify back-edge).
    expect(entityClient.classifyForm).toHaveBeenCalledWith(
      expect.objectContaining({ text: "just a sentence of ordinary prose with no structure" })
    );
    // And the RETURNED classification is what parked (NOT the markdown heuristic fallback),
    // marked classified so Regenerate no-ops.
    expect(ctx.pendingDraft).not.toBeNull();
    expect(ctx.pendingDraft?.contentType).toBe("code-snippet");
    expect(ctx.pendingDraft?.content).toEqual({ language: "js", code: "ai()" });
    expect(ctx.pendingDraft?.classified).toBe(true);
    // The generation indicator cleared in finally.
    expect(ctx.generating).toBe(false);
  });

  it("(b) HIGH-confidence content → the heuristic wins; classifyForm is NEVER called", async () => {
    await mount();

    // A ```mermaid``` fence is a HIGH-confidence heuristic match → no AI classify call.
    await act(async () => {
      await ctx.previewClassifiedReply("```mermaid\ngraph TD; A-->B\n```");
    });
    await flush();

    expect(entityClient.classifyForm).not.toHaveBeenCalled();
    expect(ctx.pendingDraft?.contentType).toBe("mermaid");
    expect(ctx.pendingDraft?.classified).toBe(true);
  });

  it("empty/whitespace reply → no-op (no classify call, nothing parked)", async () => {
    await mount();

    await act(async () => {
      await ctx.previewClassifiedReply("   ");
    });
    await flush();

    expect(entityClient.classifyForm).not.toHaveBeenCalled();
    expect(ctx.pendingDraft).toBeNull();
  });
});
