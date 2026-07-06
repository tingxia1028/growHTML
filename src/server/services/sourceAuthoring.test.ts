// SRC-1 create + SRC-2 edit pipeline (docs/design/source-authoring.md §4-§5).
// Service level: authored blank-create (origin/revision, raw-markdown round-trip,
// html study-id injection), the save pipeline (re-hash → revision bump → RE-PROJECT
// anchors by quote+context via the import machinery: edit elsewhere = still matched,
// edit the anchored passage = unmatched + listed, casing drift = fuzzy), the
// imported-source guard, and the shared-source warning input (publish ledger /
// imported layers). Route level: zod validation + service-error mapping parity.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHtmlSelectionAnchor } from "../../adapters/html/anchor";
import { createEntityId } from "../../core/ids";
import { studyLayerSchema, type HtmlSelectionAnchor } from "../../core/schema";
import { ingestHtmlSource, readSourceContent } from "../../core/store/sources";
import { type StudyVault } from "../../core/vault";
import { openTestVault } from "../../core/testing/openTestVault";
import { createApp } from "../app";
import {
  createAuthoredSource,
  getSourceShareStatus,
  projectedHtmlForSource,
  updateAuthoredSource
} from "./sourceAuthoring";
import { renderSource } from "./sources";
import { NotFoundError, ValidationError } from "./errors";

let tempDir = "";
let vault: StudyVault;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-authoring-"));
  vault = await openTestVault({ rootDir: tempDir });
});

afterEach(async () => {
  // STORE-SQL Stage-3: release sqlite handles before rm (no-op on jsonl).
  await vault?.close();
  await rm(tempDir, { recursive: true, force: true });
});

const deps = () => ({ vault });

const QUOTE = "the powerhouse of the cell";
const HTML_BODY = [
  "<article>",
  "<p>The mitochondrion is the powerhouse of the cell.</p>",
  "<p>Ribosomes translate messenger RNA into protein.</p>",
  "</article>"
].join("");

async function seedAuthoredHtmlWithAnchor() {
  const { source } = await createAuthoredSource(deps(), {
    title: "Cell biology",
    sourceType: "html",
    content: HTML_BODY
  });
  const stored = await readSourceContent(vault, source);
  const studyId = /<p data-study-id="([^"]+)">The mitochondrion/.exec(stored)?.[1];
  expect(studyId).toBeTruthy();
  const anchor = createHtmlSelectionAnchor({
    sourceId: source.id,
    studyId: studyId!,
    quote: QUOTE,
    contextBefore: "The mitochondrion is ",
    contextAfter: "."
  });
  await vault.stores.anchors.upsert(anchor);
  return { source, anchor, stored };
}

