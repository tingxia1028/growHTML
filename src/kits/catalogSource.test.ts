// CatalogSource tests (MH-0 — marketplace-hosted.md §5, FLAT-amended): the local
// source lists the bundled KITS ONLY (kit-flatten §2 — the user-facing extension unit
// is the kit; plugin entries stay internal) through the pinned read-only contract —
// listing shape, search filtering, get(), and the local-source rules (no
// publisher/pricing, no fetchArtifact; install-state stays manager-side).
import { describe, expect, it } from "vitest";
import {
  NotAvailableInV1Error,
  catalogSource,
  listCatalogSources,
  localCatalogSource,
  registerCatalogSource,
  registerRemoteMockIfEnabled,
  remoteMockCatalogSource,
  shouldRegisterRemoteMock,
  unregisterCatalogSource,
  type CatalogSource
} from "./catalogSource";

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

describe("remoteMockCatalogSource — the mocked EXTERNAL boundary (M6, §8.9)", () => {
  it("lists fabricated source:'registry' goods through the SAME CatalogSource contract", async () => {
    const listings = await remoteMockCatalogSource.list();
    expect(listings.length).toBeGreaterThanOrEqual(1);
    for (const listing of listings) {
      // Same listing shape as local; the provenance is "registry" (renders identically).
      expect(listing.source).toBe("registry");
      expect(listing.id).toBeTruthy();
      expect(listing.title).toBeTruthy();
      // Remote-only fields are populated (the local source omits these).
      expect(listing.publisher?.name).toBeTruthy();
      expect(listing.pricing).toBeTruthy();
    }
    // Same query contract (search filters title + description).
    expect((await remoteMockCatalogSource.list({ search: "diagrams" })).map((l) => l.id)).toEqual([
      "registry:pro-diagrams"
    ]);
    // get() resolves a listing by id and returns null for misses.
    expect((await remoteMockCatalogSource.get("registry:exam-cram"))?.title).toContain("Exam Cram");
    expect(await remoteMockCatalogSource.get("nope")).toBeNull();
  });

  it("fetchArtifact THROWS the typed not-available-in-V1 stub (the future 402/remote boundary)", async () => {
    expect(typeof remoteMockCatalogSource.fetchArtifact).toBe("function");
    await expect(remoteMockCatalogSource.fetchArtifact!("registry:pro-diagrams")).rejects.toBeInstanceOf(
      NotAvailableInV1Error
    );
    // The typed error carries a stable code + the listing id (catchable, not a string match).
    const err = await remoteMockCatalogSource.fetchArtifact!("registry:exam-cram").catch((e) => e);
    expect(err).toBeInstanceOf(NotAvailableInV1Error);
    expect(err.code).toBe("not-available-in-v1");
    expect(err.listingId).toBe("registry:exam-cram");
  });

  it("registers behind registerCatalogSource + surfaces in listCatalogSources (merge input)", () => {
    registerCatalogSource(remoteMockCatalogSource);
    expect(catalogSource("remote-mock")).toBe(remoteMockCatalogSource);
    expect(listCatalogSources().map((s) => s.id)).toEqual(expect.arrayContaining(["local", "remote-mock"]));
  });

  it("a registry listing carries no fetchArtifact result until entitlement — proof a real registry slots in", async () => {
    // The same read contract (list/get) works; only ACQUISITION (fetchArtifact) is the new
    // boundary — CI-verifiable that a real remote registry needs no UI-contract change.
    const remote: CatalogSource = remoteMockCatalogSource;
    const [first] = await remote.list();
    expect(first.source).toBe("registry");
    await expect(remote.fetchArtifact!(first.id)).rejects.toBeInstanceOf(NotAvailableInV1Error);
  });

  it("the dev/test flag gates registration (production shows local only)", () => {
    unregisterCatalogSource("remote-mock");
    // shouldRegisterRemoteMock is a PURE boolean over the env; under the test runtime (DEV)
    // it is on, and registerRemoteMockIfEnabled then registers the source.
    expect(typeof shouldRegisterRemoteMock()).toBe("boolean");
    registerRemoteMockIfEnabled();
    if (shouldRegisterRemoteMock()) {
      expect(catalogSource("remote-mock")).toBe(remoteMockCatalogSource);
    } else {
      expect(listCatalogSources().some((s) => s.id === "remote-mock")).toBe(false);
    }
    unregisterCatalogSource("remote-mock");
    expect(catalogSource("remote-mock")).toBe(localCatalogSource); // fallback after removal
  });
});
