import { beforeEach, describe, expect, it } from "vitest";
import {
  listInstalledPlugins,
  namespaceId,
  registerContribution,
  registerPlugin,
  resetPlugins
} from "./plugin";

describe("plugin registry (Kit & Plugin read model)", () => {
  beforeEach(() => resetPlugins());

  it("namespaceId builds `pluginId:kind:key`, falling back to the kind when key is absent", () => {
    expect(namespaceId("textbook", "noteType", "textbook.explanation")).toBe(
      "textbook:noteType:textbook.explanation"
    );
    expect(namespaceId("core", "language")).toBe("core:language:language");
  });

  it("registerContribution creates the plugin record if absent and attaches the contribution", () => {
    registerContribution("kit-a", {
      id: namespaceId("kit-a", "command", "kit-a.do"),
      kind: "command",
      label: "Do It",
      key: "kit-a.do"
    });
    const plugins = listInstalledPlugins();
    expect(plugins).toHaveLength(1);
    expect(plugins[0].id).toBe("kit-a");
    expect(plugins[0].contributions).toHaveLength(1);
    expect(plugins[0].contributions[0].label).toBe("Do It");
  });

  it("registerContribution de-dupes by contribution id (re-register updates in place)", () => {
    const id = namespaceId("kit-a", "surface", "kit-a.cmd");
    registerContribution("kit-a", { id, kind: "surface", label: "First", key: "kit-a.cmd" });
    registerContribution("kit-a", { id, kind: "surface", label: "Second", key: "kit-a.cmd" });
    const plugin = listInstalledPlugins()[0];
    expect(plugin.contributions).toHaveLength(1);
    expect(plugin.contributions[0].label).toBe("Second");
  });

  it("registerPlugin adds a record and replaces an existing one by id (last-wins)", () => {
    registerPlugin({ id: "kit-a", name: "Kit A", kitId: "kit-a", contributions: [] });
    registerPlugin({ id: "kit-b", name: "Kit B", kitId: "kit-b", contributions: [] });
    expect(listInstalledPlugins().map((p) => p.id)).toEqual(["kit-a", "kit-b"]);

    registerPlugin({ id: "kit-a", name: "Kit A v2", kitId: "kit-a", contributions: [] });
    expect(listInstalledPlugins()).toHaveLength(2);
    expect(listInstalledPlugins().find((p) => p.id === "kit-a")?.name).toBe("Kit A v2");
  });

  it("registerPlugin then registerContribution attach to the same record", () => {
    registerPlugin({ id: "kit-a", name: "Kit A", kitId: "kit-a", contributions: [] });
    registerContribution("kit-a", {
      id: namespaceId("kit-a", "noteType", "kit-a.block"),
      kind: "noteType",
      label: "Block",
      key: "kit-a.block"
    });
    const plugin = listInstalledPlugins()[0];
    expect(plugin.name).toBe("Kit A");
    expect(plugin.contributions).toHaveLength(1);
  });

  it("resetPlugins clears the registry", () => {
    registerPlugin({ id: "kit-a", name: "Kit A", contributions: [] });
    expect(listInstalledPlugins()).toHaveLength(1);
    resetPlugins();
    expect(listInstalledPlugins()).toHaveLength(0);
  });
});
