// Catalog read-model tests (M1 — plugin-viewer-model §8.1/§8.2): the bundled entries'
// structural invariants, the providerOf index, and the hidden-core rule.
import { afterEach, describe, expect, it } from "vitest";
import {
  catalogKitMembers,
  defaultInstalledIds,
  getCatalogEntry,
  isCataloged,
  listCatalogEntries,
  providerOf,
  registerCatalogEntry,
  resetCatalog
} from "./catalog";

afterEach(() => resetCatalog());

describe("bundled catalog invariants (§8.1)", () => {
  it("ids are unique, every entry is bundled; defaultInstalled = everything except the M-B subject entries", () => {
    const entries = listCatalogEntries();
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of entries) {
      expect(entry.source, `${entry.id} source`).toBe("bundled");
      // Pre-M-B goods stay defaultInstalled (a null catalogState behaves byte-for-byte
      // as before the market). The subject kits/plugins (subject-kits.md M-B) are the
      // first install-to-activate entries: bundled but NOT default-installed —
      // "installing 英语 Kit lights up vocab in the composer" (PART 5).
      const optIn = entry.id.startsWith("subject-");
      expect(entry.defaultInstalled, `${entry.id} defaultInstalled`).toBe(!optIn);
      expect(entry.description.length, `${entry.id} needs a description`).toBeGreaterThan(0);
    }
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

  it("lists the §8.1 classification: reclassified built-ins, textbook members, the kit", () => {
    for (const id of [
      "flashcard",
      "quiz",
      "bookmark",
      "diagrams",
      "table-viewer",
      "explanation",
      "practice",
      "mistake",
      "review-pack",
      "textbook-language"
    ]) {
      expect(getCatalogEntry(id)?.kind, id).toBe("plugin");
    }
    expect(getCatalogEntry("textbook-learning")?.kind).toBe("kit");
    expect(catalogKitMembers("textbook-learning")).toEqual([
      "explanation",
      "practice",
      "mistake",
      "review-pack",
      "textbook-language"
    ]);
  });

  it("lists the M-B subject exemplars: 3 plugins + 3 kits whose members mix new and existing plugins", () => {
    for (const id of ["subject-vocab", "subject-formula", "subject-timeline"]) {
      expect(getCatalogEntry(id)?.kind, id).toBe("plugin");
    }
    expect(getCatalogEntry("subject-english")?.kind).toBe("kit");
    expect(catalogKitMembers("subject-english")).toEqual(["subject-vocab", "flashcard"]);
    expect(catalogKitMembers("subject-math")).toEqual(["subject-formula", "mistake", "quiz"]);
    expect(catalogKitMembers("subject-history-geo")).toEqual(["subject-timeline"]);
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
    // "always available, nothing to install":
    expect(providerOf("markdown")).toBeUndefined();
    expect(providerOf("html-sandbox")).toBeUndefined();
    expect(providerOf("unknown.type")).toBeUndefined();
    // REV-CORE: the review loop and the mistake type are CORE — no provider to install.
    expect(providerOf("review.grade")).toBeUndefined();
    expect(providerOf("mistake")).toBeUndefined();
    expect(providerOf("textbook.mistake")).toBeUndefined();
  });

  it("defaultInstalledIds splits by kind", () => {
    expect(defaultInstalledIds("kit")).toContain("textbook-learning");
    expect(defaultInstalledIds("plugin")).toContain("quiz");
    expect(defaultInstalledIds("plugin")).not.toContain("textbook-learning");
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
