// @vitest-environment jsdom
// SC-2 — ToolbarSlashButton: the `/` affordance for the toolbar surfaces (selection
// floating toolbar + anchor action bar). Proves the whole SELECTION-BLUR contract:
//   • the button opens/closes a popover carrying the SHIPPED SC-0 <SlashPalette>, rows
//     enumerated from the live note-type + operation adapters;
//   • filtering + navigation come from KEYDOWN on the button (there is NO focusable
//     filter input that would steal focus and collapse the reader range);
//   • a pick routes through the stubbed dispatch/openManualEditor (shared
//     dispatchSlashEntry);
//   • mousedown on the button AND on a row is default-prevented — the guard that keeps
//     the selection (focus.draft) alive until the pick's command materializes it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { WorkspaceContextValue } from "../workspace/WorkspaceContext";

let mockCtx: WorkspaceContextValue;
vi.mock("../workspace/WorkspaceContext", () => ({
  useWorkspace: () => mockCtx,
  useWorkspaceOptional: () => mockCtx
}));

// Register the built-in note types so the palette has rows (markdown/quiz), same as the
// SC-1 composer test relies on.
import "../notes/builtinNoteTypes";
import { ToolbarSlashButton } from "./ToolbarSlashButton";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeCtx(overrides: Partial<WorkspaceContextValue> = {}): WorkspaceContextValue {
  return {
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
  if (root) {
    const current = root;
    act(() => current.unmount());
    root = null;
  }
  container.remove();
  vi.restoreAllMocks();
});

function mount(props: { surface: "selection" | "anchor"; disabled?: boolean } = { surface: "selection" }) {
  root = createRoot(container);
  act(() => root!.render(<ToolbarSlashButton {...props} />));
  return container;
}

const btn = () => container.querySelector(".toolbar-slash-btn") as HTMLButtonElement;
const popover = () => container.querySelector(".toolbar-slash-popover");
const rows = () => Array.from(container.querySelectorAll(".slash-palette-row"));
const root_ = () => container.querySelector(".toolbar-slash") as HTMLDivElement;

function press(key: string) {
  act(() => {
    root_().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

describe("ToolbarSlashButton (SC-2)", () => {
  it("renders a `/` button, closed by default; clicking opens the popover with registry rows", () => {
    mount();
    expect(btn()).toBeTruthy();
    expect(btn().getAttribute("aria-expanded")).toBe("false");
    expect(popover()).toBeNull();

    act(() => btn().click());
    expect(btn().getAttribute("aria-expanded")).toBe("true");
    expect(popover()).toBeTruthy();
    const ids = rows().map((r) => r.getAttribute("data-entry-id"));
    expect(ids).toContain("markdown");
    expect(ids).toContain("quiz");
    expect(ids).not.toContain("bookmark"); // hidden types never appear
  });

  it("KEYDOWN filters the list (no focusable input) — typing narrows to the quiz alias", () => {
    mount();
    act(() => btn().click());
    // `判` narrows to quiz (中文 alias 判断题). Typed char-by-char via keydown.
    press("判");
    const ids = rows().map((r) => r.getAttribute("data-entry-id"));
    expect(ids).toContain("quiz");
    expect(ids).not.toContain("markdown");
    // Backspace clears the query → the full list returns.
    press("Backspace");
    expect(rows().map((r) => r.getAttribute("data-entry-id"))).toContain("markdown");
  });

  it("ArrowDown moves the active row; Enter picks it → openManualEditor (bare noteType)", () => {
    mount();
    act(() => btn().click());
    expect(rows()[0].className).toContain("active");
    press("ArrowDown");
    const active = container.querySelector(".slash-palette-row.active")!;
    const activeId = active.getAttribute("data-entry-id");
    expect(rows()[1].className).toContain("active");
    press("Enter");
    expect(mockCtx.openManualEditor).toHaveBeenCalledWith(activeId);
    expect(mockCtx.dispatch).not.toHaveBeenCalled();
    expect(popover()).toBeNull(); // pick closes the popover
  });

  it("a row CLICK (mousedown) picks it via the shared dispatch (no instruction)", () => {
    mount();
    act(() => btn().click());
    const quizRow = rows().find((r) => r.getAttribute("data-entry-id") === "quiz")!;
    act(() => {
      quizRow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    expect(mockCtx.openManualEditor).toHaveBeenCalledWith("quiz");
  });

  it("an operation row picks → operation.run through the shared dispatch", () => {
    mockCtx = makeCtx({ operations: [{ id: "op_test", name: "我的操作", scope: "anchor" }] as never });
    mount();
    act(() => btn().click());
    const opRow = rows().find((r) => r.getAttribute("data-entry-id") === "op_test")!;
    expect(opRow).toBeTruthy();
    act(() => {
      opRow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    expect(mockCtx.dispatch).toHaveBeenCalledTimes(1);
    const [commandId, payload] = vi.mocked(mockCtx.dispatch).mock.calls[0] as [string, { operationId: string; scope: string }];
    expect(commandId).toBe("operation.run");
    expect(payload.operationId).toBe("op_test");
    expect(payload.scope).toBe("anchor");
    expect(mockCtx.openManualEditor).not.toHaveBeenCalled();
  });

  it("SELECTION GUARD: mousedown on the button AND on a row is default-prevented", () => {
    mount();
    // The button's mousedown must NOT collapse the selection (it opens the palette).
    const downBtn = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => btn().dispatchEvent(downBtn));
    expect(downBtn.defaultPrevented).toBe(true);

    act(() => btn().click());
    const row = rows()[0];
    const downRow = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => row.dispatchEvent(downRow));
    expect(downRow.defaultPrevented).toBe(true);
  });

  it("Escape closes the palette and STOPS PROPAGATION (so the document Escape can't clear the selection)", () => {
    mount();
    act(() => btn().click());
    expect(popover()).toBeTruthy();
    // A document-level Escape listener stands in for SelectionFloatingToolbar's clear.
    const docEscape = vi.fn();
    document.addEventListener("keydown", docEscape);
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => root_().dispatchEvent(escape));
    document.removeEventListener("keydown", docEscape);
    expect(popover()).toBeNull(); // palette closed first
    expect(docEscape).not.toHaveBeenCalled(); // propagation stopped → no selection clear
  });

  it("closes when another toolbar popover opens", () => {
    mount();
    act(() => btn().click());
    expect(popover()).toBeTruthy();
    act(() => {
      document.dispatchEvent(new CustomEvent("sv:toolbar-popover-open", { detail: { owner: "more-inline" } }));
    });
    expect(popover()).toBeNull();
  });

  it("gated closed when `disabled` (the anchor-bar empty-state gate)", () => {
    mount({ surface: "anchor", disabled: true });
    expect(btn().disabled).toBe(true);
    act(() => btn().click());
    expect(popover()).toBeNull();
  });
});
