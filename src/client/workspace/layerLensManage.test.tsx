// @vitest-environment jsdom
// LayerLensManage characterization (PLAT-LAYER §2.5 slice 8b). This surface had NO test —
// added here to PIN its 6 layer mutations (create / patch / delete / export + the import
// preview→commit pair) BEFORE the entityClient→layerIo relocation, so the move is verified.
//
// Data access is mocked at the entityClient seam (`vi.mock("../data/entityClient", …)`),
// exactly like layerViews.test. LayerLensManage now calls layerIo, and layerIo delegates at
// CALL TIME (`(...args) => entityClient.method(...args)`), so these mocks still intercept
// THROUGH the facade — that is precisely what pins the relocation.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import type { StudyLayerRecord } from "../data/entityClient";
import type { WorkspaceContext } from "./viewRegistry";

const mocks = vi.hoisted(() => ({
  createLayer: vi.fn(),
  patchLayer: vi.fn(),
  deleteLayer: vi.fn(),
  exportLayer: vi.fn(),
  importPreview: vi.fn(),
  importCommit: vi.fn()
}));

vi.mock("../data/entityClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/entityClient")>();
  return { ...actual, entityClient: { ...actual.entityClient, ...mocks } };
});

import { LayerLensManage } from "./LayerLensManage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A "Mine" parent (owned, editable) + a custom child (deletable). Both editable rows carry
// the rename/recolor/reorder/paint controls; only the custom row carries a delete button.
const LAYERS: StudyLayerRecord[] = [
  {
    id: "layer_own",
    title: "My Notes",
    visibility: "private",
    importMode: "owned",
    enabled: true,
    order: 0
  } as StudyLayerRecord,
  {
    id: "layer_custom",
    title: "错题",
    visibility: "private",
    importMode: "owned",
    enabled: true,
    role: "custom",
    parentId: "layer_own",
    order: 1
  } as StudyLayerRecord
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

function makeCtx(): WorkspaceContext {
  return {
    activeSourceId: "src_1",
    sourceLayers: LAYERS,
    refreshLayers: vi.fn()
  } as unknown as WorkspaceContext;
}

function mountManage(): { container: HTMLElement; ctx: WorkspaceContext } {
  const ctx = makeCtx();
  const container = mount(<LayerLensManage ctx={ctx} />);
  return { container, ctx };
}

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

beforeEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
  mocks.createLayer.mockResolvedValue({ layer: LAYERS[0] });
  mocks.patchLayer.mockResolvedValue({ layer: LAYERS[0] });
  mocks.deleteLayer.mockResolvedValue({ ok: true });
  mocks.exportLayer.mockResolvedValue({ pack: { packId: "p1", layer: { title: "My Notes" } } });
  mocks.importPreview.mockResolvedValue({
    preview: {
      matchedSourceId: "src_1",
      matchedBy: "hash",
      anchors: [],
      stats: { matched: 1, fuzzy: 0, unmatched: 0 }
    }
  });
  mocks.importCommit.mockResolvedValue({
    result: { layerId: "l1", sourceId: "src_1", createdAnchors: 1, importedNotes: 1, stats: { matched: 1, fuzzy: 0, unmatched: 0 } }
  });
});

