// SRC-3 — imported-source FORK (docs/design/source-authoring.md §3-§4). "Fork to an
// authored copy": a NEW source with origin "authored" that copies the content; per §3
// the original's NOTES and ANCHORS STAY on the original (not copied, not moved). The
// fork is then editable through the SRC-2 pipeline.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHtmlSelectionAnchor } from "../../adapters/html/anchor";
import { ingestBinarySource, readSourceContent } from "../../core/store/sources";
import { openVault, type StudyVault } from "../../core/vault";
import { createApp } from "../app";
import { NotFoundError, ValidationError } from "./errors";
import { forkSource } from "./sourceFork";
import { updateAuthoredSource } from "./sourceAuthoring";
import { ingestHtml } from "./sources";

let tempDir = "";
let vault: StudyVault;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-fork-"));
  vault = await openVault({ rootDir: tempDir });
});

afterEach(async () => {
  vault?.close(); // STORE-SQL Stage-3: release sqlite handles before rm (no-op on jsonl)
  await rm(tempDir, { recursive: true, force: true });
});

const deps = () => ({ vault });
const HTML_BODY = "<article><p>The mitochondrion is the powerhouse of the cell.</p></article>";

async function seedImportedWithAnnotation() {
  const { source } = await ingestHtml(deps(), { title: "Cell biology", content: HTML_BODY });
  const stored = await readSourceContent(vault, source);
  const studyId = /<p data-study-id="([^"]+)">/.exec(stored)?.[1];
  const anchor = createHtmlSelectionAnchor({
    sourceId: source.id,
    studyId: studyId!,
    quote: "The mitochondrion is the powerhouse of the cell."
  });
  await vault.stores.anchors.upsert(anchor);
  return { source, anchor };
}

describe("SRC-3 — fork an imported source to an authored copy", () => {
  it("creates a new AUTHORED source that copies the content", async () => {
    const { source } = await seedImportedWithAnnotation();
    const { source: fork } = await forkSource(deps(), { sourceId: source.id });

    expect(fork.id).not.toBe(source.id);
    expect(fork.origin).toBe("authored");
    expect(fork.revision).toBe(1);
    expect(fork.title).toBe("Cell biology（副本）");
    // Content copied (study ids present); the fork is now editable in place.
    await expect(readSourceContent(vault, fork)).resolves.toContain("powerhouse of the cell");
  });

  it("leaves the original's notes/anchors on the ORIGINAL (the fork starts annotation-free)", async () => {
    const { source, anchor } = await seedImportedWithAnnotation();
    const { source: fork } = await forkSource(deps(), { sourceId: source.id });

    const anchors = await vault.stores.anchors.list();
    // The anchor still belongs to the original, and NO anchor was created on the fork.
    expect(anchors.find((a) => a.id === anchor.id)?.sourceId).toBe(source.id);
    expect(anchors.filter((a) => a.sourceId === fork.id)).toHaveLength(0);
    // The original is untouched (still imported, revision 1).
    const reloadedOriginal = await vault.stores.sources.get(source.id);
    expect(reloadedOriginal?.origin).toBe("imported");
    expect(reloadedOriginal?.revision).toBe(1);
  });

  it("the fork is editable through the SRC-2 pipeline (original stays read-only)", async () => {
    const { source } = await seedImportedWithAnnotation();
    const { source: fork } = await forkSource(deps(), { sourceId: source.id });

    // The fork accepts a content edit (authored) …
    const edited = await updateAuthoredSource(deps(), {
      sourceId: fork.id,
      content: "<article><p>Rewritten body.</p></article>"
    });
    expect(edited.source.revision).toBe(2);
    // … while the original still rejects direct edits (imported guard).
    await expect(
      updateAuthoredSource(deps(), { sourceId: source.id, content: "<p>nope</p>" })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("honors a title override", async () => {
    const { source } = await seedImportedWithAnnotation();
    const { source: fork } = await forkSource(deps(), { sourceId: source.id, title: "我的可编辑副本" });
    expect(fork.title).toBe("我的可编辑副本");
  });

  it("rejects unknown sources and non-forkable (binary) types", async () => {
    await expect(forkSource(deps(), { sourceId: "src_missing" })).rejects.toBeInstanceOf(NotFoundError);

    const pdf = await ingestBinarySource(vault, {
      title: "A PDF",
      data: Buffer.from("%PDF-1.4 fake"),
      sourceType: "pdf"
    });
    await expect(forkSource(deps(), { sourceId: pdf.id })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("SRC-3 — fork route (parity + error mapping)", () => {
  let app: ReturnType<typeof createApp>;
  beforeEach(() => {
    app = createApp({ vault });
  });

  it("POST /api/sources/:id/fork returns the new authored copy (201)", async () => {
    const { source } = await seedImportedWithAnnotation();
    const res = await request(app).post(`/api/sources/${source.id}/fork`).send({}).expect(201);
    expect(res.body.source.origin).toBe("authored");
    expect(res.body.source.id).not.toBe(source.id);
  });

  it("maps NotFound (404) and non-forkable (400)", async () => {
    await request(app).post("/api/sources/src_missing/fork").send({}).expect(404);
    const pdf = await ingestBinarySource(vault, {
      title: "A PDF",
      data: Buffer.from("%PDF-1.4 fake"),
      sourceType: "pdf"
    });
    await request(app).post(`/api/sources/${pdf.id}/fork`).send({}).expect(400);
  });
});
