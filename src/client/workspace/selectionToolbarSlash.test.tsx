// @vitest-environment jsdom
// SC-2 — the `/类型` palette mounted on the SELECTION floating toolbar. With a live
// selection rect (so the floating toolbar shows) AND a focus.draft present, the `/`
// button renders in the card; a pick dispatches the right command WHILE the draft is
// still live — the proof that opening/navigating the palette never collapsed it (the
// keydown-filter + mousedown-preventDefault guards). Fixture-ctx idiom mirrors the
// other workspace mount tests; the floating toolbar reads useWorkspace() + the shared
// selectionRect store, both stubbed/driven here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { WorkspaceContextValue } from "./WorkspaceContext";
import type { AnchorDraft } from "../focus/FocusContext";

let mockCtx: WorkspaceContextValue;
vi.mock("./WorkspaceContext", () => ({ useWorkspace: () => mockCtx }));
// Keep the toolbar's speech affordances jsdom-safe (they own their own effects).
vi.mock("../speech/SpeakButton", () => ({ SpeakButton: () => null }));
vi.mock("../speech/usePinyinPopover", () => ({
  usePinyinPopover: () => ({ open: vi.fn(), popover: null }),
  PinyinButton: () => null
}));

import "../notes/builtinNoteTypes";
import { publishSelectionRect } from "../selection/selectionRect";
import { SelectionFloatingToolbar } from "./SelectionFloatingToolbar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const draft = { quote: "渗透作用把水分子搬过膜", sourceId: "src_1" } as unknown as AnchorDraft;

function makeCtx(overrides: Partial<WorkspaceContextValue> = {}): WorkspaceContextValue {
  return {
    // One anchor-scope action so the floating toolbar clears the `length > 0` gate.
    selectionActions: [{ id: "bookmark.add", kind: "command", title: "书签", group: "core" }],
    runAction: vi.fn(),
    generating: false,
    openOperationManager: vi.fn(),
    focus: { anchor: null, draft, clear: vi.fn() },
    // ToolbarSlashButton deps:
    dispatch: vi.fn().mockResolvedValue(undefined),
    openManualEditor: vi.fn(),
    operations: [],
    operationPrefs: { order: [], disabled: [] },
    activeKitIds: [],
    ...overrides
  } as unknown as WorkspaceContextValue;
}

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  mockCtx = makeCtx();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => publishSelectionRect("host", null));
  if (root) {
    const current = root;
    act(() => current.unmount());
    root = null;
  }
  container.remove();
  vi.restoreAllMocks();
});

function mount() {
  root = createRoot(container);
  act(() => root!.render(<SelectionFloatingToolbar />));
  // A live selection rect → the floating toolbar card portals into document.body.
  act(() => publishSelectionRect("host", { top: 100, left: 100, width: 80, height: 18, bottom: 118 }));
}

const card = () => document.querySelector(".selection-floating-toolbar");
const slashBtn = () => document.querySelector(".selection-floating-toolbar .toolbar-slash-btn") as HTMLButtonElement;
const rows = () => Array.from(document.querySelectorAll(".selection-floating-toolbar .slash-palette-row"));

describe("SC-2 — slash `/` on the selection floating toolbar", () => {
  it("with a live selection + focus.draft, the `/` button shows in the floating card", () => {
    mount();
    expect(card()).toBeTruthy();
    expect(slashBtn()).toBeTruthy();
    expect(slashBtn().getAttribute("aria-expanded")).toBe("false");
  });

  it("clicking `/` opens the palette; a bare noteType pick dispatches WITH focus.draft present", () => {
    mount();
    act(() => slashBtn().click());
    const quizRow = rows().find((r) => r.getAttribute("data-entry-id") === "quiz")!;
    expect(quizRow).toBeTruthy();
    // The draft is still live at pick time (nothing collapsed it).
    expect((mockCtx.focus as { draft: unknown }).draft).toBe(draft);
    act(() => {
      quizRow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    expect(mockCtx.openManualEditor).toHaveBeenCalledWith("quiz");
  });

  it("an operation pick dispatches operation.run from the selection toolbar", () => {
    mockCtx = makeCtx({ operations: [{ id: "op_sel", name: "选区操作", scope: "anchor" }] as never });
    mount();
    act(() => slashBtn().click());
    const opRow = rows().find((r) => r.getAttribute("data-entry-id") === "op_sel")!;
    act(() => {
      opRow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    expect(mockCtx.dispatch).toHaveBeenCalledTimes(1);
    const [commandId, payload] = vi.mocked(mockCtx.dispatch).mock.calls[0] as [string, { operationId: string }];
    expect(commandId).toBe("operation.run");
    expect(payload.operationId).toBe("op_sel");
  });
});
