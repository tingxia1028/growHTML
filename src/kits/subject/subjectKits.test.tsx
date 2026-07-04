// @vitest-environment jsdom
// Subject kits post-FLAT (kit-flatten §2 × M-B/M1/MH-0): the RUNTIME registration
// vehicles are unchanged (member PluginRecords under their per-subject kit ids,
// language + detection per subject), but user-facing they are capability GROUPS of the
// ONE Textbook Kit — the market lists no subject kit, availability follows the group
// switchboard, and legacy persisted subject-kit installs migrate losslessly.
import { afterEach, describe, expect, it } from "vitest";

// Side effects: install the Product Kits (textbook + the 3 subject registration vehicles).
import "../clientKits";

import { catalogSource } from "../catalogSource";
import { providerOf } from "../catalog";
import { listInstalledPlugins } from "../plugin";
import { installedKits, kitSurfaceItems, noteTypeOwnerKit } from "../clientContext";
import {
  isPluginEffectiveInstalled,
  resetInstallState,
  syncInstallState,
  withKitGroupEnabled,
  EMPTY_CATALOG_STATE
} from "../installState";
import { listKitDetections } from "../../core/subject/detectSubject";
import { kitContentTypeLabel } from "../language";

const record = (id: string) => listInstalledPlugins().find((p) => p.id === id);

afterEach(() => resetInstallState());

