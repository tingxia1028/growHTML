import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CORE_KIT_ID, effectiveKitIds } from "./activation";
import { installClientKits, kitSurfaceItems, noteTypeOwnerKit } from "./clientContext";
import type { ProductKit } from "./types";

// effectiveKitIds — the pure per-source resolver (no localStorage). Source metadata
// wins; an empty array means "Core"; absent metadata inherits the workspace default.
describe("effectiveKitIds", () => {
  it("uses the workspace default when source metadata has no array", () => {
    expect(effectiveKitIds(undefined, "textbook-learning")).toEqual(["textbook-learning"]);
    expect(effectiveKitIds(null, "textbook-learning")).toEqual(["textbook-learning"]);
    expect(effectiveKitIds("nope", "textbook-learning")).toEqual(["textbook-learning"]);
  });

  it("treats an explicit array as authoritative (incl. empty = Core)", () => {
    expect(effectiveKitIds([], "textbook-learning")).toEqual([]);
    expect(effectiveKitIds(["textbook-learning"], "textbook-learning")).toEqual(["textbook-learning"]);
    expect(effectiveKitIds(["a", "b"], "x")).toEqual(["a", "b"]);
  });

  it("yields Core ([]) when the default is core/empty and no metadata", () => {
    expect(effectiveKitIds(undefined, CORE_KIT_ID)).toEqual([]);
    expect(effectiveKitIds(undefined, null)).toEqual([]);
  });

  it("filters non-strings and the core sentinel out of a metadata array", () => {
    expect(effectiveKitIds(["textbook-learning", CORE_KIT_ID, 5, null], "x")).toEqual(["textbook-learning"]);
  });
});

// Per-source gate: the host filters surface items + note-type ownership by the active
// kit ids. Install a tiny fake kit so the test doesn't depend on the textbook kit.
const fakeKit: ProductKit = {
  id: "test-kit",
  name: "Test Kit",
  description: "fake",
  install(ctx) {
    ctx.surfaces.contribute("selection-toolbar", [{ commandId: "test.cmd", title: "Test", priority: 50 }]);
    ctx.noteTypes.register(
      {
        contentType: "test.block",
        schema: z.string(),
        createDefault: () => "",
        toSearchText: (c) => String(c)
      },
      { render: () => null, edit: () => null }
    );
  }
};

describe("kit activation filtering", () => {
  installClientKits([fakeKit]);

  it("returns a kit's surface items only when its id is in the active set", () => {
    const has = (kitIds?: string[]) =>
      kitSurfaceItems("selection-toolbar", kitIds).some((i) => i.commandId === "test.cmd");
    expect(has(["test-kit"])).toBe(true); // active
    expect(has([])).toBe(false); // Core — gated out
    expect(has(["other"])).toBe(false); // a different kit active
    expect(has(undefined)).toBe(true); // omitted = all (back-compat)
  });

  it("tags kit note types with their owning kit; core/built-in types have no owner", () => {
    expect(noteTypeOwnerKit("test.block")).toBe("test-kit");
    expect(noteTypeOwnerKit("markdown")).toBeUndefined();
  });
});
