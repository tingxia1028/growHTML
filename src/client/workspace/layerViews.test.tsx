// @vitest-environment jsdom
// svpack entry points in the Layers pane (batch C): the 分享… action appears only on
// shareable rows (own content — never a shared/imported row, never a sealed one), the
// panel header carries the one 导入 .svpack button, and clicking 分享… opens the export
// dialog from svpackViews. Data access is mocked at the entityClient seam.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import type { WorkspaceNode } from "../data/entityClient";
import type { WorkspaceContext } from "./viewRegistry";

const mocks = vi.hoisted(() => ({
  layers: vi.fn(),
  sealedImports: vi.fn(),
  patchLayer: vi.fn()
}));

vi.mock("../data/entityClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/entityClient")>();
  return { ...actual, entityClient: { ...actual.entityClient, ...mocks } };
});

import { getView } from "./viewRegistry";
import "./layerViews";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LAYERS = [
  { id: "layer_own", title: "My Notes", visibility: "private", importMode: "owned", enabled: true },
  {
    id: "layer_preview",
    title: "预习",
    visibility: "private",
    importMode: "owned",
    enabled: true,
    role: "preset",
    parentId: "layer_own"
  },
  {
    id: "layer_custom",
    title: "错题",
    visibility: "private",
    importMode: "owned",
    enabled: true,
    role: "custom",
    parentId: "layer_own"
  },
  { id: "layer_shared", title: "同学的层", visibility: "private", importMode: "imported", enabled: true, role: "shared" },
  {
    id: "layer_sealed",
    title: "王老师的层",
    visibility: "private",
    importMode: "imported",
    enabled: true,
    role: "shared",
    sealed: true
  }
];

let root: Root | null = null;

function mount(node: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
  mocks.layers.mockResolvedValue({ layers: LAYERS });
  mocks.sealedImports.mockResolvedValue({ packs: [] });
  mocks.patchLayer.mockResolvedValue({ layer: LAYERS[0] });
});

function makeCtx(): WorkspaceContext {
  return {
    activeSourceId: "src_1",
    layersVersion: 0,
    enabledLayerIds: new Set(LAYERS.filter((layer) => layer.enabled).map((layer) => layer.id)),
    refreshLayers: vi.fn(),
    toggleLayerFilter: vi.fn(),
    setLayersEnabled: vi.fn(async () => undefined)
  } as unknown as WorkspaceContext;
}

async function mountSwitcher(): Promise<HTMLElement> {
  const plugin = getView("layer.switcher");
  expect(plugin).toBeTruthy();
  const node = { id: "layers", kind: "layer.switcher" } as WorkspaceNode;
  const container = mount(<>{plugin!.render(node, makeCtx())}</>);
  await flush();
  return container;
}

// Same as mountSwitcher but hands back the ctx too, so a test can assert on its spies
// (refreshLayers) after driving the paint controls.
async function mountSwitcherWithCtx(): Promise<{ container: HTMLElement; ctx: WorkspaceContext }> {
  const plugin = getView("layer.switcher");
  expect(plugin).toBeTruthy();
  const node = { id: "layers", kind: "layer.switcher" } as WorkspaceNode;
  const ctx = makeCtx();
  const container = mount(<>{plugin!.render(node, ctx)}</>);
  await flush();
  return { container, ctx };
}

describe("layerViews svpack entry points", () => {
  it("renders the parentId tree without a fixed Stages group", async () => {
    const container = await mountSwitcher();

    expect(container.textContent).not.toContain("Stages");
    expect(container.textContent).toContain("Mine");

    const items = Array.from(container.querySelectorAll<HTMLElement>(".layer-item"));
    const mine = items.find((item) => item.textContent?.includes("My Notes"));
    const preview = items.find((item) => item.textContent?.includes("预习"));
    expect(mine?.style.paddingLeft).toBe("10px");
    expect(preview?.style.paddingLeft).toBe("24px");
  });

  it("shows 分享… only on non-shared, non-sealed rows and 导入 .svpack in the header", async () => {
    const container = await mountSwitcher();

    // Header: exactly one protected-import button.
    expect(container.querySelectorAll(".svpack-import-open-btn")).toHaveLength(1);
    expect(container.querySelector(".svpack-import-open-btn")?.textContent).toContain("导入 .svpack");

    const items = Array.from(container.querySelectorAll(".layer-item"));
    const byTitle = (title: string) => items.find((item) => item.textContent?.includes(title));
    expect(byTitle("My Notes")?.querySelector(".layer-share-btn")).toBeTruthy();
    expect(byTitle("错题")?.querySelector(".layer-share-btn")).toBeTruthy();
    expect(byTitle("同学的层")?.querySelector(".layer-share-btn")).toBeNull();
    expect(byTitle("王老师的层")?.querySelector(".layer-share-btn")).toBeNull();
  });

  it("opens the export dialog for the clicked layer", async () => {
    const container = await mountSwitcher();
    expect(document.querySelector(".svpack-dialog")).toBeNull();

    const owned = Array.from(container.querySelectorAll(".layer-item")).find((item) =>
      item.textContent?.includes("My Notes")
    );
    act(() => (owned!.querySelector(".layer-share-btn") as HTMLButtonElement).click());

    const dialog = document.querySelector(".svpack-dialog");
    expect(dialog).toBeTruthy();
    expect(dialog?.getAttribute("aria-label")).toContain("分享「My Notes」");
  });

  it("opens the import dialog from the header button", async () => {
    const container = await mountSwitcher();
    act(() => (container.querySelector(".svpack-import-open-btn") as HTMLButtonElement).click());
    await flush();
    const dialog = document.querySelector(".svpack-dialog");
    expect(dialog?.getAttribute("aria-label")).toContain("导入 .svpack");
    expect(mocks.sealedImports).toHaveBeenCalled();
  });
});

