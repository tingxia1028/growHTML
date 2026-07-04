// X0 acceptance test (docs/design/multi-platform.md §6): the extracted services
// run a full roundtrip with NO express/supertest — proving the transport-free seam
// the mobile direct-call adapter (X0b) will sit on. Inputs go through the SAME zod
// request schemas the HTTP edge uses (the adapter reuses schemas + services), and
// failures surface as typed errors instead of status codes.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixtureHtmlBody } from "../../core/fixtures/golden";
import { openVault, type StudyVault } from "../../core/vault";
import { installServerKits } from "../../kits/server";
import { createSealedRuntime, type SealedRuntime } from "../svpack";
import { NotFoundError, ValidationError } from "./errors";
import * as sourcesService from "./sources";
import * as anchorsService from "./anchors";
import * as notesService from "./notes";
import * as layersService from "./layers";

// Same bootstrap the server entry performs (idempotent): kit content specs must be
// registered so createNote can validate kit contentTypes — a direct-call host
// (mobile) will do exactly this at startup.
installServerKits();

let tempDir = "";
let vault: StudyVault;
let sealed: SealedRuntime;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-services-"));
  vault = await openVault({ rootDir: tempDir });
  // Real sealed runtime over an empty vault: no packs ⇒ empty snapshot, and it must
  // never create the identity dir as a side effect (svpack §8.1).
  sealed = createSealedRuntime({
    vault,
    identityDir: path.join(tempDir, "identity"),
    now: () => Date.now()
  });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("service layer direct calls (no HTTP)", () => {
  it("runs ingest → anchor → note → list entirely through services", async () => {
    // 1. Ingest an HTML source (study-id injection included).
    const { source, injected } = await sourcesService.ingestHtml(
      { vault },
      sourcesService.ingestHtmlRequestSchema.parse({ title: "Render Thread", content: fixtureHtmlBody })
    );
    expect(source.title).toBe("Render Thread");
    expect(injected.ids).toBeDefined();

    // 2. Create an anchor on the fixture paragraph — the same parsed-input shape the
    // route produces (schema defaults applied by zod, not by hand).
    const anchor = await anchorsService.createAnchor(
      { vault },
      anchorsService.createAnchorRequestSchema.parse({
        sourceId: source.id,
        studyId: "p-render-thread",
        selector: '[data-study-id="p-render-thread"]',
        quote: "Render Thread submits rendering commands."
      })
    );
    expect(anchor.sourceId).toBe(source.id);
    // Lazy-creation semantics survive the extraction: the anchor was stamped with
    // the source's owned layer, created on first use.
    const layers = await layersService.listSourceLayers({ vault, sealed }, { sourceId: source.id });
    const owned = layers.find((layer) => layer.importMode === "owned" && layer.role === undefined);
    expect(owned).toBeDefined();
    expect(anchor.layerId).toBe(owned?.id);

    // 3. Create a note on the anchor; with no explicit layerIds it defaults into the
    // owned layer (never orphaned to invisibility).
    const note = await notesService.createNote(
      { vault },
      notesService.createNoteRequestSchema.parse({
        sourceId: source.id,
        anchorIds: [anchor.id],
        contentType: "markdown",
        content: "A manual note."
      })
    );
    expect(note.layerIds).toEqual([owned?.id]);

    // 4. List notes for the source (sealed read-model merged — empty here).
    const notes = await notesService.listNotes({ vault, sealed }, { sourceId: source.id });
    expect(notes.map((entry) => entry.id)).toEqual([note.id]);

    // 5. The derived anchor painting sees the note-backed anchor.
    const anchors = await anchorsService.listSourceAnchors({ vault, sealed }, { sourceId: source.id });
    expect(anchors.map((entry) => entry.id)).toEqual([anchor.id]);

    // 6. Failures are TYPED errors, not HTTP statuses: the transport maps them.
    await expect(
      sourcesService.updateSourceMetadata({ vault }, { sourceId: "missing", metadata: {} })
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      sourcesService.ingestPdf(
        { vault },
        sourcesService.ingestPdfRequestSchema.parse({
          title: "Not a pdf",
          dataBase64: Buffer.from("plain text").toString("base64")
        })
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("forwards the D6 status:draft flag on create and omits it by default", async () => {
    const { source } = await sourcesService.ingestHtml(
      { vault },
      sourcesService.ingestHtmlRequestSchema.parse({ title: "Draft Doc", content: fixtureHtmlBody })
    );
    const anchor = await anchorsService.createAnchor(
      { vault },
      anchorsService.createAnchorRequestSchema.parse({
        sourceId: source.id,
        studyId: "p-render-thread",
        selector: '[data-study-id="p-render-thread"]',
        quote: "Render Thread submits rendering commands."
      })
    );

    // An anchor-context AI answer materializes a note flagged draft (the same parsed-
    // input shape the /api/notes route produces).
    const draft = await notesService.createNote(
      { vault },
      notesService.createNoteRequestSchema.parse({
        sourceId: source.id,
        anchorIds: [anchor.id],
        contentType: "markdown",
        content: "Auto-materialized answer.",
        status: "draft"
      })
    );
    expect(draft.status).toBe("draft");
    // It round-trips through the store (the tombstone/list read model preserves it).
    const stored = await vault.stores.notes.get(draft.id);
    expect(stored?.status).toBe("draft");

    // A normal create omits status entirely (zero-migration: not a new required field).
    const normal = await notesService.createNote(
      { vault },
      notesService.createNoteRequestSchema.parse({
        sourceId: source.id,
        anchorIds: [anchor.id],
        contentType: "markdown",
        content: "A committed note."
      })
    );
    expect(normal.status).toBeUndefined();
  });
});
