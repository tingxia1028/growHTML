// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

// The document-level "识别为 · 更改" chip (subject-kits.md §3.6, M-A). Props-driven and
// standalone: resolution derives from the `source` prop through the pure activation
// resolver; the real textbook detection table is registered per test (the same seam
// installClientKits uses), so the chip is exercised over the shipped M-A signals.

// The host binds onClearPin to entityClient — mock the data seam (network-free).
vi.mock("../data/entityClient", () => ({
  entityClient: { updateSourceMetadata: vi.fn(() => Promise.resolve({ source: {} })) }
}));

import { KitForegroundChip, KitForegroundChipHost } from "./KitForegroundChip";
import { entityClient } from "../data/entityClient";
import { registerKitDetection, resetKitDetections } from "../../core/subject/detectSubject";
import { textbookDetection } from "../../kits/textbook-learning/detection";
import { resetInstallState } from "../../kits/installState";

const KITS = [{ id: "textbook-learning", name: "Textbook Learning Kit" }];

beforeEach(() => {
  localStorage.clear(); // default kit = the fallback (textbook-learning)
  resetKitDetections();
  registerKitDetection(textbookDetection);
});

afterEach(() => {
  resetKitDetections();
  resetInstallState();
  vi.clearAllMocks();
});

function mountChip(source: Parameters<typeof KitForegroundChip>[0]["source"]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onPin = vi.fn();
  const onClearPin = vi.fn();
  act(() => root.render(<KitForegroundChip source={source} kits={KITS} onPin={onPin} onClearPin={onClearPin} />));
  return {
    container,
    onPin,
    onClearPin,
    cleanup() {
      act(() => root.unmount());
      container.remove();
    }
  };
}

const chip = (c: HTMLElement) => c.querySelector(".kit-foreground-chip") as HTMLElement | null;
const selectValue = (select: HTMLSelectElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
};

describe("KitForegroundChip — resolution display", () => {
  it("a textbook-titled source shows 识别为 with confidence + signals in the tooltip", () => {
    const h = mountChip({ title: "人教版数学教材", sourceType: "pdf", metadata: {} });
    const el = chip(h.container)!;
    expect(el.dataset.mode).toBe("detected");
    expect(el.querySelector(".kit-chip-label")?.textContent).toContain("识别为");
    expect(el.querySelector(".kit-chip-label strong")?.textContent).toBe("Textbook Learning Kit");
    expect(el.title).toContain("识别置信度 0.70"); // title 0.6 + pdf 0.1 — explainable
    expect(el.title).toContain("title-keyword: 教材");
    h.cleanup();
  });

  it("an unmatched source falls back to the workspace default (默认)", () => {
    const h = mountChip({ title: "假期游记", metadata: {} });
    const el = chip(h.container)!;
    expect(el.dataset.mode).toBe("default");
    expect(el.querySelector(".kit-chip-label")?.textContent).toContain("默认");
    expect(el.querySelector(".kit-chip-label strong")?.textContent).toBe("Textbook Learning Kit");
    h.cleanup();
  });

  it("an explicit metadata pin shows 已固定 and beats the detection", () => {
    const h = mountChip({ title: "人教版数学教材", metadata: { activeKitIds: [] } });
    const el = chip(h.container)!;
    expect(el.dataset.mode).toBe("pin");
    expect(el.querySelector(".kit-chip-label")?.textContent).toContain("已固定");
    expect(el.querySelector(".kit-chip-label strong")?.textContent).toBe("Core"); // [] pins Core
    h.cleanup();
  });

  it("renders nothing without a source", () => {
    const h = mountChip(null);
    expect(chip(h.container)).toBeNull();
    h.cleanup();
  });
});

describe("KitForegroundChip — manual pick pins, 自动 clears", () => {
  it("更改 reveals the picker (Core + installed kits); choosing calls onPin and collapses", () => {
    const h = mountChip({ title: "人教版数学教材", metadata: {} });
    act(() => (h.container.querySelector(".kit-chip-change") as HTMLButtonElement).click());
    const select = h.container.querySelector("select.kit-chip-select") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["core", "textbook-learning"]);
    // Auto mode has nothing to clear — no 自动 button.
    expect(h.container.querySelector(".kit-chip-auto")).toBeNull();
    act(() => selectValue(select, "core"));
    expect(h.onPin).toHaveBeenCalledWith("core"); // the existing setActiveKit contract
    expect(h.container.querySelector("select.kit-chip-select")).toBeNull(); // collapsed
    h.cleanup();
  });

  it("a pinned document offers 自动 in the picker — clicking calls onClearPin", () => {
    const h = mountChip({ title: "人教版数学教材", metadata: { activeKitIds: ["textbook-learning"] } });
    act(() => (h.container.querySelector(".kit-chip-change") as HTMLButtonElement).click());
    const auto = h.container.querySelector(".kit-chip-auto") as HTMLButtonElement;
    expect(auto).toBeTruthy();
    act(() => auto.click());
    expect(h.onClearPin).toHaveBeenCalledTimes(1);
    expect(h.onPin).not.toHaveBeenCalled();
    h.cleanup();
  });
});

describe("KitForegroundChipHost — the one-line mount adapter", () => {
  it("pins via ctx.setActiveKit; clears by null-ing activeKitIds then reloading sources", async () => {
    const setActiveKit = vi.fn(() => Promise.resolve());
    const loadSources = vi.fn(() => Promise.resolve());
    const ctx = {
      activeSource: {
        id: "src_1",
        title: "人教版数学教材",
        metadata: { activeKitIds: ["textbook-learning"] }
      },
      installedKits: KITS,
      setActiveKit,
      loadSources
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<KitForegroundChipHost ctx={ctx} />));

    act(() => (container.querySelector(".kit-chip-change") as HTMLButtonElement).click());
    const select = container.querySelector("select.kit-chip-select") as HTMLSelectElement;
    act(() => selectValue(select, "core")); // a DIFFERENT value, so the change event fires
    expect(setActiveKit).toHaveBeenCalledWith("core");

    act(() => (container.querySelector(".kit-chip-change") as HTMLButtonElement).click());
    await act(async () => (container.querySelector(".kit-chip-auto") as HTMLButtonElement).click());
    expect(entityClient.updateSourceMetadata).toHaveBeenCalledWith("src_1", { activeKitIds: null });
    expect(loadSources).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    container.remove();
  });
});
