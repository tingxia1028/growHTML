import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type StudyVault } from "../core/vault";
import { openTestVault } from "../core/testing/openTestVault";
import { createApp } from "./app";

let vaultDir = "";
let workDir = ""; // where the "local files" the user opens live
let vault: StudyVault;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  vaultDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-lf-"));
  workDir = await mkdtemp(path.join(os.tmpdir(), "study-files-"));
  vault = await openTestVault({ rootDir: vaultDir });
  app = createApp({ vault });
});

afterEach(async () => {
  vault?.close(); // STORE-SQL Stage-3: release sqlite .db handles before rm (Windows EBUSY). no-op on jsonl.
  await rm(vaultDir, { recursive: true, force: true });
  await rm(workDir, { recursive: true, force: true });
});

// Mirror the client's localFileUrl(): mirror the absolute path into the URL,
// encoding each segment.
function localUrl(absPath: string): string {
  const encoded = absPath
    .replace(/\\/g, "/")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return `/api/local/${encoded}`;
}

async function makeFile(name: string, content: string | Buffer): Promise<string> {
  const filePath = path.join(workDir, name);
  await writeFile(filePath, content);
  return filePath;
}

describe("local file ingest", () => {
  it("ingests a text/code file as a 'code' source carrying its original path", async () => {
    const filePath = await makeFile("notes.ts", "export const x = 1;\n");

    const res = await request(app).post("/api/sources/local-file").send({ path: filePath }).expect(201);

    expect(res.body.source.sourceType).toBe("code");
    expect(res.body.source.title).toBe("notes");
    expect(res.body.source.metadata.originalPath).toBe(path.resolve(filePath));
  });

  it("ingests a local HTML file as an 'html' source with its original path", async () => {
    const filePath = await makeFile("page.html", "<h1>Hi</h1>");

    const res = await request(app).post("/api/sources/local-file").send({ path: filePath }).expect(201);

    expect(res.body.source.sourceType).toBe("html");
    expect(res.body.source.metadata.originalPath).toBe(path.resolve(filePath));
  });

  it("detects images by extension and PDFs by extension", async () => {
    const png = await makeFile("pic.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
    const pdf = await makeFile("doc.pdf", Buffer.from("%PDF-1.7\n..."));

    const pngRes = await request(app).post("/api/sources/local-file").send({ path: png }).expect(201);
    const pdfRes = await request(app).post("/api/sources/local-file").send({ path: pdf }).expect(201);

    expect(pngRes.body.source.sourceType).toBe("image");
    expect(pdfRes.body.source.sourceType).toBe("pdf");
  });

  it("dedupes: opening the same file twice reuses the same source", async () => {
    const filePath = await makeFile("again.md", "# Title");

    const first = await request(app).post("/api/sources/local-file").send({ path: filePath }).expect(201);
    const second = await request(app).post("/api/sources/local-file").send({ path: filePath }).expect(201);

    expect(second.body.source.id).toBe(first.body.source.id);

    const list = await request(app).get("/api/sources").expect(200);
    expect(list.body.sources).toHaveLength(1);
  });
});

describe("directory listing", () => {
  it("lists a folder's children, directories first", async () => {
    await makeFile("b-file.txt", "x");
    await makeFile("a-file.txt", "y");
    await mkdir(path.join(workDir, "sub"));

    const res = await request(app).get("/api/fs/list").query({ path: workDir }).expect(200);

    const names = res.body.entries.map((entry: { name: string }) => entry.name);
    expect(names).toContain("sub");
    expect(names).toContain("a-file.txt");
    // Folder sorts before files.
    expect(names.indexOf("sub")).toBeLessThan(names.indexOf("a-file.txt"));
    expect(res.body.entries.find((e: { name: string }) => e.name === "sub").isDir).toBe(true);
  });
});

describe("raw local file serving", () => {
  it("serves a local file with the right content-type and open CORS", async () => {
    const filePath = await makeFile("style.css", "body{color:red}");

    const res = await request(app).get(localUrl(path.resolve(filePath))).expect(200);

    expect(res.headers["content-type"]).toContain("text/css");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.text).toContain("color:red");
  });
});

describe("deleting a source", () => {
  it("removes the source and cascades its notes", async () => {
    const filePath = await makeFile("doomed.txt", "bye");
    const source = (await request(app).post("/api/sources/local-file").send({ path: filePath }).expect(201)).body
      .source;

    await request(app).post("/api/notes").send({ sourceId: source.id, content: "a note" }).expect(201);

    await request(app).delete(`/api/sources/${source.id}`).expect(200);

    const list = await request(app).get("/api/sources").expect(200);
    expect(list.body.sources).toHaveLength(0);

    const notes = await request(app).get(`/api/sources/${source.id}/notes`).expect(200);
    expect(notes.body.notes).toHaveLength(0);
  });

  it("returns 404 when deleting a source that does not exist", async () => {
    await request(app).delete("/api/sources/src_doesnotexist").expect(404);
  });
});
