import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureHtmlBody } from "../core/fixtures/golden";
import { openVault, type StudyVault } from "../core/vault";
import { createApp } from "./app";

let tempDir = "";
let vault: StudyVault;
let app: ReturnType<typeof createApp>;

// Collect a binary response body into a Buffer so we can byte-compare served files.
function binaryParser(res: any, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
  res.on("error", (err: Error) => callback(err, Buffer.alloc(0)));
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-api-"));
  vault = await openVault({ rootDir: tempDir });
  app = createApp({ vault });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("vault server API", () => {
  it("reports health", async () => {
    await request(app).get("/api/health").expect(200).expect({ ok: true, app: "ai-study-vault" });
  });

  it("ingests and lists HTML sources", async () => {
    const created = await request(app)
      .post("/api/sources/html")
      .send({ title: "Render Thread", content: fixtureHtmlBody })
      .expect(201);

    expect(created.body.source.title).toBe("Render Thread");

    const list = await request(app).get("/api/sources").expect(200);
    expect(list.body.sources).toHaveLength(1);
    expect(list.body.sources[0].id).toBe(created.body.source.id);
  });

  it("creates anchors, notes, and patches for a source", async () => {
    const source = (
      await request(app).post("/api/sources/html").send({ title: "Render Thread", content: fixtureHtmlBody }).expect(201)
    ).body.source;

    const anchor = (
      await request(app)
        .post("/api/anchors")
        .send({
          sourceId: source.id,
          studyId: "p-render-thread",
          selector: '[data-study-id="p-render-thread"]',
          quote: "Render Thread submits rendering commands."
        })
        .expect(201)
    ).body.anchor;

    const note = (
      await request(app)
        .post("/api/notes")
        .send({
          sourceId: source.id,
          anchorIds: [anchor.id],
          contentType: "markdown",
          content: "A manual note."
        })
        .expect(201)
    ).body.note;

    const patch = (
      await request(app)
        .post("/api/patches")
        .send({
          sourceId: source.id,
          anchorId: anchor.id,
          action: "replace_selection",
          oldText: "Render Thread submits rendering commands.",
          newContent: '<p data-study-id="p-render-thread">Updated render-thread text.</p>'
        })
        .expect(201)
    ).body.patch;

    expect(note.anchorIds).toEqual([anchor.id]);
    expect(note.contentType).toBe("markdown");
    expect(patch.status).toBe("pending");

    const applied = await request(app).patch(`/api/patches/${patch.id}`).send({ status: "applied" }).expect(200);
    expect(applied.body.patch.status).toBe("applied");

    const rendered = await request(app).get(`/api/sources/${source.id}/rendered`).expect(200);
    expect(rendered.body.content).toContain("Updated render-thread text.");

    const reverted = await request(app).patch(`/api/patches/${patch.id}`).send({ status: "reverted" }).expect(200);
    expect(reverted.body.patch.status).toBe("reverted");
  });

  it("returns conflict when applying a drifted patch", async () => {
    const source = (
      await request(app).post("/api/sources/html").send({ title: "Render Thread", content: fixtureHtmlBody }).expect(201)
    ).body.source;
    const anchor = (
      await request(app)
        .post("/api/anchors")
        .send({
          sourceId: source.id,
          studyId: "p-render-thread",
          quote: "Render Thread submits rendering commands."
        })
        .expect(201)
    ).body.anchor;
    const patch = (
      await request(app)
        .post("/api/patches")
        .send({
          sourceId: source.id,
          anchorId: anchor.id,
          action: "replace_selection",
          oldText: "Text that has drifted.",
          newContent: "<p>Should not apply.</p>"
        })
        .expect(201)
    ).body.patch;

    const response = await request(app).patch(`/api/patches/${patch.id}`).send({ status: "applied" }).expect(409);

    expect(response.body.patch.status).toBe("conflict");
    expect(response.body.conflict.reason).toBe("text_mismatch");
  });

  it("ingests a sanitized webpage snapshot from a URL", async () => {
    const html =
      "<!doctype html><html><head><title>Remote Page</title></head>" +
      '<body><article><p>Hello from the web.</p><a href="/about">about</a>' +
      "<script>steal()</script></article></body></html>";
    const fetchMock = vi.fn(async () =>
      new Response(html, { status: 200, headers: { "content-type": "text/html" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const created = await request(app)
        .post("/api/sources/url")
        .send({ url: "https://example.com/post/?utm_source=newsletter" })
        .expect(201);

      expect(created.body.source.sourceType).toBe("webpage");
      expect(created.body.source.title).toBe("Remote Page");
      expect(created.body.source.metadata.normalizedUrl).toBe("https://example.com/post");

      const content = await request(app)
        .get(`/api/sources/${created.body.source.id}/content`)
        .expect(200);
      expect(content.text).toContain("Hello from the web.");
      expect(content.text).toContain('href="https://example.com/about"');
      expect(content.text).not.toContain("steal()");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("ingests and serves a local PDF source", async () => {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "latin1");
    const created = await request(app)
      .post("/api/sources/pdf")
      .send({ title: "Local Doc", dataBase64: pdf.toString("base64") })
      .expect(201);

    expect(created.body.source.sourceType).toBe("pdf");
    expect(created.body.source.mimeType).toBe("application/pdf");
    expect(created.body.source.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);

    const file = await request(app)
      .get(`/api/sources/${created.body.source.id}/file`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200)
      .expect("Content-Type", /application\/pdf/);
    expect(Buffer.from(file.body).equals(pdf)).toBe(true);
  });

  it("rejects a non-PDF upload to the PDF endpoint", async () => {
    const response = await request(app)
      .post("/api/sources/pdf")
      .send({ title: "Not a PDF", dataBase64: Buffer.from("just text").toString("base64") })
      .expect(400);
    expect(response.body.error).toContain("not a valid PDF");
  });

  it("answers a chat request via the default mock provider", async () => {
    const response = await request(app)
      .post("/api/chat")
      .send({
        messages: [{ role: "user", content: "Summarize this passage." }],
        context: { sourceTitle: "Render Thread", quote: "Render Thread submits rendering commands." }
      })
      .expect(200);

    expect(response.body.provider).toBe("mock");
    expect(response.body.message.role).toBe("assistant");
    expect(response.body.message.content).toContain("Summarize this passage.");
    expect(response.body.message.content).toContain("Render Thread");
  });

  it("synthesizes a chat transcript into a new markdown source (POST /api/chat/synthesize)", async () => {
    // The default mock echoes the `sample` as the {title, markdown} doc → deterministic.
    const sample = { title: "Synthesized Doc", markdown: "# Overview\n\nBody.\n\n## More\n\nDetails." };
    const created = await request(app)
      .post("/api/chat/synthesize")
      .send({
        messages: [
          { role: "user", content: "Explain X." },
          { role: "assistant", content: "X is Y." },
          { role: "user", content: "Turn it into a doc." }
        ],
        sample
      })
      .expect(201);

    expect(created.body.source.id).toMatch(/^src_/);
    expect(created.body.source.sourceType).toBe("markdown");
    expect(created.body.source.origin).toBe("authored");
    expect(created.body.source.title).toBe("Synthesized Doc");

    // The new source LISTS via the normal source route + renders headings.
    const list = await request(app).get("/api/sources").expect(200);
    expect(list.body.sources.map((s: { id: string }) => s.id)).toContain(created.body.source.id);
    const rendered = await request(app).get(`/api/sources/${created.body.source.id}/rendered`).expect(200);
    expect(rendered.body.content).toContain("<h1");
    expect(rendered.body.content).toContain("Overview");
  });

  it("rejects a synthesize request with no messages (400)", async () => {
    await request(app).post("/api/chat/synthesize").send({ messages: [] }).expect(400);
  });

  it("streams a chat reply over SSE that rejoins to the one-shot answer", async () => {
    const oneShot = await request(app)
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "Summarize this passage." }] })
      .expect(200);

    const response = await request(app)
      .post("/api/chat/stream")
      .send({ messages: [{ role: "user", content: "Summarize this passage." }] })
      .expect(200);

    expect(response.headers["content-type"]).toContain("text/event-stream");

    // Parse the SSE frames: collect `chunk` deltas and the final `done` payload.
    const deltas: string[] = [];
    let done: { message: { content: string }; provider: string } | null = null;
    for (const frame of response.text.split("\n\n")) {
      if (!frame.trim()) continue;
      let event = "message";
      const data: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trim());
      }
      const payload = JSON.parse(data.join("\n"));
      if (event === "chunk") deltas.push(payload.delta);
      else if (event === "done") done = payload;
    }

    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join("")).toBe(oneShot.body.message.content);
    expect(done?.provider).toBe("mock");
    expect(done?.message.content).toBe(oneShot.body.message.content);
  });

  it("rejects an empty streaming chat request before opening the stream", async () => {
    await request(app).post("/api/chat/stream").send({ messages: [] }).expect(400);
  });

  it("opens a URL as a live web source (no snapshot)", async () => {
    const created = await request(app)
      .post("/api/sources/web-live")
      .send({ url: "https://example.com/post/?utm_source=news" })
      .expect(201);

    expect(created.body.source.sourceType).toBe("web_live");
    expect(created.body.source.metadata.normalizedUrl).toBe("https://example.com/post");
    expect(created.body.source.metadata.sourceUrl).toContain("example.com");
  });

  it("creates a web_text_quote anchor keyed to the live source URL", async () => {
    const source = (
      await request(app).post("/api/sources/web-live").send({ url: "https://example.com/post" }).expect(201)
    ).body.source;

    const anchor = (
      await request(app)
        .post("/api/anchors")
        .send({
          sourceId: source.id,
          anchorKind: "web_text_quote",
          quote: "render thread",
          contextBefore: "the ",
          contextAfter: " submits"
        })
        .expect(201)
    ).body.anchor;

    expect(anchor.anchorKind).toBe("web_text_quote");
    expect(anchor.normalizedUrl).toBe("https://example.com/post");
    expect(anchor.quote).toBe("render thread");

    await request(app)
      .post("/api/notes")
      .send({ sourceId: source.id, anchorIds: [anchor.id], contentType: "markdown", content: "web note" })
      .expect(201);

    const list = await request(app).get(`/api/sources/${source.id}/anchors`).expect(200);
    expect(list.body.anchors).toHaveLength(1);
    expect(list.body.anchors[0].anchorKind).toBe("web_text_quote");
  });

  it("creates a pdf_selection anchor by page + quote", async () => {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "latin1");
    const source = (
      await request(app)
        .post("/api/sources/pdf")
        .send({ title: "Doc", dataBase64: pdf.toString("base64") })
        .expect(201)
    ).body.source;

    const anchor = (
      await request(app)
        .post("/api/anchors")
        .send({
          sourceId: source.id,
          anchorKind: "pdf_selection",
          page: 2,
          quote: "render thread submits commands"
        })
        .expect(201)
    ).body.anchor;

    expect(anchor.anchorKind).toBe("pdf_selection");
    expect(anchor.page).toBe(2);
    expect(anchor.quote).toBe("render thread submits commands");
  });

  it("rejects a pdf_selection anchor without a page", async () => {
    const pdf = Buffer.from("%PDF-1.4\n%%EOF\n", "latin1");
    const source = (
      await request(app)
        .post("/api/sources/pdf")
        .send({ title: "Doc2", dataBase64: pdf.toString("base64") })
        .expect(201)
    ).body.source;
    await request(app)
      .post("/api/anchors")
      .send({ sourceId: source.id, anchorKind: "pdf_selection", quote: "x" })
      .expect(400);
  });

  it("creates a pdf_selection REGION anchor (rect, empty quote)", async () => {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "latin1");
    const source = (
      await request(app)
        .post("/api/sources/pdf")
        .send({ title: "FigDoc", dataBase64: pdf.toString("base64") })
        .expect(201)
    ).body.source;

    const anchor = (
      await request(app)
        .post("/api/anchors")
        .send({ sourceId: source.id, anchorKind: "pdf_selection", page: 1, rect: [0.1, 0.2, 0.3, 0.4] })
        .expect(201)
    ).body.anchor;

    expect(anchor.anchorKind).toBe("pdf_selection");
    expect(anchor.page).toBe(1);
    expect(anchor.rect).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(anchor.quote).toBe("");
  });

  it("creates an image_region anchor from a rect", async () => {
    // 1x1 transparent PNG.
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const source = (
      await request(app)
        .post("/api/sources/image")
        .send({ title: "Pic", dataBase64: pngBase64, mimeType: "image/png" })
        .expect(201)
    ).body.source;
    expect(source.sourceType).toBe("image");

    const anchor = (
      await request(app)
        .post("/api/anchors")
        .send({ sourceId: source.id, anchorKind: "image_region", rect: [0, 0, 0.5, 0.5] })
        .expect(201)
    ).body.anchor;

    expect(anchor.anchorKind).toBe("image_region");
    expect(anchor.rect).toEqual([0, 0, 0.5, 0.5]);

    await request(app)
      .post("/api/notes")
      .send({ sourceId: source.id, anchorIds: [anchor.id], contentType: "markdown", content: "image note" })
      .expect(201);

    const list = await request(app).get(`/api/sources/${source.id}/anchors`).expect(200);
    expect(list.body.anchors[0].anchorKind).toBe("image_region");
  });

  it("rejects an image_region anchor without a rect", async () => {
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const source = (
      await request(app)
        .post("/api/sources/image")
        .send({ title: "Pic2", dataBase64: pngBase64 })
        .expect(201)
    ).body.source;
    await request(app)
      .post("/api/anchors")
      .send({ sourceId: source.id, anchorKind: "image_region" })
      .expect(400);
  });

  it("rejects an anchor with neither a non-empty quote nor a rect", async () => {
    const source = (
      await request(app).post("/api/sources/html").send({ title: "Q", content: fixtureHtmlBody }).expect(201)
    ).body.source;
    await request(app)
      .post("/api/anchors")
      .send({ sourceId: source.id, anchorKind: "html_selection", studyId: "html-1", selector: "x", quote: "  " })
      .expect(400);
  });

  it("rejects an empty chat request", async () => {
    await request(app).post("/api/chat").send({ messages: [] }).expect(400);
  });

  it("validates note content against its content type", async () => {
    const source = (
      await request(app).post("/api/sources/html").send({ title: "Doc", content: fixtureHtmlBody }).expect(201)
    ).body.source;

    // Unknown content type → 400.
    await request(app)
      .post("/api/notes")
      .send({ sourceId: source.id, contentType: "totally-unknown", content: "x" })
      .expect(400);

    // quiz with <2 options → 400.
    await request(app)
      .post("/api/notes")
      .send({ sourceId: source.id, contentType: "quiz", content: { question: "Q", options: ["one"], answerIndex: 0 } })
      .expect(400);

    // A valid quiz note → 201, content round-trips.
    const quiz = (
      await request(app)
        .post("/api/notes")
        .send({
          sourceId: source.id,
          contentType: "quiz",
          content: { question: "Q", options: ["a", "b"], answerIndex: 1 }
        })
        .expect(201)
    ).body.note;
    expect(quiz.content.answerIndex).toBe(1);
  });

  it("serves the built client with an SPA fallback when clientDir is set", async () => {
    const clientDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-client-"));
    await writeFile(path.join(clientDir, "index.html"), "<!doctype html><title>Vault UI</title>");
    const uiApp = createApp({ vault, clientDir });

    try {
      await request(uiApp).get("/").expect(200).expect(/Vault UI/);
      // Deep links fall back to index.html (client-side routing).
      await request(uiApp).get("/library/some-source").expect(200).expect(/Vault UI/);
      // API routes are not shadowed by the SPA fallback.
      await request(uiApp).get("/api/health").expect(200, { ok: true, app: "ai-study-vault" });
    } finally {
      await rm(clientDir, { recursive: true, force: true });
    }
  });

  it("imports a local file as an asset and serves its bytes", async () => {
    const assetFile = path.join(tempDir, "diagram.png");
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    await writeFile(assetFile, bytes);

    const created = await request(app).post("/api/assets/local-file").send({ path: assetFile }).expect(201);
    const asset = created.body.asset;
    expect(asset.assetType).toBe("image");
    expect(asset.mimeType).toBe("image/png");
    expect(asset.byteSize).toBe(bytes.length);
    expect(asset.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);

    const meta = await request(app).get(`/api/assets/${asset.id}/meta`).expect(200);
    expect(meta.body.asset.id).toBe(asset.id);

    const served = await request(app)
      .get(`/api/assets/${asset.id}`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200)
      .expect("Content-Type", /image\/png/);
    expect(Buffer.from(served.body).equals(bytes)).toBe(true);

    // Re-importing the same bytes reuses the asset (dedupe by hash).
    const again = await request(app).post("/api/assets/local-file").send({ path: assetFile }).expect(201);
    expect(again.body.asset.id).toBe(asset.id);
  });

  it("creates concepts and links notes, with back-references", async () => {
    const source = (
      await request(app).post("/api/sources/html").send({ title: "Doc", content: fixtureHtmlBody }).expect(201)
    ).body.source;

    const concept = (
      await request(app)
        .post("/api/concepts")
        .send({ name: "Render Thread", aliases: ["UE Render Thread"], tags: ["rendering"] })
        .expect(201)
    ).body.concept;

    const note = (
      await request(app)
        .post("/api/notes")
        .send({ sourceId: source.id, conceptIds: [concept.id], contentType: "markdown", content: "Explains it." })
        .expect(201)
    ).body.note;

    const detail = await request(app).get(`/api/concepts/${concept.id}`).expect(200);
    expect(detail.body.concept.name).toBe("Render Thread");
    expect(detail.body.notes.map((n: { id: string }) => n.id)).toContain(note.id);

    // Entity query: notes by concept.
    const byConcept = await request(app).get(`/api/notes?conceptId=${concept.id}`).expect(200);
    expect(byConcept.body.notes).toHaveLength(1);
    expect(byConcept.body.notes[0].id).toBe(note.id);
  });

  it("merges concepts and deletes a concept with note/relation cleanup", async () => {
    const source = (
      await request(app).post("/api/sources/html").send({ title: "Doc", content: fixtureHtmlBody }).expect(201)
    ).body.source;
    const a = (await request(app).post("/api/concepts").send({ name: "Render Thread", aliases: ["RT"], tags: ["render"] }).expect(201)).body.concept;
    const b = (await request(app).post("/api/concepts").send({ name: "Game Thread", tags: ["runtime"] }).expect(201)).body.concept;
    const note = (
      await request(app)
        .post("/api/notes")
        .send({ sourceId: source.id, conceptIds: [a.id], contentType: "markdown", content: "Explains it." })
        .expect(201)
    ).body.note;
    const relation = (
      await request(app)
        .post("/api/relations")
        .send({ from: { type: "concept", id: a.id }, to: { type: "concept", id: b.id }, relationKind: "related" })
        .expect(201)
    ).body.relation;

    const merged = await request(app).post(`/api/concepts/${a.id}/merge`).send({ targetConceptId: b.id }).expect(200);
    expect(merged.body.concept.id).toBe(b.id);
    expect(merged.body.concept.aliases).toEqual(expect.arrayContaining(["Render Thread", "RT"]));
    expect(merged.body.concept.tags).toEqual(expect.arrayContaining(["render", "runtime"]));
    await request(app).get(`/api/concepts/${a.id}`).expect(404);

    const targetDetail = await request(app).get(`/api/concepts/${b.id}`).expect(200);
    expect(targetDetail.body.notes.map((item: { id: string }) => item.id)).toContain(note.id);
    expect(targetDetail.body.relations.map((item: { id: string }) => item.id)).not.toContain(relation.id);

    const deleteResult = await request(app).delete(`/api/concepts/${b.id}`).expect(200);
    expect(deleteResult.body.notesUpdated).toBe(1);
    expect((await request(app).get(`/api/notes?conceptId=${b.id}`).expect(200)).body.notes).toHaveLength(0);
    await request(app).get(`/api/concepts/${b.id}`).expect(404);
  });

  it("links an EXISTING note to a concept via PATCH /api/notes/:id", async () => {
    const source = (
      await request(app).post("/api/sources/html").send({ title: "Doc", content: fixtureHtmlBody }).expect(201)
    ).body.source;
    const concept = (await request(app).post("/api/concepts").send({ name: "Render Thread" }).expect(201)).body.concept;

    // A note created with no concept link.
    const note = (
      await request(app)
        .post("/api/notes")
        .send({ sourceId: source.id, contentType: "markdown", content: "Loose note." })
        .expect(201)
    ).body.note;
    expect(note.conceptIds).toEqual([]);

    // PATCH attaches the concept; the note then back-references in the concept detail.
    const linked = await request(app)
      .patch(`/api/notes/${note.id}`)
      .send({ conceptIds: [concept.id] })
      .expect(200);
    expect(linked.body.note.conceptIds).toEqual([concept.id]);

    const detail = await request(app).get(`/api/concepts/${concept.id}`).expect(200);
    expect(detail.body.notes.map((n: { id: string }) => n.id)).toContain(note.id);
  });

  it("returns 404 patching a missing note, 400 for an empty body", async () => {
    await request(app).patch("/api/notes/note_does_not_exist").send({ conceptIds: [] }).expect(404);
    // A note exists, but the body carries neither conceptIds nor anchorIds → 400.
    const source = (
      await request(app).post("/api/sources/html").send({ title: "Doc", content: fixtureHtmlBody }).expect(201)
    ).body.source;
    const note = (
      await request(app)
        .post("/api/notes")
        .send({ sourceId: source.id, contentType: "markdown", content: "x" })
        .expect(201)
    ).body.note;
    await request(app).patch(`/api/notes/${note.id}`).send({}).expect(400);
  });

  it("edits a note's CONTENT via PATCH, re-validating against its contentType", async () => {
    const source = (
      await request(app).post("/api/sources/html").send({ title: "Doc", content: fixtureHtmlBody }).expect(201)
    ).body.source;

    // A markdown note (content is a string).
    const note = (
      await request(app)
        .post("/api/notes")
        .send({ sourceId: source.id, contentType: "markdown", content: "original" })
        .expect(201)
    ).body.note;

    // Edit just the content — it persists and the contentType stays fixed.
    const edited = (
      await request(app).patch(`/api/notes/${note.id}`).send({ content: "rewritten" }).expect(200)
    ).body.note;
    expect(edited.content).toBe("rewritten");
    expect(edited.contentType).toBe("markdown");
    const refetched = (await request(app).get(`/api/notes?sourceId=${source.id}`).expect(200)).body.notes.find(
      (n: { id: string }) => n.id === note.id
    );
    expect(refetched.content).toBe("rewritten");
  });

  it("rejects an edit whose content fails the type's schema with 400", async () => {
    const source = (
      await request(app).post("/api/sources/html").send({ title: "Doc", content: fixtureHtmlBody }).expect(201)
    ).body.source;

    // A flashcard note requires { front, back }.
    const note = (
      await request(app)
        .post("/api/notes")
        .send({ sourceId: source.id, contentType: "flashcard", content: { front: "Q", back: "A" } })
        .expect(201)
    ).body.note;

    // A string (markdown-shaped) content is invalid for a flashcard → 400, unchanged.
    await request(app).patch(`/api/notes/${note.id}`).send({ content: "not a flashcard" }).expect(400);
    const unchanged = (await request(app).get(`/api/notes?sourceId=${source.id}`).expect(200)).body.notes.find(
      (n: { id: string }) => n.id === note.id
    );
    expect(unchanged.content).toEqual({ front: "Q", back: "A" });
  });

  it("content edit and attachment edits coexist (conceptIds/anchorIds/layerIds still work)", async () => {
    const source = (
      await request(app).post("/api/sources/html").send({ title: "Doc", content: fixtureHtmlBody }).expect(201)
    ).body.source;
    const concept = (await request(app).post("/api/concepts").send({ name: "Topic" }).expect(201)).body.concept;
    const note = (
      await request(app)
        .post("/api/notes")
        .send({ sourceId: source.id, contentType: "markdown", content: "before" })
        .expect(201)
    ).body.note;

    // Concept link still works after introducing content support.
    const linked = (
      await request(app).patch(`/api/notes/${note.id}`).send({ conceptIds: [concept.id] }).expect(200)
    ).body.note;
    expect(linked.conceptIds).toEqual([concept.id]);
    expect(linked.content).toBe("before");

    // Content + attachment in one PATCH.
    const both = (
      await request(app)
        .patch(`/api/notes/${note.id}`)
        .send({ content: "after", conceptIds: [] })
        .expect(200)
    ).body.note;
    expect(both.content).toBe("after");
    expect(both.conceptIds).toEqual([]);
  });

  it("deletes a note (200), then 404 on the second delete", async () => {
    const source = (
      await request(app).post("/api/sources/html").send({ title: "Doc", content: fixtureHtmlBody }).expect(201)
    ).body.source;
    const note = (
      await request(app)
        .post("/api/notes")
        .send({ sourceId: source.id, contentType: "markdown", content: "to be deleted" })
        .expect(201)
    ).body.note;

    await request(app).delete(`/api/notes/${note.id}`).expect(200);
    // It is gone from the list.
    const remaining = (await request(app).get(`/api/notes?sourceId=${source.id}`).expect(200)).body.notes;
    expect(remaining.find((n: { id: string }) => n.id === note.id)).toBeUndefined();
    // A second delete (or an unknown id) → 404.
    await request(app).delete(`/api/notes/${note.id}`).expect(404);
    await request(app).delete("/api/notes/note_does_not_exist").expect(404);
  });

  // —— Orphan-anchor cascade on note delete (the "highlight stays after delete" bug). ——
  // Painting is anchor-derived, so a note delete must also remove anchors that no other
  // note/patch references; shared / patch-referenced anchors are preserved.
  it("prunes note-less anchors from the source anchor list", async () => {
    const source = (
      await request(app).post("/api/sources/html").send({ title: "Doc", content: fixtureHtmlBody }).expect(201)
    ).body.source;
    const anchor = (
      await request(app)
        .post("/api/anchors")
        .send({ sourceId: source.id, studyId: "p-render-thread", quote: "Render Thread submits rendering commands." })
        .expect(201)
    ).body.anchor;

    const anchors = (await request(app).get(`/api/sources/${source.id}/anchors`).expect(200)).body.anchors;

    expect(anchors.find((a: { id: string }) => a.id === anchor.id)).toBeUndefined();
    expect(await vault.stores.anchors.get(anchor.id)).toBeNull();
  });

  it("deleting a note cascade-deletes its now-orphaned (exclusive) anchor", async () => {
    const source = (
      await request(app).post("/api/sources/html").send({ title: "Doc", content: fixtureHtmlBody }).expect(201)
    ).body.source;
    const anchor = (
      await request(app)
        .post("/api/anchors")
        .send({ sourceId: source.id, studyId: "p-render-thread", quote: "Render Thread submits rendering commands." })
        .expect(201)
    ).body.anchor;
    const note = (
      await request(app)
        .post("/api/notes")
        .send({ sourceId: source.id, anchorIds: [anchor.id], contentType: "markdown", content: "only note" })
        .expect(201)
    ).body.note;

    await request(app).delete(`/api/notes/${note.id}`).expect(200);

    // The exclusive anchor is gone → the painted-anchors list (what the reader uses) no
    // longer carries it, so the highlight disappears on refresh.
    const anchors = (await request(app).get(`/api/sources/${source.id}/anchors`).expect(200)).body.anchors;
    expect(anchors.find((a: { id: string }) => a.id === anchor.id)).toBeUndefined();
  });

  it("deleting a note KEEPS an anchor still shared by another note", async () => {
    const source = (
      await request(app).post("/api/sources/html").send({ title: "Doc", content: fixtureHtmlBody }).expect(201)
    ).body.source;
    const anchor = (
      await request(app)
        .post("/api/anchors")
        .send({ sourceId: source.id, studyId: "p-render-thread", quote: "Render Thread submits rendering commands." })
        .expect(201)
    ).body.anchor;
    const noteA = (
      await request(app)
        .post("/api/notes")
        .send({ sourceId: source.id, anchorIds: [anchor.id], contentType: "markdown", content: "note A" })
        .expect(201)
    ).body.note;
    await request(app)
      .post("/api/notes")
      .send({ sourceId: source.id, anchorIds: [anchor.id], contentType: "markdown", content: "note B" })
      .expect(201);

    await request(app).delete(`/api/notes/${noteA.id}`).expect(200);

    // Still referenced by note B → kept (and still painted).
    const anchors = (await request(app).get(`/api/sources/${source.id}/anchors`).expect(200)).body.anchors;
    expect(anchors.find((a: { id: string }) => a.id === anchor.id)).toBeDefined();
  });

  it("deleting a note KEEPS an anchor referenced by a patch", async () => {
    const source = (
      await request(app).post("/api/sources/html").send({ title: "Doc", content: fixtureHtmlBody }).expect(201)
    ).body.source;
    const anchor = (
      await request(app)
        .post("/api/anchors")
        .send({ sourceId: source.id, studyId: "p-render-thread", quote: "Render Thread submits rendering commands." })
        .expect(201)
    ).body.anchor;
    const note = (
      await request(app)
        .post("/api/notes")
        .send({ sourceId: source.id, anchorIds: [anchor.id], contentType: "markdown", content: "note" })
        .expect(201)
    ).body.note;
    await request(app)
      .post("/api/patches")
      .send({
        sourceId: source.id,
        anchorId: anchor.id,
        action: "replace_selection",
        oldText: "Render Thread submits rendering commands.",
        newContent: '<p data-study-id="p-render-thread">Updated.</p>'
      })
      .expect(201);

    await request(app).delete(`/api/notes/${note.id}`).expect(200);

    // Even with no remaining note, the patch reference keeps the anchor alive.
    const all = (await request(app).get("/api/notes").expect(200)).body.notes;
    expect(all.find((n: { id: string }) => n.id === note.id)).toBeUndefined();
    const anchorStillExists = await vault.stores.anchors.get(anchor.id);
    expect(anchorStillExists).not.toBeNull();
    const anchors = (await request(app).get(`/api/sources/${source.id}/anchors`).expect(200)).body.anchors;
    expect(anchors.find((a: { id: string }) => a.id === anchor.id)).toBeUndefined();
  });

  it("multi-anchor note delete removes ONLY the now-orphaned anchors", async () => {
    const source = (
      await request(app).post("/api/sources/html").send({ title: "Doc", content: fixtureHtmlBody }).expect(201)
    ).body.source;
    const orphanAnchor = (
      await request(app)
        .post("/api/anchors")
        .send({ sourceId: source.id, studyId: "p-render-thread", quote: "Render Thread submits rendering commands." })
        .expect(201)
    ).body.anchor;
    const sharedAnchor = (
      await request(app)
        .post("/api/anchors")
        .send({ sourceId: source.id, studyId: "p-game-thread", quote: "Game Thread runs gameplay." })
        .expect(201)
    ).body.anchor;
    // Note 1 owns both anchors; note 2 also references the shared one.
    const note1 = (
      await request(app)
        .post("/api/notes")
        .send({
          sourceId: source.id,
          anchorIds: [orphanAnchor.id, sharedAnchor.id],
          contentType: "markdown",
          content: "note 1"
        })
        .expect(201)
    ).body.note;
    await request(app)
      .post("/api/notes")
      .send({ sourceId: source.id, anchorIds: [sharedAnchor.id], contentType: "markdown", content: "note 2" })
      .expect(201);

    await request(app).delete(`/api/notes/${note1.id}`).expect(200);

    expect(await vault.stores.anchors.get(orphanAnchor.id)).toBeNull();
    expect(await vault.stores.anchors.get(sharedAnchor.id)).not.toBeNull();
  });

  it("editing a note's anchorIds deletes anchors that no note references anymore", async () => {
    const source = (
      await request(app).post("/api/sources/html").send({ title: "Doc", content: fixtureHtmlBody }).expect(201)
    ).body.source;
    const removedAnchor = (
      await request(app)
        .post("/api/anchors")
        .send({ sourceId: source.id, studyId: "p-render-thread", quote: "Render Thread submits rendering commands." })
        .expect(201)
    ).body.anchor;
    const keptAnchor = (
      await request(app)
        .post("/api/anchors")
        .send({ sourceId: source.id, studyId: "p-game-thread", quote: "Game Thread runs gameplay." })
        .expect(201)
    ).body.anchor;
    const note = (
      await request(app)
        .post("/api/notes")
        .send({
          sourceId: source.id,
          anchorIds: [removedAnchor.id, keptAnchor.id],
          contentType: "markdown",
          content: "retargeted note"
        })
        .expect(201)
    ).body.note;

    await request(app).patch(`/api/notes/${note.id}`).send({ anchorIds: [keptAnchor.id] }).expect(200);

    expect(await vault.stores.anchors.get(removedAnchor.id)).toBeNull();
    expect(await vault.stores.anchors.get(keptAnchor.id)).not.toBeNull();
  });

  it("creates and deletes relations between concepts", async () => {
    const a = (await request(app).post("/api/concepts").send({ name: "Render Thread" }).expect(201)).body.concept;
    const b = (await request(app).post("/api/concepts").send({ name: "Game Thread" }).expect(201)).body.concept;

    const relation = (
      await request(app)
        .post("/api/relations")
        .send({
          from: { type: "concept", id: a.id },
          to: { type: "concept", id: b.id },
          relationKind: "depends_on"
        })
        .expect(201)
    ).body.relation;

    // The relation surfaces in both concepts' detail back-refs.
    const detail = await request(app).get(`/api/concepts/${a.id}`).expect(200);
    expect(detail.body.relations.map((r: { id: string }) => r.id)).toContain(relation.id);

    await request(app).delete(`/api/relations/${relation.id}`).expect(200);
    await request(app).delete(`/api/relations/${relation.id}`).expect(404);
  });

  it("persists and returns workspace layout", async () => {
    const empty = await request(app).get("/api/workspace").expect(200);
    expect(empty.body.workspace.layouts).toEqual([]);

    const state = {
      activeLayoutId: "three-pane",
      layouts: [
        {
          id: "three-pane",
          name: "Three Pane",
          mode: "dock" as const,
          nodes: [{ id: "n1", kind: "source.viewer" }],
          layout: { split: "vertical" }
        }
      ]
    };
    await request(app).put("/api/workspace").send(state).expect(200);

    const reloaded = await request(app).get("/api/workspace").expect(200);
    expect(reloaded.body.workspace.activeLayoutId).toBe("three-pane");
    expect(reloaded.body.workspace.layouts[0].nodes[0].kind).toBe("source.viewer");

    // Structurally invalid state is rejected.
    await request(app).put("/api/workspace").send({ activeLayoutId: 5 }).expect(400);
  });

  it("creates, lists, updates, and deletes a custom operation", async () => {
    const created = (
      await request(app)
        .post("/api/operations")
        .send({
          name: "Summarize",
          outputContentType: "markdown",
          promptTemplate: "Summarize {{anchorText}}",
          declaredVariables: [{ name: "anchorText", source: "anchorText" }]
        })
        .expect(201)
    ).body.operation;
    expect(created.id).toMatch(/^op_/);
    expect(created.source).toBe("custom");
    expect(created.scope).toBe("anchor");

    const list = await request(app).get("/api/operations").expect(200);
    expect(list.body.operations.map((o: { id: string }) => o.id)).toContain(created.id);

    const updated = (
      await request(app).patch(`/api/operations/${created.id}`).send({ name: "Summarize+" }).expect(200)
    ).body.operation;
    expect(updated.name).toBe("Summarize+");
    expect(updated.promptTemplate).toBe("Summarize {{anchorText}}");

    await request(app).delete(`/api/operations/${created.id}`).expect(200);
    await request(app).delete(`/api/operations/${created.id}`).expect(404);
    await request(app).patch(`/api/operations/${created.id}`).send({ name: "x" }).expect(404);
  });

  it("un-pins a simple op's output type via PATCH null (revert to AUTO)", async () => {
    const created = (
      await request(app)
        .post("/api/operations")
        .send({ name: "Explain", mode: "simple", instruction: "解释这段", outputContentType: "markdown" })
        .expect(201)
    ).body.operation;
    expect(created.outputContentType).toBe("markdown");

    // null = explicit un-pin → the stored record drops the type (AUTO).
    const unpinned = (
      await request(app).patch(`/api/operations/${created.id}`).send({ outputContentType: null }).expect(200)
    ).body.operation;
    expect(unpinned.outputContentType).toBeUndefined();

    // The un-pin is durable, not just in the response.
    const reloaded = (await request(app).get("/api/operations").expect(200)).body.operations.find(
      (o: { id: string }) => o.id === created.id
    );
    expect(reloaded.outputContentType).toBeUndefined();

    // Re-pin still works (string overwrites).
    const repinned = (
      await request(app).patch(`/api/operations/${created.id}`).send({ outputContentType: "flashcard" }).expect(200)
    ).body.operation;
    expect(repinned.outputContentType).toBe("flashcard");
  });

  it("rejects un-pinning a TEMPLATE op's output type (template mode requires a pin)", async () => {
    const created = (
      await request(app)
        .post("/api/operations")
        .send({ name: "T", outputContentType: "markdown", promptTemplate: "Do {{anchorText}}", declaredVariables: [{ name: "anchorText", source: "anchorText" }] })
        .expect(201)
    ).body.operation;
    await request(app).patch(`/api/operations/${created.id}`).send({ outputContentType: null }).expect(400);
  });

  it("rejects an operation whose required literal variable has no default", async () => {
    await request(app)
      .post("/api/operations")
      .send({
        name: "Bad",
        outputContentType: "markdown",
        promptTemplate: "do {{x}}",
        declaredVariables: [{ name: "x", source: "literal", required: true }]
      })
      .expect(400);
  });

  it("returns default operation prefs and round-trips a saved set", async () => {
    const empty = await request(app).get("/api/operation-prefs").expect(200);
    expect(empty.body.prefs).toEqual({ order: [], disabled: [], params: {}, surfaces: {}, icons: {} });

    const prefs = {
      order: ["textbook.explain-concept", "op_1"],
      disabled: ["op_1"],
      params: { "textbook.explain-concept": { grade: "Grade 6" } }
    };
    await request(app).put("/api/operation-prefs").send(prefs).expect(200);

    const reloaded = await request(app).get("/api/operation-prefs").expect(200);
    expect(reloaded.body.prefs.order).toEqual(prefs.order);
    expect(reloaded.body.prefs.disabled).toEqual(["op_1"]);
    expect(reloaded.body.prefs.params["textbook.explain-concept"].grade).toBe("Grade 6");

    // Structurally invalid prefs are rejected.
    await request(app).put("/api/operation-prefs").send({ order: "nope" }).expect(400);
  });

  it("returns default plugin prefs and round-trips a saved set", async () => {
    const empty = await request(app).get("/api/plugin-prefs").expect(200);
    expect(empty.body.prefs).toEqual({
      disabledContributions: [],
      viewerAssociations: { byContentType: {}, byNoteId: {} },
      userKits: [],
      // M1 back-compat default (plugin-viewer-model §8.3): null = the default-installed
      // set — an untouched vault behaves byte-for-byte as before the market existed.
      catalogState: { installedPlugins: null, installedKits: null }
    });

    const prefs = {
      disabledContributions: ["textbook-learning:surface:textbook.explain-concept"],
      viewerAssociations: { byContentType: { markdown: "some-viewer" }, byNoteId: {} },
      userKits: []
    };
    await request(app).put("/api/plugin-prefs").send(prefs).expect(200);

    const reloaded = await request(app).get("/api/plugin-prefs").expect(200);
    expect(reloaded.body.prefs.disabledContributions).toEqual(prefs.disabledContributions);
    expect(reloaded.body.prefs.viewerAssociations.byContentType.markdown).toBe("some-viewer");
    expect(reloaded.body.prefs.userKits).toEqual([]);

    // Structurally invalid prefs are rejected.
    await request(app).put("/api/plugin-prefs").send({ disabledContributions: "nope" }).expect(400);
  });

  it("M1 install state: the /catalog PUT owns catalogState; the legacy PUT can never clobber it", async () => {
    // The market's write seam: PUT /api/plugin-prefs/catalog (catalogState + userKits).
    const catalogState = { installedPlugins: ["flashcard"], installedKits: ["textbook-learning"] };
    const saved = await request(app).put("/api/plugin-prefs/catalog").send({ catalogState }).expect(200);
    expect(saved.body.prefs.catalogState).toEqual(catalogState);

    // Single-writer-per-field-group: a FULL legacy PUT (the workspace seams' stale
    // React-state body — pinViewer/setContributionEnabled) carries a different (or
    // missing) catalogState; the server preserves the STORED market fields.
    await request(app)
      .put("/api/plugin-prefs")
      .send({
        disabledContributions: ["x:surface:y"],
        viewerAssociations: { byContentType: {}, byNoteId: {} },
        userKits: [],
        catalogState: { installedPlugins: null, installedKits: null } // stale — must be ignored
      })
      .expect(200);

    const reloaded = await request(app).get("/api/plugin-prefs").expect(200);
    expect(reloaded.body.prefs.disabledContributions).toEqual(["x:surface:y"]); // panel write applied
    expect(reloaded.body.prefs.catalogState).toEqual(catalogState); // market state preserved

    // And the catalog PUT preserves the stored panel fields + validates its body.
    const next = { installedPlugins: [], installedKits: [] };
    await request(app).put("/api/plugin-prefs/catalog").send({ catalogState: next }).expect(200);
    const merged = await request(app).get("/api/plugin-prefs").expect(200);
    expect(merged.body.prefs.disabledContributions).toEqual(["x:surface:y"]);
    expect(merged.body.prefs.catalogState).toEqual(next);
    await request(app)
      .put("/api/plugin-prefs/catalog")
      .send({ catalogState: { installedPlugins: "nope" } })
      .expect(400);

    // Typed userKits (§8.3) round-trip through the catalog seam.
    const userKits = [{ id: "user:exam-prep", name: "Exam Prep", description: "", members: ["quiz"] }];
    await request(app).put("/api/plugin-prefs/catalog").send({ catalogState: next, userKits }).expect(200);
    const withKits = await request(app).get("/api/plugin-prefs").expect(200);
    expect(withKits.body.prefs.userKits).toEqual(userKits);
  });

  it("FLAT migration: a pre-FLAT per-plugin install state collapses to kits on first load (write-back, idempotent)", async () => {
    // Persist a LEGACY state (an old vault that installed 数学 Kit as a separate kit).
    const legacy = { installedPlugins: [], installedKits: ["subject-math"] };
    await request(app).put("/api/plugin-prefs/catalog").send({ catalogState: legacy }).expect(200);

    // First GET migrates + writes back: the subject kit maps onto the Textbook Kit
    // with ONLY its evidenced groups enabled; the shared quiz ref survives as a
    // direct hold (zero loss — effective-installed parity).
    const migrated = (await request(app).get("/api/plugin-prefs").expect(200)).body.prefs.catalogState;
    expect(migrated.installedKits).toEqual(["textbook-learning"]);
    expect(migrated.installedPlugins).toEqual(["quiz"]);
    expect(migrated.disabledGroups["textbook-learning"]).toEqual([
      "explanation",
      "practice",
      "review-pack",
      "textbook-language",
      "subject-english",
      "subject-history-geo",
      // M-C 语文/理化生 groups start disabled — no legacy state enabled them.
      "subject-chinese",
      "subject-science"
    ]);

    // Idempotent: a second load returns the identical, already-flat state.
    const again = (await request(app).get("/api/plugin-prefs").expect(200)).body.prefs.catalogState;
    expect(again).toEqual(migrated);
  });

  it("generates structured content for a stored op_ promptId and for a built-in", async () => {
    const op = (
      await request(app)
        .post("/api/operations")
        .send({
          name: "MD",
          outputContentType: "markdown",
          promptTemplate: "Write notes on {{anchorText}}",
          declaredVariables: [{ name: "anchorText", source: "anchorText" }]
        })
        .expect(201)
    ).body.operation;

    // A data op has no mockContent → the mock echoes the spec's createDefault ("").
    const viaOp = await request(app)
      .post("/api/kits/generate")
      .send({ promptId: op.id, contentType: "markdown", input: { anchorText: "tides" } })
      .expect(200);
    expect(viaOp.body.content).toBe("");
    expect(viaOp.body.provider).toBe("mock");

    // Output type guard still fires for an op whose outputContentType differs.
    await request(app).post("/api/kits/generate").send({ promptId: op.id, contentType: "quiz" }).expect(400);

    // Built-in prompts keep working unchanged.
    const builtin = await request(app)
      .post("/api/kits/generate")
      .send({
        promptId: "textbook.explain-concept",
        contentType: "textbook.explanation",
        input: { anchorText: "Photosynthesis converts light into energy." }
      })
      .expect(200);
    expect(builtin.body.content.title).toContain("Explaining");

    // An unknown promptId is still a 400.
    await request(app).post("/api/kits/generate").send({ promptId: "op_missing", contentType: "markdown" }).expect(400);
  });

  it("creates and runs a SIMPLE-mode operation end-to-end (ACTION-2a: auto output form)", async () => {
    // 一句话新增: two fields — name + instruction. No template, no output picker.
    const op = (
      await request(app)
        .post("/api/operations")
        .send({ name: "苏格拉底提问", mode: "simple", instruction: "用苏格拉底式追问考我选中的内容,一次只问一个问题" })
        .expect(201)
    ).body.operation;
    expect(op.id).toMatch(/^op_/);
    expect(op.mode).toBe("simple");
    expect(op.promptTemplate).toBeUndefined();
    expect(op.outputContentType).toBeUndefined();

    // 试一下 rides the SAME generate route — contentType omitted, the adaptive-note
    // form router decides (mock: the deterministic first member = a markdown note),
    // and the response names the routed contentType so preview/save can trust it.
    const run = await request(app)
      .post("/api/kits/generate")
      .send({ promptId: op.id, input: { anchorText: "浮力等于排开液体的重力" } })
      .expect(200);
    expect(run.body.contentType).toBe("markdown");
    expect(run.body.content).toBe("");
    expect(run.body.provider).toBe("mock");

    // Simple mode requires the instruction (zod is the single source of truth).
    await request(app).post("/api/operations").send({ name: "x", mode: "simple" }).expect(400);
    // Template mode still requires template + output type.
    await request(app).post("/api/operations").send({ name: "x", mode: "template", promptTemplate: "t" }).expect(400);
  });

  it("merges built-in placeholder params from operation-prefs into generate input", async () => {
    await request(app)
      .put("/api/operation-prefs")
      .send({
        order: [],
        disabled: [],
        params: { "textbook.explain-concept": { grade: "Grade 6", subject: "Biology" } }
      })
      .expect(200);

    // The merge happens server-side before build(); the mock ignores the rendered
    // body, so we assert the run succeeds (wiring) rather than the prompt text.
    const res = await request(app)
      .post("/api/kits/generate")
      .send({
        promptId: "textbook.explain-concept",
        contentType: "textbook.explanation",
        input: { anchorText: "Cells are the basic unit of life." }
      })
      .expect(200);
    expect(res.body.content.title).toBeTruthy();
  });

  it("rejects an invalid patch status transition", async () => {
    const source = (
      await request(app).post("/api/sources/html").send({ title: "Render Thread", content: fixtureHtmlBody }).expect(201)
    ).body.source;
    const anchor = (
      await request(app)
        .post("/api/anchors")
        .send({ sourceId: source.id, studyId: "p-render-thread", quote: "Render Thread submits rendering commands." })
        .expect(201)
    ).body.anchor;
    const patch = (
      await request(app)
        .post("/api/patches")
        .send({
          sourceId: source.id,
          anchorId: anchor.id,
          action: "replace_selection",
          oldText: "Render Thread submits rendering commands.",
          newContent: '<p data-study-id="p-render-thread">Updated.</p>'
        })
        .expect(201)
    ).body.patch;

    // pending → reverted is not a legal transition
    const response = await request(app).patch(`/api/patches/${patch.id}`).send({ status: "reverted" }).expect(409);
    expect(response.body.error).toContain("Invalid patch transition");
  });
});

