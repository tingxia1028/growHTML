// Catalog read-model tests (M1 §8.1/§8.2, FLAT-amended per kit-flatten §2): the
// bundled entries' structural invariants, the providerOf index, the hidden-core rule,
// and the ONE-Textbook-Kit capability-group shape (subject kits merged as groups).
import { afterEach, describe, expect, it } from "vitest";
import {
  catalogKitMembers,
  defaultDisabledGroupIds,
  defaultInstalledIds,
  getCatalogEntry,
  groupOwnerOf,
  isCataloged,
  kitCapabilityGroups,
  listCatalogEntries,
  providerOf,
  registerCatalogEntry,
  resetCatalog
} from "./catalog";

afterEach(() => resetCatalog());

describe("bundled catalog invariants (§8.1 × FLAT)", () => {
  it("ids are unique, every entry is bundled; only STANDALONE plugins + the kit stay defaultInstalled", () => {
    const entries = listCatalogEntries();
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of entries) {
      expect(entry.source, `${entry.id} source`).toBe("bundled");
      expect(entry.description.length, `${entry.id} needs a description`).toBeGreaterThan(0);
      // FLAT: group-owned member plugins are NOT install units — their default
      // availability flows from the kit's enabled groups, so defaultInstalled is false.
      const owned = entry.kind === "plugin" && groupOwnerOf(entry.id) !== undefined;
      if (owned) expect(entry.defaultInstalled, `${entry.id} is group-owned`).toBe(false);
    }
    expect(defaultInstalledIds("plugin")).toEqual(["flashcard", "quiz", "bookmark", "diagrams", "table-viewer"]);
    expect(defaultInstalledIds("kit")).toEqual(["textbook-learning"]);
  });

  it("every kit member resolves to a kind:plugin entry (F5 members[] resolution)", () => {
    for (const kit of listCatalogEntries().filter((e) => e.kind === "kit")) {
      expect((kit.members ?? []).length).toBeGreaterThan(0);
      for (const memberId of kit.members ?? []) {
        const member = getCatalogEntry(memberId);
        expect(member, `${kit.id} member ${memberId} must be cataloged`).toBeTruthy();
        expect(member!.kind).toBe("plugin");
      }
    }
  });

  it("FLAT §2: ONE kit — the subject kits are GONE as entries, merged as per-subject groups", () => {
    expect(listCatalogEntries().filter((e) => e.kind === "kit").map((e) => e.id)).toEqual(["textbook-learning"]);
    for (const legacyKitId of ["subject-english", "subject-math", "subject-history-geo"]) {
      expect(getCatalogEntry(legacyKitId), legacyKitId).toBeUndefined();
    }
    expect(catalogKitMembers("textbook-learning")).toEqual([
      "explanation",
      "practice",
      "mistake",
      "review-pack",
      "textbook-language",
      "subject-vocab",
      "subject-formula",
      "subject-timeline"
    ]);
  });

  it("capability groups: bilingual names, members ⊆ kit members, opt-in subjects default-disabled", () => {
    const kit = getCatalogEntry("textbook-learning")!;
    const groups = kitCapabilityGroups("textbook-learning");
    expect(groups.map((g) => g.id)).toEqual([
      "explanation",
      "practice",
      "mistake",
      "review-pack",
      "textbook-language",
      "subject-english",
      "subject-math",
      "subject-history-geo"
    ]);
    for (const group of groups) {
      expect(group.name.zh.length, `${group.id} zh name`).toBeGreaterThan(0);
      expect(group.name.en.length, `${group.id} en name`).toBeGreaterThan(0);
      for (const member of group.members) {
        expect(kit.members, `${group.id} member ${member} must be a kit member`).toContain(member);
      }
    }
    expect(defaultDisabledGroupIds("textbook-learning")).toEqual([
      "subject-english",
      "subject-math",
      "subject-history-geo"
    ]);
  });

  it("groupOwnerOf: member plugins are group-owned; standalone plugins are not", () => {
    expect(groupOwnerOf("explanation")).toEqual({ kitId: "textbook-learning", groupId: "explanation" });
    expect(groupOwnerOf("subject-vocab")).toEqual({ kitId: "textbook-learning", groupId: "subject-english" });
    for (const id of ["flashcard", "quiz", "bookmark", "diagrams", "table-viewer", "unknown"]) {
      expect(groupOwnerOf(id), id).toBeUndefined();
    }
  });

  it("kitCapabilityGroups synthesizes per-member groups for kits without a groups declaration", () => {
    registerCatalogEntry({
      id: "kit-x",
      kind: "kit",
      name: "Kit X",
      description: "x",
      members: ["flashcard", "quiz"],
      defaultInstalled: false,
      source: "bundled"
    });
    const groups = kitCapabilityGroups("kit-x");
    expect(groups.map((g) => g.id)).toEqual(["flashcard", "quiz"]);
    expect(groups[0].members).toEqual(["flashcard"]);
    expect(groups[0].name.en).toBe("Flashcard"); // named from the member entry
    expect(kitCapabilityGroups("flashcard")).toEqual([]); // plugins have no groups
  });

  it("HIDES core primitives — no catalog entry for the always-on content basics", () => {
    for (const id of ["markdown", "plain-text", "code-snippet", "image", "audio", "video", "html-sandbox", "core"]) {
      expect(getCatalogEntry(id), `${id} must be hidden from the market`).toBeUndefined();
      expect(isCataloged(id)).toBe(false);
    }
  });
});

describe("providerOf — the contentType → plugin index (§8.2/§8.7)", () => {
  it("maps provided types to their plugin and core primitives to undefined", () => {
    expect(providerOf("flashcard")?.id).toBe("flashcard");
    expect(providerOf("quiz")?.id).toBe("quiz");
    expect(providerOf("bookmark")?.id).toBe("bookmark");
    expect(providerOf("mermaid")?.id).toBe("diagrams");
    expect(providerOf("markmap")?.id).toBe("diagrams");
    expect(providerOf("mindmap")?.id).toBe("diagrams");
    expect(providerOf("textbook.explanation")?.id).toBe("explanation");
    expect(providerOf("textbook.exercise")?.id).toBe("practice");
    expect(providerOf("subject.vocab")?.id).toBe("subject-vocab");
    // "always available, nothing to install":
    expect(providerOf("markdown")).toBeUndefined();
    expect(providerOf("html-sandbox")).toBeUndefined();
    expect(providerOf("unknown.type")).toBeUndefined();
    // REV-CORE: the review loop and the mistake type are CORE — no provider to install.
    expect(providerOf("review.grade")).toBeUndefined();
    expect(providerOf("mistake")).toBeUndefined();
    expect(providerOf("textbook.mistake")).toBeUndefined();
  });

  it("registerCatalogEntry extends the index (the test/remote seam); resetCatalog restores", () => {
    registerCatalogEntry({
      id: "extra",
      kind: "plugin",
      name: "Extra",
      description: "x",
      provides: ["extra.type"],
      defaultInstalled: false,
      source: "bundled"
    });
    expect(providerOf("extra.type")?.id).toBe("extra");
    expect(defaultInstalledIds("plugin")).not.toContain("extra");
    resetCatalog();
    expect(providerOf("extra.type")).toBeUndefined();
  });
});
