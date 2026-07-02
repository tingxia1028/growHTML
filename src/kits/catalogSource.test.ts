// CatalogSource tests (MH-0 — marketplace-hosted.md §5): the local source lists the
// bundled kit/plugin registrations through the pinned read-only contract — listing
// shape, kind/search filtering, get(), and the local-source rules (no publisher/pricing,
// no fetchArtifact; install-state stays manager-side).
import { describe, expect, it } from "vitest";
import { catalogSource, localCatalogSource, registerCatalogSource, type CatalogSource } from "./catalogSource";

describe("CatalogSource('local') — the MH-0 seam", () => {
  it("is the registered 'local' source and the default", () => {
    expect(catalogSource("local")).toBe(localCatalogSource);
    expect(catalogSource()).toBe(localCatalogSource);
    expect(localCatalogSource.id).toBe("local");
  });

  it("lists every bundled kit/plugin as a CatalogListing (id/kind/title/description/contentTypes)", async () => {
    const listings = await localCatalogSource.list();
    expect(listings.length).toBeGreaterThanOrEqual(12);
    for (const listing of listings) {
      expect(listing.id).toBeTruthy();
      expect(["kit", "plugin"]).toContain(listing.kind); // local sells no packs (yet)
      expect(listing.title).toBeTruthy();
      expect(typeof listing.description).toBe("string");
      expect(Array.isArray(listing.contentTypes)).toBe(true);
      // LOCAL RULE: publisher/pricing OMITTED (remote-only fields, one renderer).
      expect(listing.publisher).toBeUndefined();
      expect(listing.pricing).toBeUndefined();
    }
  });

  it("a kit listing carries the union of its members' contentTypes + a member count", async () => {
    const kit = await localCatalogSource.get("textbook-learning");
    expect(kit).toBeTruthy();
    expect(kit!.kind).toBe("kit");
    expect(kit!.memberCount).toBe(5);
    expect(kit!.contentTypes).toEqual(
      expect.arrayContaining(["textbook.explanation", "textbook.exercise", "textbook.mistake", "textbook.review-pack"])
    );
  });

  it("filters by kind and by search (title + description, case-insensitive)", async () => {
    const kits = await localCatalogSource.list({ kind: "kit" });
    expect(kits.length).toBeGreaterThanOrEqual(1);
    expect(kits.every((l) => l.kind === "kit")).toBe(true);

    const flash = await localCatalogSource.list({ search: "recall" });
    expect(flash.some((l) => l.id === "flashcard")).toBe(true);
    expect(flash.some((l) => l.id === "quiz")).toBe(false);

    const zh = await localCatalogSource.list({ search: "复习环" });
    expect(zh.map((l) => l.id)).toEqual(["review"]);
  });

  it("get() returns null for unknown ids", async () => {
    expect(await localCatalogSource.get("nope")).toBeNull();
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
