import { describe, expect, it } from "vitest";
import type { SourceBundle } from "../data/entityClient";
import {
  assembleContextSources,
  capTotalExcerpts,
  CONTEXT_TOTAL_EXCERPT_CAP,
  unionBundles,
  type ResolvedBundle
} from "./chatContextAssembly";

function bundle(id: string, title: string, excerpt = "", notes: SourceBundle["notes"] = []): SourceBundle {
  return { sourceId: id, title, type: "html", excerpt, notes };
}

function resolved(id: string, title: string, focused: boolean, excerpt = ""): ResolvedBundle {
  return { sourceId: id, focused, bundle: bundle(id, title, excerpt) };
}

describe("unionBundles (focused-first, sourceId de-dup)", () => {
  it("leads with the focused source, then the attachments in order", () => {
    const out = unionBundles([
      resolved("src_a", "Attach A", false),
      resolved("src_focus", "Focused", true),
      resolved("src_b", "Attach B", false)
    ]);
    expect(out.map((entry) => entry.sourceId)).toEqual(["src_focus", "src_a", "src_b"]);
  });

  it("de-dupes by sourceId — a source that is BOTH focused and attached appears once (focused wins)", () => {
    const focusedBundle = resolved("src_x", "Focused X", true, "focused body");
    const attachedDup = resolved("src_x", "Attached X (stale)", false, "attached body");
    const other = resolved("src_y", "Y", false);
    const out = unionBundles([attachedDup, focusedBundle, other]);
    expect(out.map((entry) => entry.sourceId)).toEqual(["src_x", "src_y"]);
    // The FOCUSED bundle carried it (its title/excerpt), not the attachment dup.
    expect(out[0].title).toBe("Focused X");
    expect(out[0].excerpt).toBe("focused body");
  });

  it("returns [] for no bundles", () => {
    expect(unionBundles([])).toEqual([]);
  });
});

describe("capTotalExcerpts (cross-source, drop-tail)", () => {
  it("keeps every excerpt under the cap", () => {
    const sources = [
      { title: "A", excerpt: "x".repeat(100) },
      { title: "B", excerpt: "y".repeat(100) }
    ];
    const out = capTotalExcerpts(sources, 1000);
    expect(out.map((source) => source.excerpt)).toEqual([sources[0].excerpt, sources[1].excerpt]);
  });

  it("drops the TAIL excerpts first once the running total overflows — titles + notes stay", () => {
    const sources = [
      { title: "A", excerpt: "a".repeat(60), notes: [{ text: "note A" }] },
      { title: "B", excerpt: "b".repeat(60), notes: [{ text: "note B" }] },
      { title: "C", excerpt: "c".repeat(60), notes: [{ text: "note C" }] }
    ];
    // Cap fits only the first excerpt (60 < 100, 120 > 100).
    const out = capTotalExcerpts(sources, 100);
    expect(out[0].excerpt).toBe(sources[0].excerpt); // head kept
    expect(out[1].excerpt).toBeUndefined(); // tail dropped
    expect(out[2].excerpt).toBeUndefined();
    // Titles + notes are RETAINED on the dropped sources.
    expect(out[1].title).toBe("B");
    expect(out[1].notes).toEqual([{ text: "note B" }]);
    expect(out[2].notes).toEqual([{ text: "note C" }]);
  });

  it("leaves note-only sources (no excerpt) untouched", () => {
    const sources = [{ title: "N", notes: [{ text: "n" }] }];
    expect(capTotalExcerpts(sources, 10)).toEqual(sources);
  });

  it("defaults to CONTEXT_TOTAL_EXCERPT_CAP", () => {
    const sources = [{ title: "Big", excerpt: "z".repeat(CONTEXT_TOTAL_EXCERPT_CAP + 1) }];
    const out = capTotalExcerpts(sources);
    // The first source alone exceeds the default cap → its excerpt is dropped.
    expect(out[0].excerpt).toBeUndefined();
  });
});

describe("assembleContextSources (union → shape → cap)", () => {
  it("returns [] for empty input (so the caller omits the sources key)", () => {
    expect(assembleContextSources([])).toEqual([]);
  });

  it("produces ChatContextSource[] focused-first, dropping empty note arrays", () => {
    const out = assembleContextSources([
      { sourceId: "f", focused: true, bundle: bundle("f", "Focused", "body", [{ contentType: "markdown", text: "n1" }]) },
      { sourceId: "a", focused: false, bundle: bundle("a", "Attached", "more", []) }
    ]);
    expect(out).toEqual([
      { title: "Focused", type: "html", location: undefined, excerpt: "body", notes: [{ contentType: "markdown", text: "n1" }] },
      { title: "Attached", type: "html", location: undefined, excerpt: "more" }
    ]);
    // The empty-notes source has NO notes key.
    expect("notes" in out[1]).toBe(false);
  });

  it("applies the cross-source cap end-to-end", () => {
    const out = assembleContextSources(
      [
        { sourceId: "a", focused: true, bundle: bundle("a", "A", "a".repeat(80)) },
        { sourceId: "b", focused: false, bundle: bundle("b", "B", "b".repeat(80)) }
      ],
      100
    );
    expect(out[0].excerpt).toBe("a".repeat(80));
    expect(out[1].excerpt).toBeUndefined();
  });
});
