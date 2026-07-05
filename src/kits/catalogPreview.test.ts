// M2a — preview fixtures (docs/design/plugin-viewer-model.md §8.4.3). The HARD invariant:
// every kit's `previewFixtures` (a) resolves to a contentType that a cataloged member
// PROVIDES, and (b) carries a `sampleContent` that VALIDATES against that type's core
// NoteContentSpec (parseNoteContent-clean) — an invalid fixture would silently degrade to
// InertNote in the market. Also locks the pure `previewsFor` selector.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getCatalogEntry, listCatalogEntries, providerOf, resetCatalog } from "./catalog";
import { attachPreviewFixtures, fixtureForContentType, previewsFor } from "./catalogPreview";
import { parseNoteContent, registerBuiltinNoteContentSpecs, registerNoteContentSpec } from "../core/notes/contentTypes";
import { kitContentSpecs } from "./index";

// The market previews render THROUGH the plugin's registered renderer, so the fixtures
// must validate against the SAME core specs the API validates with. Register the core
// built-ins + every kit content spec (the server's validation surface).
beforeAll(() => {
  registerBuiltinNoteContentSpecs();
  for (const spec of kitContentSpecs) registerNoteContentSpec(spec);
});

// catalogPreview attaches on import; resetCatalog rebuilds the bundled array (dropping the
// attachment), so re-attach after any test that reset it.
afterEach(() => {
  resetCatalog();
  attachPreviewFixtures();
});

describe("previewFixtures — schema-valid samples on every kit entry (§8.4.3)", () => {
  it("every kit carries fixtures, each resolving to a REGISTERED, member-PROVIDED contentType", () => {
    const kits = listCatalogEntries().filter((e) => e.kind === "kit");
    expect(kits.length).toBeGreaterThan(0);
    for (const kit of kits) {
      const fixtures = kit.previewFixtures ?? [];
      expect(fixtures.length, `${kit.id} must ship at least one preview fixture`).toBeGreaterThan(0);
      const providedByKit = new Set(
        (kit.members ?? []).flatMap((memberId) => getCatalogEntry(memberId)?.provides ?? [])
      );
      for (const fixture of fixtures) {
        // (a) resolves to a contentType a member of THIS kit provides.
        expect(providedByKit.has(fixture.contentType), `${kit.id} → ${fixture.contentType} must be member-provided`).toBe(
          true
        );
        // and the provider index agrees (§8.7).
        expect(providerOf(fixture.contentType), `${fixture.contentType} needs a provider`).toBeTruthy();
      }
    }
  });

  it("every fixture's sampleContent VALIDATES against its core NoteContentSpec (HARD)", () => {
    for (const kit of listCatalogEntries().filter((e) => e.kind === "kit")) {
      for (const fixture of kit.previewFixtures ?? []) {
        // parseNoteContent throws on an unknown type or a schema mismatch — a passing
        // parse is the §8.4.3 guarantee that the market never falls back to InertNote.
        expect(() => parseNoteContent(fixture.contentType, fixture.sampleContent), fixture.contentType).not.toThrow();
      }
    }
  });
});

describe("previewsFor — the pure selector", () => {
  it("returns the union of a kit's members' provided types (each a valid fixture)", () => {
    const previews = previewsFor("textbook-learning");
    expect(previews.length).toBeGreaterThan(0);
    const types = previews.map((p) => p.contentType);
    // representative provided types flow through
    expect(types).toContain("textbook.explanation");
    expect(types).toContain("subject.vocab");
    // no duplicates
    expect(new Set(types).size).toBe(types.length);
    for (const preview of previews) {
      expect(() => parseNoteContent(preview.contentType, preview.sampleContent)).not.toThrow();
    }
  });

  it("returns [] for an unknown entry and skips types with no shipped fixture", () => {
    expect(previewsFor("nope")).toEqual([]);
    // a core type has no market fixture (nothing to preview-install)
    expect(fixtureForContentType("markdown")).toBeUndefined();
  });

  it("a plugin entry previews its own provided types (internal read model stays total)", () => {
    const previews = previewsFor("subject-vocab");
    expect(previews.map((p) => p.contentType)).toEqual(["subject.vocab"]);
  });
});
