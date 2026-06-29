// @vitest-environment jsdom
// FIX 2 — the shared `generating` flag: set on start of an AI structured-generation
// dispatch, cleared on success AND on error. Plus the pure `isGenerationCommand`
// classifier that decides whether a dispatch flips the flag. We render the real
// WorkspaceProvider with the entityClient mocked, capture the live context via a tiny
// consumer, and drive a generate dispatch through a deferred promise so we can observe
// the flag mid-flight.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Reader-module stubs (same reason as WorkspaceShell.test: keep the import graph jsdom-safe).
vi.mock("../PdfReader", () => ({ PdfReader: () => null }));
vi.mock("../ImageReader", () => ({ ImageReader: () => null }));
vi.mock("../WebviewReader", () => ({ WebviewReader: () => null }));
vi.mock("../LocalHtmlReader", () => ({ LocalHtmlReader: () => null }));

// Mock the entity client: generateBlock is a deferred promise we resolve/reject by hand;
// the other methods used at mount return empty so the provider settles into idle state.
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

let generateBlockDeferred = deferred<{ contentType: string; content: unknown; provider: string }>();

vi.mock("../data/entityClient", () => ({
  entityClient: {
    sources: vi.fn(() => Promise.resolve({ sources: [] })),
    operations: vi.fn(() => Promise.resolve({ operations: [] })),
    operationPrefs: vi.fn(() => Promise.resolve({ prefs: { order: [], disabled: [], params: {} } })),
    generateBlock: vi.fn(() => generateBlockDeferred.promise),
    createNote: vi.fn(() => Promise.resolve({ note: { id: "n1", anchorIds: [] } }))
  }
}));

import { entityClient } from "../data/entityClient";
import { FocusProvider } from "../focus/FocusContext";
import { WorkspaceProvider, useWorkspace, isGenerationCommand, type WorkspaceContextValue } from "./WorkspaceContext";

let container: HTMLDivElement;
let root: Root;
let ctx: WorkspaceContextValue;

function Capture() {
  ctx = useWorkspace();
  return null;
}

beforeEach(() => {
  generateBlockDeferred = deferred();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1400 });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

describe("library opened folders", () => {
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
  }

  it("keeps multiple opened folders, dedupes repeated picks, and closes one root", async () => {
    const picks = ["C:\\Study\\One", "C:\\Study\\Two", "C:\\Study\\One\\"];
    Object.defineProperty(window, "studyVault", {
      configurable: true,
      value: {
        desktop: true,
        platform: "win32",
        openFile: vi.fn(),
        pickDirectory: vi.fn(() => Promise.resolve(picks.shift() ?? null))
      }
    });

    await mount();
    expect(ctx.folderRoots).toEqual([]);

    await act(async () => {
      await ctx.openFolderDialog();
    });
    await act(async () => {
      await ctx.openFolderDialog();
    });
    await act(async () => {
      await ctx.openFolderDialog();
    });

    expect(ctx.folderRoots).toEqual(["C:\\Study\\One", "C:\\Study\\Two"]);

    await act(async () => {
      ctx.closeFolderRoot("C:\\Study\\One\\");
    });

    expect(ctx.folderRoots).toEqual(["C:\\Study\\Two"]);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Reflect.deleteProperty(window, "studyVault");
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("isGenerationCommand", () => {
  it("is true for AI generation commands, false for plain ones", () => {
    expect(isGenerationCommand("note.generate-block")).toBe(true);
    expect(isGenerationCommand("operation.run")).toBe(true);
    expect(isGenerationCommand("textbook.explain-concept")).toBe(true);
    expect(isGenerationCommand("textbook.generate-practice")).toBe(true);
    // Non-generation commands never flip the flag.
    expect(isGenerationCommand("anchor.add-note")).toBe(false);
    expect(isGenerationCommand("note.delete")).toBe(false);
    expect(isGenerationCommand("layer.toggle")).toBe(false);
  });
});

describe("generating flag — set on start, cleared on done AND on error", () => {
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
  }

  it("turns on while a generate-block dispatch is in flight and off on success", async () => {
    await mount();
    expect(ctx.generating).toBe(false);

    // Fire the generation dispatch but DON'T await it — the deferred keeps it in flight.
    let dispatchDone: Promise<void>;
    await act(async () => {
      dispatchDone = ctx.dispatch("note.generate-block", { text: "make me a note" });
    });
    // Mid-flight: the shared flag is on.
    expect(entityClient.generateBlock).toHaveBeenCalled();
    expect(ctx.generating).toBe(true);

    // Resolve the request → a draft is parked and the flag clears.
    await act(async () => {
      generateBlockDeferred.resolve({ contentType: "markdown", content: "hi", provider: "mock" });
      await dispatchDone;
    });
    expect(ctx.generating).toBe(false);
    expect(ctx.pendingDraft).not.toBeNull();
  });

  it("clears the flag and surfaces the error when generation FAILS", async () => {
    await mount();

    let dispatchDone: Promise<void>;
    await act(async () => {
      dispatchDone = ctx.dispatch("note.generate-block", { text: "boom" });
    });
    expect(ctx.generating).toBe(true);

    await act(async () => {
      generateBlockDeferred.reject(new Error("generation failed"));
      await dispatchDone;
    });
    // Cleared even on failure (finally), and the error is surfaced (not silent).
    expect(ctx.generating).toBe(false);
    expect(ctx.error).toContain("generation failed");
  });
});
