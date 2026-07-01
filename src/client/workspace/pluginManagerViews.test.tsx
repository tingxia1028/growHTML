// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { getView, type WorkspaceContext } from "./viewRegistry";
import type { PluginRecord } from "../../kits/plugin";
import type { PluginPrefs } from "../data/entityClient";
import "./pluginManagerViews";

const CONTRIB_ID = "kit-a:surface:kit-a.explain";

const plugins: PluginRecord[] = [
  {
    id: "kit-a",
    name: "Kit A",
    kitId: "kit-a",
    contributions: [
      { id: CONTRIB_ID, kind: "surface", label: "Explain", key: "kit-a.explain" },
      { id: "kit-a:noteType:kit-a.block", kind: "noteType", label: "Block", key: "kit-a.block" }
    ]
  },
  {
    id: "core",
    name: "Core",
    contributions: [{ id: "core:noteType:markdown", kind: "noteType", label: "markdown", key: "markdown" }]
  }
];

function ctxWith(over: Partial<WorkspaceContext>): WorkspaceContext {
  const prefs: PluginPrefs = {
    disabledContributions: [],
    viewerAssociations: { byContentType: {}, byNoteId: {} },
    userKits: []
  };
  return {
    installedKits: [{ id: "kit-a", name: "Kit A" }],
    installedPlugins: plugins,
    pluginPrefs: prefs,
    setContributionEnabled: vi.fn(),
    ...over
  } as unknown as WorkspaceContext;
}

function renderPanel(ctx: WorkspaceContext): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      getView("plugin.manager")!.render({ id: "plugin-manager", kind: "plugin.manager" } as never, ctx) as React.ReactElement
    )
  );
  return { container, cleanup: () => { act(() => root.unmount()); container.remove(); } };
}

describe("plugin.manager view", () => {
  it("renders kit → plugin → contribution rows grouped by kit", () => {
    const { container, cleanup } = renderPanel(ctxWith({}));
    expect(container.textContent).toContain("Kit A");
    expect(container.textContent).toContain("Core");
    expect(container.textContent).toContain("Explain");
    expect(container.querySelectorAll(".plugin-contrib-row").length).toBe(3);
    cleanup();
  });

  it("a contribution toggle is checked when enabled and off when disabled", () => {
    const disabled = ctxWith({
      pluginPrefs: {
        disabledContributions: [CONTRIB_ID],
        viewerAssociations: { byContentType: {}, byNoteId: {} },
        userKits: []
      }
    });
    const { container, cleanup } = renderPanel(disabled);
    const row = container.querySelector(`[data-contribution-id="${CONTRIB_ID}"] input`) as HTMLInputElement;
    expect(row.checked).toBe(false);
    cleanup();
  });

  it("toggling a contribution calls setContributionEnabled(id, next)", () => {
    const setContributionEnabled = vi.fn();
    const { container, cleanup } = renderPanel(ctxWith({ setContributionEnabled }));
    const input = container.querySelector(`[data-contribution-id="${CONTRIB_ID}"] input`) as HTMLInputElement;
    // Currently enabled → clicking toggles it OFF (enabled=false).
    act(() => input.click());
    expect(setContributionEnabled).toHaveBeenCalledWith(CONTRIB_ID, false);
    cleanup();
  });

  it("shows the deferred Viewer conflicts placeholder", () => {
    const { container, cleanup } = renderPanel(ctxWith({}));
    expect(container.textContent).toContain("Viewer conflicts");
    cleanup();
  });
});
