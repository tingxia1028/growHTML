// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Stub the surface reader modules so the shell's `.reader-panel` → readerForSource →
// PdfReader import chain doesn't evaluate pdf.js in jsdom (needs DOMMatrix/canvas).
// With no active source the reader resolves to the empty-state div anyway, so the
// stubs are never rendered; this just keeps the static import graph jsdom-safe.
vi.mock("../PdfReader", () => ({ PdfReader: () => null }));
vi.mock("../ImageReader", () => ({ ImageReader: () => null }));
vi.mock("../WebviewReader", () => ({ WebviewReader: () => null }));
vi.mock("../LocalHtmlReader", () => ({ LocalHtmlReader: () => null }));

import { FocusProvider } from "../focus/FocusContext";
import { WorkspaceProvider } from "./WorkspaceContext";
import { WorkspaceShell } from "./WorkspaceShell";
import { RAIL_ENTRIES } from "./IconRail";
import { threePane } from "./presets";
import { navigateShell } from "./shellNav";

// The shell renders the threePane preset's DOCK TREE through the ViewRegistry. We assert
// it produces the three pane containers in order, inside the `.app-shell` flex dock —
// the proof that the layout is data-driven (not hard-coded JSX) yet yields the same panes.

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // The dock engine auto-collapses SECONDARY panes (library, …) to a rail below the
  // responsive breakpoint (1280px). jsdom defaults innerWidth to 1024, which would hide
  // the `.library-panel` behind a rail — so force a wide viewport for these structural
  // assertions (responsive collapse is covered by its own dock unit test + an e2e).
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1400 });
  window.localStorage.clear();
  // WorkspaceProvider's mount effect calls entityClient.sources() (fetch). jsdom has
  // no fetch; stub it to reject so loadSources hits its catch (no unhandled rejection)
  // and the panels still render with empty state.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("no network in test")))
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("WorkspaceShell", () => {
  it("renders the threePane preset's three view containers into .app-shell", async () => {
    await act(async () => {
      root.render(
        <FocusProvider>
          <WorkspaceProvider>
            <WorkspaceShell layout={threePane} />
          </WorkspaceProvider>
        </FocusProvider>
      );
    });

    // The grid wrapper + the three registered panels (library / source.viewer / study).
    expect(container.querySelector(".app-shell")).not.toBeNull();
    expect(container.querySelector(".library-panel")).not.toBeNull();
    expect(container.querySelector(".reader-panel")).not.toBeNull();
    expect(container.querySelector(".study-panel")).not.toBeNull();

    // No unknown-view placeholders — every preset node resolved to a real view.
    expect(container.querySelector(".workspace-node-missing")).toBeNull();
  });

  it("keeps the left rail to Library/Review/Mistakes/Concepts/Profile and hosts secondary views in a modal", async () => {
    await act(async () => {
      root.render(
        <FocusProvider>
          <WorkspaceProvider>
            <WorkspaceShell layout={threePane} />
          </WorkspaceProvider>
        </FocusProvider>
      );
    });

    const railButtons = Array.from(container.querySelectorAll<HTMLButtonElement>(".icon-rail-entries .icon-rail-btn"));
    expect(railButtons).toHaveLength(5);
    expect(RAIL_ENTRIES.map((entry) => entry.kind)).toEqual([
      "library",
      "review.panel",
      "mistake.book",
      "concept.list",
      "profile.panel"
    ]);

    await act(async () => {
      expect(navigateShell({ type: "modal", kind: "shortcut.help" })).toBe(true);
    });
    expect(container.querySelector(".shell-modal-dialog")).not.toBeNull();
    expect(container.querySelector(".shortcut-help")).not.toBeNull();
  });

  it("toggles the left sidebar from the active rail icon", async () => {
    await act(async () => {
      root.render(
        <FocusProvider>
          <WorkspaceProvider>
            <WorkspaceShell layout={threePane} />
          </WorkspaceProvider>
        </FocusProvider>
      );
    });

    const [libraryButton, , , conceptsButton] = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".icon-rail-entries .icon-rail-btn")
    );
    expect(container.querySelector(".library-panel")).not.toBeNull();

    await act(async () => {
      libraryButton.click();
    });
    expect(container.querySelector(".library-panel")).toBeNull();
    expect(container.querySelector<HTMLElement>('.dock-pane[data-collapsed="true"]')?.style.flex).toBe("0 0 0px");

    await act(async () => {
      libraryButton.click();
    });
    expect(container.querySelector(".library-panel")).not.toBeNull();

    await act(async () => {
      libraryButton.click();
    });
    await act(async () => {
      conceptsButton.click();
    });
    expect(container.querySelector(".concept-panel")).not.toBeNull();
    expect(container.querySelector(".library-panel")).toBeNull();
  });

  it("renders the panels in the preset's node order (library → reader → study)", async () => {
    await act(async () => {
      root.render(
        <FocusProvider>
          <WorkspaceProvider>
            <WorkspaceShell layout={threePane} />
          </WorkspaceProvider>
        </FocusProvider>
      );
    });

    const shell = container.querySelector(".app-shell")!;
    // The root split's children are `.dock-pane` wrappers (interleaved with resize
    // gutters); each wraps its view PLUS (for a collapsible pane) an absolute collapse
    // button as a sibling. So assert the PANE order by the wrapped panel itself, not the
    // pane's firstElementChild (which is the collapse button for library/study).
    const panelClasses = Array.from(shell.querySelectorAll(":scope > .dock-pane")).map((pane) => {
      const panel = pane.querySelector(".library-panel, .reader-panel, .study-panel");
      return panel?.className ?? "";
    });
    expect(panelClasses).toEqual(["library-panel", "reader-panel", "study-panel"]);
  });
});