describe("F5 member registration — one PluginRecord per exemplar member, grouped under its kit", () => {
  it("each member owns its loop (noteType + command + surface) under the kit", () => {
    for (const [memberId, kitId, contentType] of [
      // M-B
      ["subject-vocab", "subject-english", "subject.vocab"],
      ["subject-formula", "subject-math", "subject.formula"],
      ["subject-timeline", "subject-history-geo", "subject.timeline"],
      // M-C — installed under their HOME kit (shared plugins install once, §8.5.2):
      // excerpt home 英语, figure home 史地, formula home 数学.
      ["subject-derivation", "subject-math", "subject.derivation"],
      ["subject-theorem", "subject-math", "subject.theorem"],
      ["subject-grammar", "subject-english", "subject.grammar"],
      ["subject-excerpt", "subject-english", "subject.excerpt"],
      ["subject-argument", "subject-chinese", "subject.argument"],
      ["subject-figure", "subject-history-geo", "subject.figure"],
      ["subject-cause-effect", "subject-history-geo", "subject.cause-effect"],
      ["subject-experiment", "subject-science", "subject.experiment"]
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

  it("the kit records keep only kit-level config (language) and stay foreground choices", () => {
    for (const kitId of [
      "subject-english",
      "subject-math",
      "subject-history-geo",
      "subject-chinese",
      "subject-science"
    ]) {
      expect(record(kitId)?.contributions.map((c) => c.kind), kitId).toEqual(["language"]);
      expect(installedKits.some((k) => k.id === kitId), kitId).toBe(true);
    }
  });

  it("kit language config lands: per-type display names resolve for the ACTIVE kit", () => {
    // M-B
    expect(kitContentTypeLabel("subject.vocab", ["subject-english"])).toBe("生词卡");
    expect(kitContentTypeLabel("subject.formula", ["subject-math"])).toBe("公式卡");
    expect(kitContentTypeLabel("subject.timeline", ["subject-history-geo"])).toBe("时间线");
    // M-C
    expect(kitContentTypeLabel("subject.derivation", ["subject-math"])).toBe("推导步骤");
    expect(kitContentTypeLabel("subject.theorem", ["subject-math"])).toBe("定理卡");
    expect(kitContentTypeLabel("subject.grammar", ["subject-english"])).toBe("语法点");
    expect(kitContentTypeLabel("subject.argument", ["subject-chinese"])).toBe("论证结构");
    expect(kitContentTypeLabel("subject.experiment", ["subject-science"])).toBe("实验记录");
    // Shared types name under EVERY owning kit's language (§8.5.2): excerpt in 英语 & 语文,
    // figure in 史地 & 语文, formula in 数学 & 理化生.
    expect(kitContentTypeLabel("subject.excerpt", ["subject-english"])).toBe("摘抄赏析");
    expect(kitContentTypeLabel("subject.excerpt", ["subject-chinese"])).toBe("摘抄赏析");
    expect(kitContentTypeLabel("subject.figure", ["subject-history-geo"])).toBe("人物卡");
    expect(kitContentTypeLabel("subject.figure", ["subject-chinese"])).toBe("人物卡");
    expect(kitContentTypeLabel("subject.formula", ["subject-science"])).toBe("公式卡");
  });

  it("detection tables register through the client install (the M-A seam, per kit)", () => {
    const ids = listKitDetections().map((t) => t.kitId);
    expect(ids).toEqual(
      expect.arrayContaining([
        "textbook-learning",
        "subject-math",
        "subject-english",
        "subject-history-geo",
        "subject-chinese",
        "subject-science"
      ])
    );
  });
});

describe("MH-0 × FLAT — the 市场 lists ONE Textbook Kit; subjects ride it as groups", () => {
  it("no subject kit listing survives; the Textbook Kit carries the subject contentTypes", async () => {
    const kits = await catalogSource("local").list({ kind: "kit" });
    expect(kits.map((l) => l.id)).toEqual(["textbook-learning"]);
    const textbook = kits[0];
    expect(textbook.contentTypes).toEqual(
      expect.arrayContaining([
        // M-B
        "subject.vocab",
        "subject.formula",
        "subject.timeline",
        // M-C
        "subject.derivation",
        "subject.theorem",
        "subject.grammar",
        "subject.excerpt",
        "subject.argument",
        "subject.figure",
        "subject.cause-effect",
        "subject.experiment"
      ])
    );
    // 5 fixed groups (explanation/practice/mistake/review-pack/textbook-language) +
    // 5 per-subject groups (英语/数学/史地/语文/理化生 — M-C adds the last two).
    expect(textbook.groupCount).toBe(10);
  });

  it("plugins are internal now — the local source never lists them", async () => {
    expect(await catalogSource("local").list({ kind: "plugin", search: "生词" })).toEqual([]);
  });
});

describe("M1/F4 × FLAT — availability follows the capability-group switchboard", () => {
  it("fresh vault (null state): subject exemplars are NOT effective; classic goods are", () => {
    expect(isPluginEffectiveInstalled("subject-vocab")).toBe(false);
    expect(isPluginEffectiveInstalled("subject-formula")).toBe(false);
    expect(isPluginEffectiveInstalled("flashcard")).toBe(true);
    expect(isPluginEffectiveInstalled("mistake")).toBe(true);
  });

  it("enabling the 数学 group lights up the formula exemplar + its toolbar item", () => {
    syncInstallState({
      catalogState: withKitGroupEnabled(
        { installedPlugins: [], installedKits: ["textbook-learning"] },
        "textbook-learning",
        "subject-math"
      ),
      userKits: []
    });
    expect(isPluginEffectiveInstalled("subject-formula")).toBe(true);
    const items = kitSurfaceItems("selection-toolbar").map((i) => i.commandId);
    expect(items).toContain("subject.generate-formula");
    // The other subject groups stay off → their items stay gated.
    expect(items).not.toContain("subject.generate-vocab");
  });

  it("LEGACY persisted subject-kit installs migrate: the old id still activates its group", () => {
    // A pre-FLAT vault that installed 数学 Kit — syncInstallState migrates defensively
    // (the server write-back is the durable half), with zero loss.
    syncInstallState({
      catalogState: { ...EMPTY_CATALOG_STATE, installedPlugins: [], installedKits: ["subject-math"] },
      userKits: []
    });
    expect(isPluginEffectiveInstalled("subject-formula")).toBe(true);
    // The legacy members-union kept quiz/mistake effective — parity preserved.
    expect(isPluginEffectiveInstalled("quiz")).toBe(true);
    expect(isPluginEffectiveInstalled("mistake")).toBe(true);
    // …and the untouched subject groups stay gated.
    expect(isPluginEffectiveInstalled("subject-vocab")).toBe(false);
  });
});