// R7min (N2 D3a made reachable): the per-layer PAINT control (highlight color + decoration)
// lives on the reachable LayerSwitcherView editable rows, writing `style` through
// patchLayer and repainting via refreshLayers.
describe("layerViews D3a paint control", () => {
  const byTitle = (container: HTMLElement, title: string) =>
    Array.from(container.querySelectorAll<HTMLElement>(".layer-item")).find((item) =>
      item.textContent?.includes(title)
    );

  // Fire a React-controlled change: use the native value setter so React sees the update.
  function setInputValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("renders the paint controls on editable rows and NOT on shared/protected rows", async () => {
    const container = await mountSwitcher();

    // Editable (owned Mine + custom) rows carry both controls.
    expect(byTitle(container, "My Notes")?.querySelector(".layer-paint-input")).toBeTruthy();
    expect(byTitle(container, "My Notes")?.querySelector(".layer-deco-select")).toBeTruthy();
    expect(byTitle(container, "错题")?.querySelector(".layer-paint-input")).toBeTruthy();
    expect(byTitle(container, "错题")?.querySelector(".layer-deco-select")).toBeTruthy();

    // Preset (owned but role=preset) is not editable → no paint control.
    expect(byTitle(container, "预习")?.querySelector(".layer-paint-input")).toBeNull();
    // Shared + sealed/protected rows → no paint control.
    expect(byTitle(container, "同学的层")?.querySelector(".layer-paint-input")).toBeNull();
    expect(byTitle(container, "同学的层")?.querySelector(".layer-deco-select")).toBeNull();
    expect(byTitle(container, "王老师的层")?.querySelector(".layer-paint-input")).toBeNull();
    expect(byTitle(container, "王老师的层")?.querySelector(".layer-deco-select")).toBeNull();
  });

  it("changing the paint color patches style.color (merged) and refreshes the paint pipeline", async () => {
    const { container, ctx } = await mountSwitcherWithCtx();
    const input = byTitle(container, "My Notes")!.querySelector(".layer-paint-input") as HTMLInputElement;
    await act(async () => setInputValue(input, "#ff0000"));
    await flush();

    expect(mocks.patchLayer).toHaveBeenCalledWith("layer_own", { style: { color: "#ff0000" } });
    // The paint style feeds the pipeline → the reader must re-tint.
    expect(ctx.refreshLayers).toHaveBeenCalled();
  });

  it("changing the decoration patches style.decoration and refreshes the paint pipeline", async () => {
    const { container, ctx } = await mountSwitcherWithCtx();
    const select = byTitle(container, "My Notes")!.querySelector(".layer-deco-select") as HTMLSelectElement;
    await act(async () => setInputValue(select, "underline"));
    await flush();

    expect(mocks.patchLayer).toHaveBeenCalledWith("layer_own", { style: { decoration: "underline" } });
    expect(ctx.refreshLayers).toHaveBeenCalled();
  });

  it("merges the new patch onto the layer's EXISTING style (color keeps decoration)", async () => {
    // A layer that already carries a decoration in its style.
    mocks.layers.mockResolvedValue({
      layers: [{ ...LAYERS[0], style: { decoration: "underline" } }, ...LAYERS.slice(1)]
    });
    const { container } = await mountSwitcherWithCtx();
    const input = byTitle(container, "My Notes")!.querySelector(".layer-paint-input") as HTMLInputElement;
    await act(async () => setInputValue(input, "#00ff00"));
    await flush();

    // Setting the color preserves the pre-existing decoration.
    expect(mocks.patchLayer).toHaveBeenCalledWith("layer_own", {
      style: { decoration: "underline", color: "#00ff00" }
    });
  });
});
