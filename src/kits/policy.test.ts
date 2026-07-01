import { describe, expect, it } from "vitest";
import { isExportableContentType, isPrivateByDefault, registerKitLayerPolicy, stagePresetForKits } from "./policy";
import { textbookLayerPolicy } from "./textbook-learning/policy";

describe("kit layer policy", () => {
  it("marks textbook.mistake private-by-default (excluded from export) and others exportable", () => {
    registerKitLayerPolicy(textbookLayerPolicy); // idempotent

    expect(isPrivateByDefault("textbook.mistake")).toBe(true);
    expect(isExportableContentType("textbook.mistake")).toBe(false);

    expect(isPrivateByDefault("textbook.explanation")).toBe(false);
    expect(isExportableContentType("textbook.explanation")).toBe(true);
    expect(isExportableContentType("textbook.exercise")).toBe(true);
    expect(isExportableContentType("textbook.review-pack")).toBe(true);
    // Generic (non-kit) note types stay exportable — no policy applies.
    expect(isExportableContentType("markdown")).toBe(true);
  });

  it("re-registering the same kit policy is a no-op (idempotent)", () => {
    registerKitLayerPolicy(textbookLayerPolicy);
    registerKitLayerPolicy(textbookLayerPolicy);
    expect(isPrivateByDefault("textbook.mistake")).toBe(true);
  });
});

describe("kit stage-axis preset (F7a: the stage taxonomy is a kit opinion, not core)", () => {
  it("the textbook policy exposes the 4 stages in order (moved out of core PRESET_STAGES)", () => {
    expect(textbookLayerPolicy.stagePreset).toEqual([
      { title: "预习", order: 0 },
      { title: "学习", order: 1 },
      { title: "复习", order: 2 },
      { title: "拓展", order: 3 }
    ]);
  });

  it("stagePresetForKits returns the active kit's axis; Core ([]) or an unknown kit yields none", () => {
    registerKitLayerPolicy(textbookLayerPolicy); // idempotent
    expect(stagePresetForKits(["textbook-learning"]).map((s) => s.title)).toEqual(["预习", "学习", "复习", "拓展"]);
    expect(stagePresetForKits([])).toEqual([]);
    expect(stagePresetForKits(["no-such-kit"])).toEqual([]);
  });

  it("a registered policy WITHOUT a stagePreset contributes no axis", () => {
    // Empty content-type lists so this fake never pollutes the export-filter globals.
    registerKitLayerPolicy({
      kitId: "axisless-kit",
      exportableContentTypes: [],
      privateByDefaultContentTypes: [],
      copyableContentTypes: []
    });
    expect(stagePresetForKits(["axisless-kit"])).toEqual([]);
  });

  it("concatenates multiple kits' axes in kit order and dedupes by title (first kit's order wins)", () => {
    registerKitLayerPolicy({
      kitId: "kit-a",
      exportableContentTypes: [],
      privateByDefaultContentTypes: [],
      copyableContentTypes: [],
      stagePreset: [
        { title: "词汇", order: 0 },
        { title: "语法", order: 1 }
      ]
    });
    registerKitLayerPolicy({
      kitId: "kit-b",
      exportableContentTypes: [],
      privateByDefaultContentTypes: [],
      copyableContentTypes: [],
      // 语法 duplicates kit-a's title — kit-a's order (1) must win, not kit-b's 9.
      stagePreset: [
        { title: "语法", order: 9 },
        { title: "听力", order: 2 }
      ]
    });
    expect(stagePresetForKits(["kit-a", "kit-b"])).toEqual([
      { title: "词汇", order: 0 },
      { title: "语法", order: 1 },
      { title: "听力", order: 2 }
    ]);
  });
});
