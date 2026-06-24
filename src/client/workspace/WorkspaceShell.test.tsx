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
import { threePane } from "./presets";

// The shell renders the threePane preset's nodes through the ViewRegistry. We assert
// it produces the three pane containers in order, in the `.app-shell` grid — the
// proof that the layout is data-driven (not hard-coded JSX) yet yields the same DOM.

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
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
    const panelClasses = Array.from(shell.children).map((child) => child.className);
    expect(panelClasses).toEqual(["library-panel", "reader-panel", "study-panel"]);
  });
});