// FIX 1 — the form router must NEVER persist a FILE PATH as html. An agentic provider
// (claude-cli) writes a file and returns its path; the html arm's looksLikeHtml refine
// rejects it on every attempt → the structured re-prompt loop exhausts → runFormRouter
// DEGRADES to a markdown note carrying the original text. These tests inject a provider
// to drive that path (the default mock can't, since it echoes a sample verbatim).
describe("form router — html path result degrades, never saved as html", () => {
  // A provider that ALWAYS returns a path-like html arm (the bug's exact shape). It
  // ignores the re-prompt corrective turns, so the refine fails on every attempt.
  const PATH_RESULT = JSON.stringify({ form: "html-interactive", html: "generated/x.html" });
  const pathProvider = {
    id: "path-writer",
    capabilities: {
      chat: true,
      agentic: true,
      streaming: false,
      structured: true,
      tools: false,
      kind: "cli-agent" as const
    },
    async complete() {
      return { message: { role: "assistant" as const, content: PATH_RESULT } };
    },
    async completeStructured() {
      return { json: PATH_RESULT };
    }
  };

  it("generate-block degrades a path-like html result to a markdown note (text preserved)", async () => {
    const degradeApp = createApp({ vault, modelProvider: pathProvider });
    const res = await request(degradeApp)
      .post("/api/notes/generate-block")
      .send({ text: "Build me an interactive hectares game" })
      .expect(200);
    // NEVER html-sandbox with a path; it falls back to markdown carrying the input text.
    expect(res.body.contentType).toBe("markdown");
    expect(res.body.contentType).not.toBe("html-sandbox");
    expect(res.body.content).toBe("Build me an interactive hectares game");
    // The path string must NOT appear anywhere in the persisted content.
    expect(JSON.stringify(res.body.content)).not.toContain("generated/x.html");
  });

  it("a valid inline html result IS routed to html-sandbox (interactive)", async () => {
    const goodHtml = JSON.stringify({ form: "html-interactive", html: "<canvas></canvas>" });
    const okProvider = {
      id: "inline-html",
      capabilities: {
        chat: true,
        agentic: false,
        streaming: false,
        structured: true,
        tools: false,
        kind: "mock" as const
      },
      async complete() {
        return { message: { role: "assistant" as const, content: goodHtml } };
      },
      async completeStructured() {
        return { json: goodHtml };
      }
    };
    const okApp = createApp({ vault, modelProvider: okProvider });
    const res = await request(okApp)
      .post("/api/notes/generate-block")
      .send({ text: "a widget" })
      .expect(200);
    expect(res.body.contentType).toBe("html-sandbox");
    expect((res.body.content as { html: string }).html).toBe("<canvas></canvas>");
    expect((res.body.content as { interactive: boolean }).interactive).toBe(true);
  });
});

