// @vitest-environment jsdom
// SC-2 — the `/类型` palette mounted on the ANCHOR action bar (anchor.excerpt view).
// With a focused SAVED anchor the `/` button shows in .anchor-action-bar and a pick
// dispatches bound to that anchor (materialize short-circuits to the existing anchor).
// In the empty (nothing focused) state the button renders DISABLED — discoverable but
// inert, mirroring the ActionGrid's empty-state gate. The view takes its data via the
// ctx PROP; the mounted ToolbarSlashButton reads its dispatch deps off the workspace
// context, mocked here (useWorkspaceOptional).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactElement, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AnyAnchor, WorkspaceNode } from "../data/entityClient";
import type { FocusContextValue } from "../focus/FocusContext";
import type { WorkspaceContextValue } from "./WorkspaceContext";
import { setLocale } from "../i18n";

let mockWorkspace: WorkspaceContextValue;
// The anchor VIEW doesn't use useWorkspace (it takes ctx as a prop); only the mounted
// ToolbarSlashButton reads the workspace context — stub it here.
vi.mock("./WorkspaceContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./WorkspaceContext")>();
  return { ...actual, useWorkspace: () => mockWorkspace, useWorkspaceOptional: () => mockWorkspace };
});
vi.mock("../speech/SpeakButton", () => ({ SpeakButton: () => null }));

import "../notes/builtinNoteTypes";
import { getView } from "./viewRegistry";
import type { WorkspaceContext } from "./viewRegistry";
import "./anchorViews";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeWorkspace(overrides: Partial<WorkspaceContextValue> = {}): WorkspaceContextValue {
  return {
    dispatch: vi.fn().mockResolvedValue(undefined),
    openManualEditor: vi.fn(),
    operations: [],
    operationPrefs: { order: [], disabled: [] },
    activeKitIds: [],
    ...overrides
  } as unknown as WorkspaceContextValue;
}

function focusedCtx(): WorkspaceContext {
  const anchor = { id: "anchor_1", sourceId: "source_1", anchorKind: "html_selection", quote: "数学广角—优化" } as AnyAnchor;
  const focus = {
    focus: { type: "anchor", anchorId: anchor.id },
    draft: null,
    anchor,
    setFocus: vi.fn(),
    setAnchor: vi.fn(),
    clear: vi.fn(),
    materializeAnchor: vi.fn()
  } as unknown as FocusContextValue;
  return {
    focus,
    activeSource: { id: "source_1", title: "教科书", sourceType: "pdf" },
    visibleNotes: [],
    anchorBarActions: [],
    runAction: vi.fn(),
    generating: false,
    openOperationManager: vi.fn()
  } as unknown as WorkspaceContext;
}

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  setLocale("zh");
  mockWorkspace = makeWorkspace();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  if (root) {
    const current = root;
    act(() => current.unmount());
    root = null;
  }
  container.remove();
  vi.restoreAllMocks();
});

function mount(node: ReactNode) {
  root = createRoot(container);
  act(() => root!.render(node as ReactElement));
}

const bar = () => container.querySelector(".anchor-action-bar");
const slashBtn = () => container.querySelector(".anchor-action-bar .toolbar-slash-btn") as HTMLButtonElement;
const rows = () => Array.from(container.querySelectorAll(".anchor-action-bar .slash-palette-row"));

describe("SC-2 — slash `/` on the anchor action bar", () => {
  it("with a focused saved anchor, the `/` button shows ENABLED and a pick dispatches", () => {
    const plugin = getView("anchor.excerpt")!;
    const ctx = focusedCtx();
    const node = { id: "anchor", kind: "anchor.excerpt" } as WorkspaceNode;
    mount(<>{plugin.render(node, ctx)}</>);

    expect(bar()).toBeTruthy();
    const button = slashBtn();
    expect(button).toBeTruthy();
    expect(button.disabled).toBe(false); // focus.anchor present → enabled

    act(() => button.click());
    const quizRow = rows().find((r) => r.getAttribute("data-entry-id") === "quiz")!;
    expect(quizRow).toBeTruthy();
    // The anchor stays focused at pick time (nothing collapsed it).
    expect(ctx.focus.anchor).toBeTruthy();
    act(() => {
      quizRow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    expect(mockWorkspace.openManualEditor).toHaveBeenCalledWith("quiz");
  });

  it("in the empty (nothing focused) state the `/` button renders DISABLED", () => {
    const plugin = getView("anchor.excerpt")!;
    const ctx = focusedCtx();
    (ctx.focus as { anchor: unknown; draft: unknown }).anchor = null;
    (ctx.focus as { anchor: unknown; draft: unknown }).draft = null;
    const node = { id: "anchor", kind: "anchor.excerpt" } as WorkspaceNode;
    mount(<>{plugin.render(node, ctx)}</>);

    expect(container.querySelector(".anchor-excerpt-empty")).toBeTruthy();
    const button = slashBtn();
    expect(button).toBeTruthy();
    expect(button.disabled).toBe(true);
    act(() => button.click());
    expect(container.querySelector(".anchor-action-bar .toolbar-slash-popover")).toBeNull();
  });
});
