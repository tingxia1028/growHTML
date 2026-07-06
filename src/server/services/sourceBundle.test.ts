// W2 attachment-bundle service tests (ai-workspace.md §W2): the bounded body excerpt
// + sealed-filtered notes that feed the widened ChatContext.sources[]. Runs entirely
// through the extracted service (no HTTP), the same seam the /api/sources/:id/bundle
// route and the directTransport parity call.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NoteRecord } from "../../core/schema";
import { type StudyVault } from "../../core/vault";
import { openTestVault } from "../../core/testing/openTestVault";
import { installServerKits } from "../../kits/server";
import { createSealedRuntime, type SealedRuntime, type SealedSnapshot } from "../svpack";
import * as notesService from "./notes";
import * as sourcesService from "./sources";
import {
  BUNDLE_EXCERPT_MAX_CHARS,
  BUNDLE_NOTE_COUNT_CAP,
  bundleExcerptText,
  buildSourceBundle,
  truncateExcerpt
} from "./sources";

installServerKits();

let tempDir = "";
let vault: StudyVault;
let sealed: SealedRuntime;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-bundle-"));
  vault = await openTestVault({ rootDir: tempDir });
  sealed = createSealedRuntime({ vault, identityDir: path.join(tempDir, "identity"), now: () => Date.now() });
});

afterEach(async () => {
  vault?.close(); // STORE-SQL Stage-3: release sqlite handles before rm (no-op on jsonl)
  await rm(tempDir, { recursive: true, force: true });
});

// A fake sealed runtime whose snapshot carries ONE sealed note on the given source —
// used to prove the bundle filters write-locked protected content out of the prompt.
function sealedRuntimeWith(notes: Array<NoteRecord & { sealed: true }>): SealedRuntime {
  const snapshot: SealedSnapshot = {
    meta: [],
    notes,
    anchors: [],
    layers: [],
    noteIds: new Set(notes.map((note) => note.id)),
    anchorIds: new Set(),
    layerIds: new Set(),
    enabledLayerIds: new Set()
  };
  return { snapshot: () => snapshot, refresh: () => undefined };
}

describe("bundleExcerptText / truncateExcerpt (pure)", () => {
  it("strips tags + collapses whitespace", () => {
    expect(bundleExcerptText("<p>Hello   <b>world</b></p>\n<script>x=1</script>")).toBe("Hello world");
  });

  it("head-slices past the cap with an ellipsis, leaves short text intact", () => {
    const short = "abc";
    expect(truncateExcerpt(short)).toBe("abc");
    const long = "x".repeat(BUNDLE_EXCERPT_MAX_CHARS + 500);
    const cut = truncateExcerpt(long);
    expect(cut.length).toBe(BUNDLE_EXCERPT_MAX_CHARS + 1); // +1 for the ellipsis
    expect(cut.endsWith("…")).toBe(true);
  });
});

async function seedSource(title: string, body: string) {
  const { source } = await sourcesService.ingestHtml(
    { vault },
    sourcesService.ingestHtmlRequestSchema.parse({ title, content: body })
  );
  return source;
}

describe("buildSourceBundle", () => {
  it("returns a bounded text excerpt (tags stripped) for an HTML source", async () => {
    const source = await seedSource("Bio", "<article><p>Photosynthesis converts light into chemical energy.</p></article>");
    const bundle = await buildSourceBundle({ vault, sealed }, { sourceId: source.id });
    expect(bundle.title).toBe("Bio");
    expect(bundle.type).toBe("html");
    expect(bundle.excerpt).toContain("Photosynthesis converts light into chemical energy.");
    expect(bundle.excerpt).not.toContain("<");
    expect(bundle.notes).toEqual([]);
  });

  it("truncates a very long body to the excerpt cap", async () => {
    const long = "word ".repeat(2000); // ~10k chars, > cap
    const source = await seedSource("Long", `<article><p>${long}</p></article>`);
    const bundle = await buildSourceBundle({ vault, sealed }, { sourceId: source.id });
    expect(bundle.excerpt!.length).toBeLessThanOrEqual(BUNDLE_EXCERPT_MAX_CHARS + 1);
    expect(bundle.excerpt!.endsWith("…")).toBe(true);
  });

  it("includes the source's notes reduced to text, and skips them when includeNotes:false", async () => {
    const source = await seedSource("Doc", "<article><p>Body.</p></article>");
    await notesService.createNote(
      { vault },
      notesService.createNoteRequestSchema.parse({
        sourceId: source.id,
        contentType: "markdown",
        content: "A key insight."
      })
    );
    const withNotes = await buildSourceBundle({ vault, sealed }, { sourceId: source.id });
    expect(withNotes.notes).toHaveLength(1);
    expect(withNotes.notes[0]).toEqual({ contentType: "markdown", text: "A key insight." });

    const withoutNotes = await buildSourceBundle({ vault, sealed }, { sourceId: source.id, includeNotes: false });
    expect(withoutNotes.notes).toEqual([]);
  });

  it("caps the note count at BUNDLE_NOTE_COUNT_CAP", async () => {
    const source = await seedSource("Many", "<article><p>Body.</p></article>");
    for (let i = 0; i < BUNDLE_NOTE_COUNT_CAP + 5; i += 1) {
      await notesService.createNote(
        { vault },
        notesService.createNoteRequestSchema.parse({
          sourceId: source.id,
          contentType: "markdown",
          content: `note ${i}`
        })
      );
    }
    const bundle = await buildSourceBundle({ vault, sealed }, { sourceId: source.id });
    expect(bundle.notes.length).toBe(BUNDLE_NOTE_COUNT_CAP);
  });

  it("FILTERS OUT sealed (protected-import) notes — write-locked content never enters a prompt", async () => {
    const source = await seedSource("Protected", "<article><p>Body.</p></article>");
    // One normal note...
    await notesService.createNote(
      { vault },
      notesService.createNoteRequestSchema.parse({ sourceId: source.id, contentType: "markdown", content: "visible note" })
    );
    // ...and a sealed note on the same source injected via the sealed snapshot.
    const now = new Date().toISOString();
    const sealedNote: NoteRecord & { sealed: true } = {
      id: "note_sealed_1",
      type: "note",
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: "user",
      metadata: {},
      sourceId: source.id,
      anchorIds: [],
      conceptIds: [],
      contentType: "markdown",
      content: "SEALED SECRET — must not leak",
      visibility: "private",
      layerIds: [],
      sealed: true
    };
    const sealedWith = sealedRuntimeWith([sealedNote]);
    const bundle = await buildSourceBundle({ vault, sealed: sealedWith }, { sourceId: source.id });
    const texts = bundle.notes.map((note) => note.text);
    expect(texts).toContain("visible note");
    expect(texts).not.toContain("SEALED SECRET — must not leak");
  });
});