describe("operation prefs — per-surface (R6.3)", () => {
  it("round-trips the new `surfaces` shape through PUT then GET", async () => {
    const prefs = {
      order: ["bookmark.add", "op_x"],
      disabled: ["op_y"],
      params: { "textbook.explain-concept": { grade: "5" } },
      surfaces: {
        inline: { order: ["bookmark.add"], hidden: ["op_x"] },
        anchor: { order: ["op_x", "bookmark.add"], hidden: [] }
      },
      icons: {}
    };
    const put = await request(app).put("/api/operation-prefs").send(prefs).expect(200);
    expect(put.body.prefs.surfaces.inline).toEqual({ order: ["bookmark.add"], hidden: ["op_x"] });
    expect(put.body.prefs.surfaces.anchor).toEqual({ order: ["op_x", "bookmark.add"], hidden: [] });

    const get = await request(app).get("/api/operation-prefs").expect(200);
    expect(get.body.prefs).toEqual(prefs);
  });

  it("round-trips the new `icons` map through PUT then GET, and old-shape (no `icons`) still parses", async () => {
    // PUT a prefs set carrying the new top-level `icons` map (action id → glyph NAME).
    const prefs = {
      order: ["bookmark.add", "op_x"],
      disabled: [],
      params: {},
      surfaces: {},
      icons: { "bookmark.add": "star", op_x: "highlighter" }
    };
    const put = await request(app).put("/api/operation-prefs").send(prefs).expect(200);
    expect(put.body.prefs.icons).toEqual({ "bookmark.add": "star", op_x: "highlighter" });

    const get = await request(app).get("/api/operation-prefs").expect(200);
    expect(get.body.prefs).toEqual(prefs);

    // OLD-shape prefs (no `icons` key) still parse and default `icons` to {} — additive,
    // no migration. Write the pre-icons shape straight to the vault and reload.
    const prefsPath = path.join(vault.paths.studyDir, "operation-prefs.json");
    await writeFile(
      prefsPath,
      `${JSON.stringify({ order: ["a"], disabled: [], params: {}, surfaces: {} }, null, 2)}\n`,
      "utf8"
    );
    const reloaded = await request(app).get("/api/operation-prefs").expect(200);
    expect(reloaded.body.prefs.order).toEqual(["a"]);
    expect(reloaded.body.prefs.icons).toEqual({});
  });

  it("parses OLD-shape prefs (no `surfaces`) and defaults it to {}", async () => {
    // Write a prefs file in the PRE-R6.3 shape (no `surfaces` key) straight to the vault,
    // proving an existing vault keeps loading after the schema change (no migration).
    const prefsPath = path.join(vault.paths.studyDir, "operation-prefs.json");
    await writeFile(
      prefsPath,
      `${JSON.stringify({ order: ["a", "b"], disabled: ["c"], params: { p: { grade: "5" } } }, null, 2)}\n`,
      "utf8"
    );
    const get = await request(app).get("/api/operation-prefs").expect(200);
    expect(get.body.prefs.order).toEqual(["a", "b"]);
    expect(get.body.prefs.disabled).toEqual(["c"]);
    expect(get.body.prefs.params).toEqual({ p: { grade: "5" } });
    expect(get.body.prefs.surfaces).toEqual({});
  });
});

