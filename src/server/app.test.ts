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
          anchorId: anchor.id,
          noteKind: "annotation",
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

    expect(note.anchorId).toBe(anchor.id);
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

  it("rejects an empty chat request", async () => {
    await request(app).post("/api/chat").send({ messages: [] }).expect(400);
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

