import fs from "node:fs/promises";
import path from "node:path";
import { ingestBinarySource, ingestSource } from "../core/store/sources";
import type { SourceRecord } from "../core/schema";
import type { StudyVault } from "../core/vault";

// Desktop-only: the renderer hands us absolute paths chosen via native dialogs,
// and the server (same machine as the app) reads them straight off disk. There's
// no untrusted remote caller here, so we don't sandbox to a root — the user picked
// the path. We still resolve() to normalize separators.

export type DirEntry = { name: string; path: string; isDir: boolean };

export type DirListing = {
  path: string;
  parent: string | null;
  entries: DirEntry[];
};

export async function listDirectory(dirPath: string): Promise<DirListing> {
  const resolved = path.resolve(dirPath);
  const dirents = await fs.readdir(resolved, { withFileTypes: true });
  const entries: DirEntry[] = dirents
    .map((dirent) => ({
      name: dirent.name,
      path: path.join(resolved, dirent.name),
      isDir: dirent.isDirectory()
    }))
    // Folders first, then alphabetical — the familiar file-explorer ordering.
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));

  const parent = path.dirname(resolved);
  return { path: resolved, parent: parent === resolved ? null : parent, entries };
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico", ".avif"]);
const WORD_EXTS = new Set([".docx", ".doc"]);
const HTML_EXTS = new Set([".html", ".htm"]);

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".avif": "image/avif"
};

// Content types for the raw local-file route (so a tutorial's own CSS/JS/fonts
// load with the right type when served from its original directory).
const EXTRA_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8"
};

export function mimeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_MIME[ext] ?? EXTRA_MIME[ext] ?? "application/octet-stream";
}

// Heuristic: a NUL byte in the first chunk means binary. Good enough to tell code
// and text files apart from images/executables without sniffing every encoding.
function looksTextual(data: Buffer): boolean {
  return !data.subarray(0, 8192).includes(0);
}

function titleFromPath(filePath: string): string {
  const base = path.basename(filePath);
  return base.replace(/\.[^.]+$/, "") || base;
}

/**
 * Read a local file off disk and ingest it as a source, picking the storage and
 * viewer pipeline from its type:
 *  - PDF  → binary, PDF.js reader (annotatable)
 *  - HTML → text + study-ids, HTML study pipeline (annotatable)
 *  - image / word / unknown-binary → binary, generic file viewer
 *  - anything textual (code, md, txt, json, csv, …) → text, generic file viewer
 */
// Coalesce concurrent opens of the SAME path. The dedupe below is check-then-create
// (list() → not found → upsert), which is NOT atomic: two rapid opens (a double-click,
// or a StrictMode double-invoked effect in dev) both pass the existence check before
// either upserts, piling up duplicate sources for one file. Keyed by resolved path, the
// second concurrent caller awaits the first's promise instead of re-ingesting.
const inFlightIngest = new Map<string, Promise<SourceRecord>>();

export function ingestLocalFile(vault: StudyVault, filePath: string): Promise<SourceRecord> {
  const resolved = path.resolve(filePath);
  const pending = inFlightIngest.get(resolved);
  if (pending) return pending;
  const run = ingestLocalFileInner(vault, resolved);
  inFlightIngest.set(resolved, run);
  return run.finally(() => inFlightIngest.delete(resolved));
}

async function ingestLocalFileInner(vault: StudyVault, resolved: string): Promise<SourceRecord> {
  // Opening the same file again should reuse its existing source, not pile up
  // duplicate entries in the sidebar.
  const existing = (await vault.stores.sources.list()).find(
    (source) => source.metadata?.originalPath === resolved
  );
  if (existing) return existing;

  const data = await fs.readFile(resolved);
  const ext = path.extname(resolved).toLowerCase();
  const title = titleFromPath(resolved);
  const metadata = { originalPath: resolved };

  if (ext === ".pdf" || data.subarray(0, 5).toString("latin1").startsWith("%PDF-")) {
    return ingestBinarySource(vault, { title, data, sourceType: "pdf", createdBy: "user", metadata });
  }

  if (IMAGE_EXTS.has(ext)) {
    return ingestBinarySource(vault, {
      title,
      data,
      sourceType: "image",
      mimeType: IMAGE_MIME[ext],
      createdBy: "user",
      metadata
    });
  }

  if (WORD_EXTS.has(ext)) {
    return ingestBinarySource(vault, { title, data, sourceType: "word", createdBy: "user", metadata });
  }

  if (HTML_EXTS.has(ext)) {
    // Stored raw (no study-id injection): local HTML is rendered straight from its
    // original directory via /api/local so its relative assets/styles resolve, not
    // from this vault copy. We keep the copy only as a record of the content.
    return ingestSource(vault, {
      title,
      content: data.toString("utf8"),
      sourceType: "html",
      mimeType: "text/html",
      createdBy: "user",
      metadata
    });
  }

  if (looksTextual(data)) {
    return ingestSource(vault, {
      title,
      content: data.toString("utf8"),
      sourceType: "code",
      mimeType: "text/plain; charset=utf-8",
      createdBy: "user",
      metadata
    });
  }

  // Unknown binary — store the bytes and let the browser viewer decide what it can
  // do with them (render or offer a download).
  return ingestBinarySource(vault, {
    title,
    data,
    sourceType: "image",
    mimeType: "application/octet-stream",
    createdBy: "user",
    metadata
  });
}