describe("SRC-1 — authored blank-create", () => {
  it("creates an authored markdown source (origin/revision) and round-trips RAW markdown", async () => {
    const { source } = await createAuthoredSource(deps(), {
      title: "你好",
      sourceType: "markdown",
      content: "# 标题\n\n正文 **加粗**。"
    });

    expect(source.origin).toBe("authored");
    expect(source.revision).toBe(1);
    expect(source.sourceType).toBe("markdown");
    expect(source.path.startsWith("sources/你好-")).toBe(true);
    // The editor edits the stored content — it must stay raw markdown, never HTML.
    await expect(readSourceContent(vault, source)).resolves.toBe("# 标题\n\n正文 **加粗**。");

    // The READER path derives HTML + study ids deterministically from the markdown.
    const rendered = await renderSource(deps(), { sourceId: source.id });
    expect(rendered.content).toContain("<strong>加粗</strong>");
    expect(rendered.content).toContain('data-study-id="md-');
  });

  it("supports blank markdown creation (empty body → empty projection)", async () => {
    const { source } = await createAuthoredSource(deps(), { title: "空白", sourceType: "markdown", content: "" });
    await expect(readSourceContent(vault, source)).resolves.toBe("");
    const rendered = await renderSource(deps(), { sourceId: source.id });
    expect(rendered.content).toBe("");
  });

  it("creates an authored html source with study ids injected at rest", async () => {
    const { source } = await createAuthoredSource(deps(), {
      title: "网页",
      sourceType: "html",
      content: "<h1>Hello</h1><p>World.</p>"
    });
    expect(source.origin).toBe("authored");
    const stored = await readSourceContent(vault, source);
    expect(stored).toContain('data-study-id="html-');
  });

  it("leaves existing ingest paths imported: origin defaults + body stays read-only", async () => {
    const source = await ingestHtmlSource(vault, { title: "Imported", content: HTML_BODY });
    expect(source.origin).toBe("imported");
    expect(source.revision).toBe(1);

    await expect(
      updateAuthoredSource(deps(), { sourceId: source.id, content: "<p>rewrite</p>" })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects updates for unknown sources", async () => {
    await expect(
      updateAuthoredSource(deps(), { sourceId: "src_missing", content: "x" })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("SRC-2 — save → re-hash → re-project (html)", () => {
  it("editing ELSEWHERE keeps the anchor matched (re-bound by quote, never by studyId)", async () => {
    const { source, anchor } = await seedAuthoredHtmlWithAnchor();

    const edited = HTML_BODY.replace(
      "Ribosomes translate messenger RNA into protein.",
      "Ribosomes translate mRNA into protein chains, edited far from the anchor."
    );
    const result = await updateAuthoredSource(deps(), { sourceId: source.id, content: edited });

    expect(result.source.revision).toBe(2);
    expect(result.source.contentHash).not.toBe(source.contentHash);
    expect(result.reprojection).toMatchObject({ total: 1, matched: 1, fuzzy: 0, unmatched: 0 });

    const saved = (await vault.stores.anchors.list()).find((a) => a.id === anchor.id) as HtmlSelectionAnchor;
    expect(saved.matchStatus).toBe("matched");
    expect(saved.quote).toBe(QUOTE);
    // The studyId re-resolved against the NEW content actually exists there.
    const stored = await readSourceContent(vault, result.source);
    expect(stored).toContain(`data-study-id="${saved.studyId}"`);
  });

  it("editing the ANCHORED passage turns the anchor unmatched and lists it with its quote", async () => {
    const { source, anchor } = await seedAuthoredHtmlWithAnchor();

    const edited = HTML_BODY.replace(
      "The mitochondrion is the powerhouse of the cell.",
      "Chloroplasts capture light energy instead."
    );
    const result = await updateAuthoredSource(deps(), { sourceId: source.id, content: edited });

    expect(result.reprojection).toMatchObject({ total: 1, matched: 0, unmatched: 1 });
    expect(result.reprojection.anchors).toEqual([
      { anchorId: anchor.id, status: "unmatched", quote: QUOTE }
    ]);

    const saved = (await vault.stores.anchors.list()).find((a) => a.id === anchor.id);
    expect(saved?.matchStatus).toBe("unmatched");
    // The original quote survives for the 受影响的锚点 list / later manual re-binding.
    expect(saved?.quote).toBe(QUOTE);
  });

  it("casing drift re-locates as FUZZY and refreshes the anchor's quote", async () => {
    const { source, anchor } = await seedAuthoredHtmlWithAnchor();

    const edited = HTML_BODY.replace("the powerhouse of the cell", "THE POWERHOUSE of the cell");
    const result = await updateAuthoredSource(deps(), { sourceId: source.id, content: edited });

    expect(result.reprojection.fuzzy).toBe(1);
    const saved = (await vault.stores.anchors.list()).find((a) => a.id === anchor.id);
    expect(saved?.matchStatus).toBe("fuzzy");
    expect(saved?.quote).toBe("THE POWERHOUSE of the cell");
  });

  it("a no-change save bumps nothing; a pure rename changes the title only", async () => {
    const { source } = await seedAuthoredHtmlWithAnchor();
    const stored = await readSourceContent(vault, source);

    const noop = await updateAuthoredSource(deps(), { sourceId: source.id, content: stored });
    expect(noop.source.revision).toBe(1);
    expect(noop.reprojection.total).toBe(0);

    const renamed = await updateAuthoredSource(deps(), {
      sourceId: source.id,
      content: stored,
      title: "Cell biology (v2)"
    });
    expect(renamed.source.title).toBe("Cell biology (v2)");
    expect(renamed.source.path).toContain("cell-biology-v2-");
    expect(renamed.source.revision).toBe(1);
    await expect(vault.storage.readText(path.join(vault.paths.rootDir, source.path))).resolves.toBeNull();
    await expect(readSourceContent(vault, renamed.source)).resolves.toBe(stored);
  });
});

describe("SRC-2 — save → re-project (markdown, quotes come from the RENDERED text)", () => {
  it("re-projects a quote that spans markdown formatting after an edit elsewhere", async () => {
    const markdown = "# 细胞\n\nThe **mitochondrion** is the powerhouse of the cell.\n\n另一个段落。";
    const { source } = await createAuthoredSource(deps(), {
      title: "MD 细胞",
      sourceType: "markdown",
      content: markdown
    });

    // The anchor quote is what the reader DOM shows — no asterisks. A raw-markdown
    // matcher would MISS it; the pipeline must match against the projected HTML text.
    const anchor = createHtmlSelectionAnchor({
      sourceId: source.id,
      studyId: "md-999", // stale on purpose: re-projection must not trust it
      quote: "The mitochondrion is the powerhouse of the cell.",
      contextBefore: "细胞 ",
      contextAfter: " 另一个段落。"
    });
    await vault.stores.anchors.upsert(anchor);

    const edited = markdown.replace("另一个段落。", "换掉的段落,与锚点无关。");
    const result = await updateAuthoredSource(deps(), { sourceId: source.id, content: edited });

    expect(result.reprojection).toMatchObject({ matched: 1, unmatched: 0 });
    const saved = (await vault.stores.anchors.list()).find((a) => a.id === anchor.id) as HtmlSelectionAnchor;
    expect(saved.matchStatus).toBe("matched");
    // Re-bound to a REAL study id in the new projection.
    const projected = projectedHtmlForSource(result.source, edited);
    expect(saved.studyId).toMatch(/^md-\d+$/);
    expect(projected).toContain(`data-study-id="${saved.studyId}"`);
    // The raw markdown stays raw on disk.
    await expect(readSourceContent(vault, result.source)).resolves.toBe(edited);
  });
});

describe("SRC-2 — shared-source warning input (share-status)", () => {
  it("a fresh authored source is not shared", async () => {
    const { source } = await createAuthoredSource(deps(), { title: "私有", sourceType: "markdown", content: "x" });
    await expect(getSourceShareStatus(deps(), { sourceId: source.id })).resolves.toEqual({
      shared: false,
      publishedPackCount: 0,
      importedLayerCount: 0
    });
  });

  it("publish-ledger entries and imported layers on the source flip it to shared", async () => {
    const { source } = await createAuthoredSource(deps(), { title: "已分享", sourceType: "html", content: HTML_BODY });
    const now = new Date().toISOString();

    // A layer of this source that was PUBLISHED (a ledger pins its pack to the layer).
    const publishedLayer = studyLayerSchema.parse({
      id: createEntityId("layer"),
      type: "layer",
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: "user",
      localSourceId: source.id,
      title: "我的划线"
    });
    await vault.stores.layers.upsert(publishedLayer);
    await mkdir(path.join(tempDir, "publishes"), { recursive: true });
    await writeFile(
      path.join(tempDir, "publishes", "pack_test1.json"),
      JSON.stringify({
        v: 1,
        packId: "pack_test1",
        layerId: publishedLayer.id,
        title: "Shared pack",
        revision: 1,
        validity: { notBefore: null, validUntil: null },
        createdAt: now,
        updatedAt: now,
        recipients: [],
        codeSecretsEnc: "ZmFrZQ"
      }),
      "utf8"
    );

    // A layer that itself ARRIVED from a shared pack, bound to this source.
    const importedLayer = studyLayerSchema.parse({
      id: createEntityId("layer"),
      type: "layer",
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: "user",
      localSourceId: source.id,
      title: "导入的层",
      importMode: "imported",
      origin: { packId: "pack_other", importedAt: now }
    });
    await vault.stores.layers.upsert(importedLayer);

    await expect(getSourceShareStatus(deps(), { sourceId: source.id })).resolves.toEqual({
      shared: true,
      publishedPackCount: 1,
      importedLayerCount: 1
    });
  });
});

describe("routes — authored create + content update (zod single-source + error mapping)", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp({ vault });
  });

  it("POST /api/sources/authored creates and returns the authored record", async () => {
    const created = await request(app)
      .post("/api/sources/authored")
      .send({ title: "新建 Markdown", sourceType: "markdown" })
      .expect(201);
    expect(created.body.source.origin).toBe("authored");
    expect(created.body.source.revision).toBe(1);
    expect(created.body.source.sourceType).toBe("markdown");
  });

  it("POST /api/sources/authored rejects non-authorable source types", async () => {
    await request(app).post("/api/sources/authored").send({ title: "x", sourceType: "pdf" }).expect(400);
  });

  it("PATCH /api/sources/:id/content maps NotFound and the imported guard", async () => {
    await request(app).patch("/api/sources/src_missing/content").send({ content: "x" }).expect(404);

    const imported = await ingestHtmlSource(vault, { title: "Imported", content: HTML_BODY });
    const res = await request(app)
      .patch(`/api/sources/${imported.id}/content`)
      .send({ content: "<p>nope</p>" })
      .expect(400);
    expect(res.body.error).toContain("read-only");
  });

  it("PATCH /api/sources/:id/content saves and reports the reprojection", async () => {
    const { source, anchor } = await seedAuthoredHtmlWithAnchor();
    const res = await request(app)
      .patch(`/api/sources/${source.id}/content`)
      .send({ content: HTML_BODY.replace("powerhouse of the cell", "engine room of the cell") })
      .expect(200);
    expect(res.body.source.revision).toBe(2);
    expect(res.body.reprojection.unmatched).toBe(1);
    expect(res.body.reprojection.anchors[0]).toMatchObject({ anchorId: anchor.id, status: "unmatched" });
  });

  it("GET /api/sources/:id/share-status answers for the edit warning", async () => {
    const { source } = await seedAuthoredHtmlWithAnchor();
    const res = await request(app).get(`/api/sources/${source.id}/share-status`).expect(200);
    expect(res.body).toEqual({ shared: false, publishedPackCount: 0, importedLayerCount: 0 });
    await request(app).get("/api/sources/src_missing/share-status").expect(404);
  });
});
