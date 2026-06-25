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

