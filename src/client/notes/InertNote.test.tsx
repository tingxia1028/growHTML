// @vitest-environment jsdom
// M3b — the InertNote per-note fallback affordance (plugin-viewer-model §8.7). Threading a
// `contentType` in turns the bare inert fallback into an install prompt when the catalog
// knows a provider that is not yet effective-installed ("安装 X 以完整查看" + a click that
// installs the owning kit via the market write seam); an unknown type reads "unsupported";
// omitting contentType keeps the exact prior behavior (back-compat).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { resetCatalog } from "../../kits/catalog";
import { resetInstallState, syncInstallState } from "../../kits/installState";
import { setLocale } from "../i18n";

// Mock the market write seam; the mock syncs the install-state store exactly like the real
// entityClient, so a click updates the availability the component reads.
vi.mock("../data/entityClient", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../data/entityClient")>();
  return {
    ...mod,
    entityClient: {
      ...mod.entityClient,
      putPluginCatalog: vi.fn(() => Promise.reject(new Error("not wired in this test")))
    }
  };
});

import { entityClient } from "../data/entityClient";
import { InertNote } from "./builtinNoteTypes";

function render(node: React.ReactElement): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    }
  };
}

const click = async (el: Element | null) => {
  expect(el, "expected element to click").toBeTruthy();
  await act(async () => (el as HTMLElement).click());
};

beforeEach(() => {
  setLocale("zh");
  // Default install state: subject groups are OFF → subject.vocab's provider is NOT
  // effective-installed → the affordance should appear.
  syncInstallState({ catalogState: { installedPlugins: null, installedKits: null } });
});

afterEach(() => {
  vi.clearAllMocks();
  resetInstallState();
  resetCatalog();
  document.body.innerHTML = "";
});

describe("InertNote — M3b install affordance", () => {
  it("a cataloged-but-uninstalled type renders the install hint naming the provider", () => {
    const { container, cleanup } = render(<InertNote content={{ word: "x" }} contentType="subject.vocab" />);
    const hint = container.querySelector('.note-install-hint[data-content-type="subject.vocab"]');
    expect(hint).toBeTruthy();
    // The provider name (生词卡 Vocab) is interpolated into the localized label.
    expect(hint!.querySelector(".note-install-hint-label")!.textContent).toContain("生词卡 Vocab");
    expect(hint!.querySelector(".note-install-hint-label")!.textContent).toContain("以完整查看");
    cleanup();
  });

  it("clicking Install installs the provider's OWNING KIT through the market write seam", async () => {
    const writes: unknown[] = [];
    vi.mocked(entityClient.putPluginCatalog).mockImplementation((body) => {
      writes.push(body.catalogState);
      syncInstallState({ catalogState: body.catalogState });
      return Promise.resolve({
        prefs: {
          disabledContributions: [],
          viewerAssociations: { byContentType: {}, byNoteId: {} },
          userKits: [],
          catalogState: body.catalogState
        }
      });
    });
    const { container, cleanup } = render(<InertNote content={{ word: "x" }} contentType="subject.vocab" />);
    await click(container.querySelector(".note-install-hint-btn"));
    expect(entityClient.putPluginCatalog).toHaveBeenCalledTimes(1);
    // The owning kit (textbook-learning) enters installedKits.
    const written = writes[0] as { installedKits: string[] };
    expect(written.installedKits).toContain("textbook-learning");
    cleanup();
  });

  it("an unknown type (no provider) renders the unsupported marker, no install hint", () => {
    const { container, cleanup } = render(<InertNote content={"raw"} contentType="totally.unknown" />);
    expect(container.querySelector(".note-unsupported-type")).toBeTruthy();
    expect(container.querySelector(".note-unsupported-type")!.textContent).toBe("不支持的类型");
    expect(container.querySelector(".note-install-hint")).toBeNull();
    cleanup();
  });

  it("omitting contentType keeps the bare inert fallback (back-compat) — no hint, no marker", () => {
    const { container, cleanup } = render(<InertNote content={"legacy"} />);
    expect(container.querySelector(".note-install-hint")).toBeNull();
    expect(container.querySelector(".note-unsupported-type")).toBeNull();
    expect(container.querySelector(".note-rendered")).toBeTruthy(); // the InertText body
    cleanup();
  });

  it("an already effective-installed provider shows NO hint (renderer just absent this session)", () => {
    // flashcard is a default-installed standalone plugin → provider effective-installed.
    const { container, cleanup } = render(<InertNote content={{ front: "a", back: "b" }} contentType="flashcard" />);
    expect(container.querySelector(".note-install-hint")).toBeNull();
    expect(container.querySelector(".note-unsupported-type")).toBeNull();
    cleanup();
  });
});
