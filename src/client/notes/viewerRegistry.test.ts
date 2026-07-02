import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerViewer,
  resolveViewer,
  resetViewers,
  getViewer,
  listViewers,
  NOTETYPE_SENTINEL,
  type Viewer,
  type ViewerInput
} from "./viewerRegistry";
import type { NoteRecord, PluginPrefs } from "../data/entityClient";
import { isPipeTable, registerTableViewer } from "./tableViewer";
import { registerCatalogEntry, resetCatalog } from "../../kits/catalog";
import { resetInstallState, syncInstallState } from "../../kits/installState";

// A minimal viewer factory — `score` is a constant match() result unless a `match` fn is
// given; `render` is irrelevant to the resolver (it never renders in these tests).
function viewer(over: Partial<Viewer> & { id: string }): Viewer {
  return {
    label: over.id,
    match: () => 1,
    render: () => null,
    ...over
  };
}

const EMPTY_PREFS: PluginPrefs = {
  disabledContributions: [],
  viewerAssociations: { byContentType: {}, byNoteId: {} },
  userKits: []
};

function prefsWith(over: Partial<PluginPrefs["viewerAssociations"]>): PluginPrefs {
  return { ...EMPTY_PREFS, viewerAssociations: { ...EMPTY_PREFS.viewerAssociations, ...over } };
}

function noteWith(over: Partial<NoteRecord>): NoteRecord {
  return {
    id: "n1",
    contentType: "markdown",
    content: "",
    anchorIds: [],
    layerIds: [],
    ...over
  } as NoteRecord;
}

beforeEach(() => resetViewers());
afterEach(() => vi.restoreAllMocks());

describe("viewerRegistry basics", () => {
  it("register / get / list / reset", () => {
    registerViewer(viewer({ id: "a" }));
    registerViewer(viewer({ id: "b" }));
    expect(listViewers().map((v) => v.id)).toEqual(["a", "b"]);
    expect(getViewer("a")?.id).toBe("a");
    // Re-register replaces in place (keeps order).
    registerViewer(viewer({ id: "a", label: "A2" }));
    expect(getViewer("a")?.label).toBe("A2");
    expect(listViewers().map((v) => v.id)).toEqual(["a", "b"]);
    resetViewers();
    expect(listViewers()).toHaveLength(0);
  });
});

describe("resolveViewer — the 5-tier chain (§4)", () => {
  it("tier 5 (fallback): no viewer matches → notetype sentinel", () => {
    registerViewer(viewer({ id: "a", match: () => 0 }));
    const r = resolveViewer({ contentType: "markdown" }, EMPTY_PREFS);
    expect(r.viewerId).toBe(NOTETYPE_SENTINEL);
    expect(r.source).toBe("fallback");
    expect(r.candidates).toEqual([]);
  });

  it("no prefs at all → still falls back", () => {
    const r = resolveViewer({ contentType: "markdown" });
    expect(r.viewerId).toBe(NOTETYPE_SENTINEL);
    expect(r.source).toBe("fallback");
  });

  it("tier 2 (match): highest score wins", () => {
    registerViewer(viewer({ id: "low", match: () => 1 }));
    registerViewer(viewer({ id: "high", match: () => 5 }));
    const r = resolveViewer({ contentType: "x" }, EMPTY_PREFS);
    expect(r.viewerId).toBe("high");
    expect(r.source).toBe("match");
    // candidates sorted most-specific first.
    expect(r.candidates.map((c) => c.id)).toEqual(["high", "low"]);
  });

  it("tier 3 (priority): equal score → higher priority wins", () => {
    registerViewer(viewer({ id: "p0", match: () => 2, priority: 0 }));
    registerViewer(viewer({ id: "p9", match: () => 2, priority: 9 }));
    const r = resolveViewer({ contentType: "x" }, EMPTY_PREFS);
    expect(r.viewerId).toBe("p9");
    expect(r.source).toBe("priority");
  });

  it("tier 4 (order): equal score AND equal priority → last-registered wins + console.warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerViewer(viewer({ id: "first", match: () => 3, priority: 1 }));
    registerViewer(viewer({ id: "second", match: () => 3, priority: 1 }));
    const r = resolveViewer({ contentType: "x" }, EMPTY_PREFS);
    expect(r.viewerId).toBe("second");
    expect(r.source).toBe("order");
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0][0] as string;
    expect(msg).toContain("first");
    expect(msg).toContain("second");
  });
});

