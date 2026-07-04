// CatalogSource tests (MH-0 — marketplace-hosted.md §5, FLAT-amended): the local
// source lists the bundled KITS ONLY (kit-flatten §2 — the user-facing extension unit
// is the kit; plugin entries stay internal) through the pinned read-only contract —
// listing shape, search filtering, get(), and the local-source rules (no
// publisher/pricing, no fetchArtifact; install-state stays manager-side).
import { describe, expect, it } from "vitest";
import { catalogSource, localCatalogSource, registerCatalogSource, type CatalogSource } from "./catalogSource";

describe("CatalogSource('local') — the MH-0 seam", () => {
  it("is the registered 'local' source and the default", () => {
    expect(catalogSource("local")).toBe(localCatalogSource);
    expect(catalogSource()).toBe(localCatalogSource);
    expect(localCatalogSource.id).toBe("local");
  });

  it("lists KITS ONLY (FLAT §2) as CatalogListings (id/kind/title/description/contentTypes)", async () => {
    const listings = await localCatalogSource.list();
    expect(listings.length).toBeGreaterThanOrEqual(1);
    for (const listing of listings) {
      expect(listing.id).toBeTruthy();
      expect(listing.kind).toBe("kit"); // plugins are internal capability groups now
      expect(listing.title).toBeTruthy();
      expect(typeof listing.description).toBe("string");
      expect(Array.isArray(listing.contentTypes)).toBe(true);
      // LOCAL RULE: publisher/pricing OMITTED (remote-only fields, one renderer).
      expect(listing.publisher).toBeUndefined();
      expect(listing.pricing).toBeUndefined();
    }
    // No plugin ever surfaces through the local listing.
    expect(await localCatalogSource.list({ kind: "plugin" })).toEqual([]);
    expect((await localCatalogSource.list()).find((l) => l.id === "flashcard")).toBeUndefined();
  });

  it("the Textbook Kit listing carries the members-union contentTypes + member/group counts", async () => {
    const kit = await localCatalogSource.get("textbook-learning");
    expect(kit).toBeTruthy();
    expect(kit!.kind).toBe("kit");
    expect(kit!.memberCount).toBe(16); // 5 base members + 11 subject exemplars (M-B 3 + M-C 8)
    expect(kit!.groupCount).toBe(10); // FLAT capability groups (5 base + 5 per-subject)
    expect(kit!.contentTypes).toEqual(
      expect.arrayContaining([
        "textbook.explanation",
        "textbook.exercise",
        "textbook.review-pack",
        // the merged per-subject groups' types ride the same union (M-B + M-C)
        "subject.vocab",
        "subject.formula",
        "subject.timeline",
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
    // REV-CORE: the mistake TYPE is core now — the kit's union no longer carries it.
    expect(kit!.contentTypes).not.toContain("textbook.mistake");
  });

  it("filters by search (title + description, case-insensitive) over the kit listings", async () => {
    const hits = await localCatalogSource.list({ search: "textbook" });
    expect(hits.some((l) => l.id === "textbook-learning")).toBe(true);
    // Plugin-only vocabulary no longer matches anything (no plugin listings).
    const flash = await localCatalogSource.list({ search: "recall" });
    expect(flash).toEqual([]);
    // REV-CORE: the review loop is CORE — no market listing sells 复习环 anymore.
    const zh = await localCatalogSource.list({ search: "复习环" });
    expect(zh).toEqual([]);
  });

  it("get() returns null for unknown ids AND for internal plugin ids", async () => {
    expect(await localCatalogSource.get("nope")).toBeNull();
    expect(await localCatalogSource.get("flashcard")).toBeNull(); // internal, not a unit
  });

  it("LOCAL RULE: no fetchArtifact — local artifacts are in-process registrations", () => {
    expect(localCatalogSource.fetchArtifact).toBeUndefined();
  });

  it("a listing is READ-ONLY presentation — no install state on it (manager-side by contract)", async () => {
    const listing = (await localCatalogSource.list())[0] as Record<string, unknown>;
    expect("installed" in listing).toBe(false);
    expect("defaultInstalled" in listing).toBe(false);
  });

  it("registerCatalogSource adds future sources without touching the market contract", async () => {
    const remote: CatalogSource = {
      id: "remote-test",
      list: () =>
        Promise.resolve([
          {
            id: "listing-1",
            kind: "pack" as const,
            title: "Pack",
            publisher: { id: "p1", name: "Teacher", verified: true },
            pricing: { kind: "credits" as const, amount: 5 }
          }
        ]),
      get: () => Promise.resolve(null)
    };
    registerCatalogSource(remote);
    expect(catalogSource("remote-test")).toBe(remote);
    const [listing] = await catalogSource("remote-test").list();
    expect(listing.publisher?.verified).toBe(true); // remote fields flow through the SAME type
    expect(catalogSource("unknown")).toBe(localCatalogSource); // defensive fallback
  });
});
