// @vitest-environment jsdom
// Subject kits as market goods (M-B × market M1/F5/MH-0): member PluginRecords under
// their kits, catalog members[] resolving against the read model, the 市场 tab listing
// through CatalogSource("local"), effective-installed gating + the §8.5.2 members-union
// refcount, and the M-A detection seam registered through the REAL client install.
import { afterEach, describe, expect, it } from "vitest";

// Side effects: install the Product Kits (textbook + review + the 3 subject kits).
import "../clientKits";

import { catalogSource } from "../catalogSource";
import { catalogKitMembers, getCatalogEntry, providerOf } from "../catalog";
import { listInstalledPlugins } from "../plugin";
import { installedKits, kitSurfaceItems, noteTypeOwnerKit } from "../clientContext";
import {
  isPluginEffectiveInstalled,
  kitRemovalOutcome,
  resetInstallState,
  syncInstallState,
  withKitInstalled,
  EMPTY_CATALOG_STATE
} from "../installState";
import { listKitDetections } from "../../core/subject/detectSubject";
import { kitContentTypeLabel } from "../language";

const record = (id: string) => listInstalledPlugins().find((p) => p.id === id);

afterEach(() => resetInstallState());

describe("F5 member registration — one PluginRecord per exemplar member, grouped under its kit", () => {
  it("each member owns its loop (noteType + command + surface) under the kit", () => {
    for (const [memberId, kitId, contentType] of [
      ["subject-vocab", "subject-english", "subject.vocab"],
      ["subject-formula", "subject-math", "subject.formula"],
      ["subject-timeline", "subject-history-geo", "subject.timeline"]
    ] as const) {
      const member = record(memberId);
      expect(member, memberId).toBeTruthy();
      expect(member!.kitId, memberId).toBe(kitId);
      expect(member!.contributions.map((c) => c.kind)).toEqual(
        expect.arrayContaining(["noteType", "command", "surface"])
      );
      expect(noteTypeOwnerKit(contentType)).toBe(memberId);
      // §8.2 ownership agreement: catalog provider === runtime owner.
      expect(providerOf(contentType)?.id).toBe(memberId);
    }
  });

  it("the kit records keep only kit-level config (language) and are activation choices", () => {
    for (const kitId of ["subject-english", "subject-math", "subject-history-geo"]) {
      expect(record(kitId)?.contributions.map((c) => c.kind), kitId).toEqual(["language"]);
      expect(installedKits.some((k) => k.id === kitId), kitId).toBe(true);
    }
  });

  it("kit language config lands: per-type display names resolve for the ACTIVE kit", () => {
    expect(kitContentTypeLabel("subject.vocab", ["subject-english"])).toBe("生词卡");
    expect(kitContentTypeLabel("subject.formula", ["subject-math"])).toBe("公式卡");
    expect(kitContentTypeLabel("subject.timeline", ["subject-history-geo"])).toBe("时间线");
  });

  it("detection tables register through the client install (the M-A seam, per kit)", () => {
    const ids = listKitDetections().map((t) => t.kitId);
    expect(ids).toEqual(
      expect.arrayContaining(["textbook-learning", "subject-math", "subject-english", "subject-history-geo"])
    );
  });
});

describe("MH-0 — the 市场 tab lists the new kits automatically via CatalogSource(\"local\")", () => {
  it("kit listings appear with member counts + the members-union contentTypes", async () => {
    const kits = await catalogSource("local").list({ kind: "kit" });
    const english = kits.find((l) => l.id === "subject-english");
    expect(english).toBeTruthy();
    expect(english!.title).toBe("英语 Kit");
    expect(english!.memberCount).toBe(2); // subject-vocab + flashcard
    expect(english!.contentTypes).toEqual(expect.arrayContaining(["subject.vocab", "flashcard"]));
    const math = kits.find((l) => l.id === "subject-math");
    expect(math!.contentTypes).toEqual(expect.arrayContaining(["subject.formula", "textbook.mistake", "quiz"]));
    expect(kits.find((l) => l.id === "subject-history-geo")).toBeTruthy();
  });

  it("plugin listings appear too, searchable by 中文 name", async () => {
    const hits = await catalogSource("local").list({ kind: "plugin", search: "生词" });
    expect(hits.map((l) => l.id)).toContain("subject-vocab");
  });
});

describe("M1/F4 — install state: opt-in kits, the members-union, the §8.5.2 refcount", () => {
  it("fresh vault (null state): subject plugins are NOT effective-installed; classic goods are", () => {
    expect(isPluginEffectiveInstalled("subject-vocab")).toBe(false);
    expect(isPluginEffectiveInstalled("subject-formula")).toBe(false);
    expect(isPluginEffectiveInstalled("flashcard")).toBe(true);
    expect(isPluginEffectiveInstalled("mistake")).toBe(true);
  });

  it("installing a kit makes its members effective (union semantics) and surfaces its toolbar item", () => {
    syncInstallState({ catalogState: withKitInstalled(EMPTY_CATALOG_STATE, "subject-math"), userKits: [] });
    expect(isPluginEffectiveInstalled("subject-formula")).toBe(true);
    const items = kitSurfaceItems("selection-toolbar").map((i) => i.commandId);
    expect(items).toContain("subject.generate-formula");
    // The other subject kits stay uninstalled → their items stay gated.
    expect(items).not.toContain("subject.generate-vocab");
  });

  it("uninstall outcome rows (§8.5.2): shared members are KEPT, the exemplar is removed", () => {
    // 数学 Kit uninstall from the default state: mistake/quiz keep their default direct
    // holds ("kept"); subject-formula loses its only hold ("removed") — 理化生 (M-C)
    // will add the second hold the design's overlap example describes.
    const rows = kitRemovalOutcome("subject-math", withKitInstalled(EMPTY_CATALOG_STATE, "subject-math"));
    expect(rows).toEqual([
      { pluginId: "subject-formula", kept: false, keptBy: [] },
      { pluginId: "mistake", kept: true, keptBy: ["direct", "textbook-learning"] },
      { pluginId: "quiz", kept: true, keptBy: ["direct"] }
    ]);
  });

  it("catalog kit members[] resolve to cataloged plugin entries, including the referenced existing plugins", () => {
    expect(catalogKitMembers("subject-english")).toContain("flashcard");
    expect(catalogKitMembers("subject-math")).toContain("quiz");
    for (const kitId of ["subject-english", "subject-math", "subject-history-geo"]) {
      for (const member of catalogKitMembers(kitId)) {
        expect(getCatalogEntry(member)?.kind, `${kitId} member ${member}`).toBe("plugin");
      }
    }
  });
});