describe("resolveViewer — tier 1 user association (highest)", () => {
  it("byContentType pin honored when the viewer still matches", () => {
    registerViewer(viewer({ id: "table", match: () => 1 }));
    registerViewer(viewer({ id: "other", match: () => 9 })); // would win tier 2
    const r = resolveViewer({ contentType: "markdown" }, prefsWith({ byContentType: { markdown: "table" } }));
    expect(r.viewerId).toBe("table");
    expect(r.source).toBe("user");
  });

  it("byNoteId beats byContentType", () => {
    registerViewer(viewer({ id: "byType", match: () => 1 }));
    registerViewer(viewer({ id: "byNote", match: () => 1 }));
    const prefs = prefsWith({ byContentType: { markdown: "byType" }, byNoteId: { n1: "byNote" } });
    const r = resolveViewer({ note: noteWith({ id: "n1", contentType: "markdown" }), contentType: "markdown" }, prefs);
    expect(r.viewerId).toBe("byNote");
    expect(r.source).toBe("user");
  });

  it("user pin beats match() score (pin overrides a higher-scoring viewer)", () => {
    registerViewer(viewer({ id: "pinned", match: () => 1 }));
    registerViewer(viewer({ id: "winner", match: () => 100 }));
    const r = resolveViewer({ contentType: "md" }, prefsWith({ byContentType: { md: "pinned" } }));
    expect(r.viewerId).toBe("pinned");
    expect(r.source).toBe("user");
  });

  it("the notetype sentinel can be pinned to FORCE the note-type renderer over a matching viewer", () => {
    registerViewer(viewer({ id: "table", match: () => 5 }));
    const r = resolveViewer({ contentType: "markdown" }, prefsWith({ byContentType: { markdown: NOTETYPE_SENTINEL } }));
    expect(r.viewerId).toBe(NOTETYPE_SENTINEL);
    expect(r.source).toBe("user");
    // candidates still listed so "Open with…" can offer them.
    expect(r.candidates.map((c) => c.id)).toContain("table");
  });

  it("a STALE pin (viewer no longer matches) is ignored → chain continues", () => {
    registerViewer(viewer({ id: "stale", match: () => 0 })); // declines
    registerViewer(viewer({ id: "live", match: () => 2 }));
    const r = resolveViewer({ contentType: "markdown" }, prefsWith({ byContentType: { markdown: "stale" } }));
    expect(r.viewerId).toBe("live");
    expect(r.source).toBe("match");
  });
});

describe("Table viewer match() rule", () => {
  it("isPipeTable: true for a GFM pipe table", () => {
    expect(isPipeTable("| a | b |\n| --- | --- |\n| 1 | 2 |")).toBe(true);
    expect(isPipeTable("| Name | Age |\n|:----|----:|")).toBe(true);
  });

  it("isPipeTable: false for plain markdown / prose / a single pipe line", () => {
    expect(isPipeTable("just some text")).toBe(false);
    expect(isPipeTable("| a | b |")).toBe(false); // header but no separator
    expect(isPipeTable("# heading\n\nparagraph")).toBe(false);
    expect(isPipeTable("")).toBe(false);
  });

  it("the registered Table viewer wins for a table note and declines otherwise", () => {
    resetViewers();
    registerTableViewer();
    const tableNote = noteWith({ content: "| a | b |\n| --- | --- |\n| 1 | 2 |" });
    const proseNote = noteWith({ content: "hello world" });
    const tableInput: ViewerInput = { note: tableNote, contentType: "markdown" };
    const proseInput: ViewerInput = { note: proseNote, contentType: "markdown" };
    expect(resolveViewer(tableInput, EMPTY_PREFS).viewerId).toBe("core:table");
    expect(resolveViewer(proseInput, EMPTY_PREFS).viewerId).toBe(NOTETYPE_SENTINEL);
  });
});

// —— M1 (§8.5.1): viewers of a NOT-effective-installed plugin DECLINE — filtered from
// the candidate set so display falls down the chain to the NoteType renderer. Pins
// pointing at a now-ineligible viewer are ignored (the stale-pin rule covers them).
describe("marketplace eligibility — uninstalled plugin's viewer declines", () => {
  afterEach(() => {
    resetInstallState();
    resetCatalog();
  });

  it("an uninstalled cataloged plugin's viewer is not a candidate; reinstalling restores it", () => {
    registerCatalogEntry({
      id: "fancy-viewer-plugin",
      kind: "plugin",
      name: "Fancy",
      description: "",
      defaultInstalled: true,
      source: "bundled"
    });
    registerViewer(viewer({ id: "fancy", pluginId: "fancy-viewer-plugin", match: () => 5 }));

    // Default install state (null = default-installed) → eligible.
    expect(resolveViewer({ contentType: "markdown" }, EMPTY_PREFS).viewerId).toBe("fancy");

    // Uninstalled → declines; fallback to the NoteType renderer (pre-viewer behavior).
    syncInstallState({ catalogState: { installedPlugins: [], installedKits: [] }, userKits: [] });
    const r = resolveViewer({ contentType: "markdown" }, EMPTY_PREFS);
    expect(r.viewerId).toBe(NOTETYPE_SENTINEL);
    expect(r.candidates).toEqual([]);

    // A pin at the ineligible viewer is ignored (stale-pin rule → chain continues).
    const pinned = resolveViewer({ contentType: "markdown" }, prefsWith({ byContentType: { markdown: "fancy" } }));
    expect(pinned.viewerId).toBe(NOTETYPE_SENTINEL);

    // Direct reinstall restores eligibility.
    syncInstallState({ catalogState: { installedPlugins: ["fancy-viewer-plugin"], installedKits: [] }, userKits: [] });
    expect(resolveViewer({ contentType: "markdown" }, EMPTY_PREFS).viewerId).toBe("fancy");
  });

  it("viewers with no/uncataloged pluginId are always eligible", () => {
    registerViewer(viewer({ id: "anon", match: () => 1 }));
    registerViewer(viewer({ id: "test-owned", pluginId: "not-in-catalog", match: () => 2 }));
    syncInstallState({ catalogState: { installedPlugins: [], installedKits: [] }, userKits: [] });
    expect(resolveViewer({ contentType: "markdown" }, EMPTY_PREFS).viewerId).toBe("test-owned");
  });
});