describe("LayerLensManage mutations route through layerIo → entityClient", () => {
  it("createLayer: typing a title + clicking Add fires createLayer(sourceId, {title, order}) and refreshes", async () => {
    const { container, ctx } = mountManage();
    const input = container.querySelector(".layer-create-input") as HTMLInputElement;
    await act(async () => setInputValue(input, "新层"));
    const addBtn = container.querySelector(".layer-create-btn") as HTMLButtonElement;
    await act(async () => addBtn.click());
    await flush();

    expect(mocks.createLayer).toHaveBeenCalledWith("src_1", { title: "新层", order: LAYERS.length });
    expect(ctx.refreshLayers).toHaveBeenCalled();
  });

  it("patchLayer (recolor): changing the chip color input fires patchLayer(id, {color}) and refreshes", async () => {
    const { container, ctx } = mountManage();
    const colorInput = byTitle(container, "My Notes")!.querySelector(".layer-color-input") as HTMLInputElement;
    await act(async () => setInputValue(colorInput, "#123456"));
    await flush();

    expect(mocks.patchLayer).toHaveBeenCalledWith("layer_own", { color: "#123456" });
    expect(ctx.refreshLayers).toHaveBeenCalled();
  });

  it("patchLayer (restyle): changing the paint color merges onto style and refreshes", async () => {
    const { container, ctx } = mountManage();
    const paintInput = byTitle(container, "My Notes")!.querySelector(".layer-paint-input") as HTMLInputElement;
    await act(async () => setInputValue(paintInput, "#ff0000"));
    await flush();

    expect(mocks.patchLayer).toHaveBeenCalledWith("layer_own", { style: { color: "#ff0000" } });
    expect(ctx.refreshLayers).toHaveBeenCalled();
  });

  it("patchLayer (reorder): clicking Move up fires patchLayer(id, {order}) and refreshes", async () => {
    const { container, ctx } = mountManage();
    const upBtn = byTitle(container, "错题")!.querySelector(".layer-up-btn") as HTMLButtonElement;
    await act(async () => upBtn.click());
    await flush();

    // layer_custom order is 1 → up delta -1 → 0.
    expect(mocks.patchLayer).toHaveBeenCalledWith("layer_custom", { order: 0 });
    expect(ctx.refreshLayers).toHaveBeenCalled();
  });

  it("deleteLayer: confirming the delete on a custom row fires deleteLayer(id) and refreshes", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { container, ctx } = mountManage();
    const delBtn = byTitle(container, "错题")!.querySelector(".layer-delete-btn") as HTMLButtonElement;
    await act(async () => delBtn.click());
    await flush();

    expect(mocks.deleteLayer).toHaveBeenCalledWith("layer_custom");
    expect(ctx.refreshLayers).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("deleteLayer: cancelling the confirm does NOT call deleteLayer", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { container } = mountManage();
    const delBtn = byTitle(container, "错题")!.querySelector(".layer-delete-btn") as HTMLButtonElement;
    await act(async () => delBtn.click());
    await flush();

    expect(mocks.deleteLayer).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("exportLayer: clicking Export fires exportLayer(id) and downloads the pack", async () => {
    // downloadPack touches the DOM/URL — stub URL.createObjectURL/revokeObjectURL for jsdom.
    const createObjSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    const revokeObjSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const { container } = mountManage();
    const exportBtn = byTitle(container, "My Notes")!.querySelector(".layer-export-btn") as HTMLButtonElement;
    await act(async () => exportBtn.click());
    await flush();

    expect(mocks.exportLayer).toHaveBeenCalledWith("layer_own");
    createObjSpy.mockRestore();
    revokeObjSpy.mockRestore();
  });

  it("import preview→commit: choosing a file previews, then confirming commits and refreshes", async () => {
    const { container, ctx } = mountManage();

    // Step 1 — feed a file to onFile via the hidden file input's change handler.
    const fileInput = container.querySelector(".layer-import-input") as HTMLInputElement;
    const pack = { packId: "p1", layer: { title: "Imported" } };
    const file = new File([JSON.stringify(pack)], "x.studypack", { type: "application/json" });
    // jsdom File has no .text() by default in some envs — provide it.
    (file as unknown as { text: () => Promise<string> }).text = () => Promise.resolve(JSON.stringify(pack));
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
    await flush();

    expect(mocks.importPreview).toHaveBeenCalledWith(pack);

    // The preview section now shows a confirm button.
    const confirmBtn = container.querySelector(".layer-preview-confirm") as HTMLButtonElement;
    expect(confirmBtn).toBeTruthy();

    // Step 2 — confirm → commit.
    await act(async () => confirmBtn.click());
    await flush();

    expect(mocks.importCommit).toHaveBeenCalledWith(pack);
    expect(ctx.refreshLayers).toHaveBeenCalled();
  });
});
