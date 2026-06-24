import path from "node:path";
import { createEntityId } from "../ids";
import { sha256Hex } from "../storage/sha256";
import { assertSafeRelativePath } from "../storage/paths";
import { sourceSchema, type CreatedBy, type SourceRecord, type SourceType } from "../schema";
import type { StudyVault } from "../vault";

export type IngestSourceInput = {
  title: string;
  content: string;
  sourceType: Extract<SourceType, "html" | "webpage" | "markdown" | "web_live" | "code" | "transcript">;
  mimeType?: string;
  metadata?: Record<string, unknown>;
  createdBy?: CreatedBy;
  createdAt?: string;
};

export type IngestBinarySourceInput = {
  title: string;
  data: Buffer;
  sourceType: Extract<SourceType, "pdf" | "image" | "word">;
  mimeType?: string;
  metadata?: Record<string, unknown>;
  createdBy?: CreatedBy;
  createdAt?: string;
};

export function computeContentHash(content: string) {
  return `sha256:${sha256Hex(new TextEncoder().encode(content))}`;
}

export function computeBufferHash(data: Buffer) {
  return `sha256:${sha256Hex(data)}`;
}

const DEFAULT_BINARY_MIME: Record<IngestBinarySourceInput["sourceType"], string> = {
  pdf: "application/pdf",
  image: "application/octet-stream",
  word: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
};

export function slugifySourceTitle(title: string, fallback = "source") {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);

  return slug || fallback;
}

function getExtension(sourceType: SourceType) {
  if (sourceType === "html" || sourceType === "webpage") return "html";
  if (sourceType === "markdown") return "md";
  if (sourceType === "web_live") return "url";
  if (sourceType === "pdf") return "pdf";
  if (sourceType === "word") return "docx";
  if (sourceType === "image") return "bin";
  return "txt";
}

export async function ingestSource(vault: StudyVault, input: IngestSourceInput): Promise<SourceRecord> {
  const id = createEntityId("source");
  const now = input.createdAt ?? new Date().toISOString();
  const extension = getExtension(input.sourceType);
  const fileName = `${slugifySourceTitle(input.title)}-${id.slice("src_".length)}.${extension}`;
  const relativePath = path.posix.join("sources", fileName);
  const filePath = path.join(vault.paths.sourcesDir, fileName);

  await vault.storage.writeText(filePath, input.content);

  const record = sourceSchema.parse({
    id,
    type: "source",
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy ?? "user",
    sourceType: input.sourceType,
    title: input.title,
    path: relativePath,
    mimeType: input.mimeType ?? (input.sourceType === "html" ? "text/html" : undefined),
    contentHash: computeContentHash(input.content),
    metadata: input.metadata ?? {}
  });

  await vault.stores.sources.upsert(record);
  return record;
}

export async function ingestBinarySource(
  vault: StudyVault,
  input: IngestBinarySourceInput
): Promise<SourceRecord> {
  const id = createEntityId("source");
  const now = input.createdAt ?? new Date().toISOString();
  const extension = getExtension(input.sourceType);
  const fileName = `${slugifySourceTitle(input.title)}-${id.slice("src_".length)}.${extension}`;
  const relativePath = path.posix.join("sources", fileName);
  const filePath = path.join(vault.paths.sourcesDir, fileName);

  await vault.storage.writeBytes(filePath, input.data);

  const record = sourceSchema.parse({
    id,
    type: "source",
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy ?? "user",
    sourceType: input.sourceType,
    title: input.title,
    path: relativePath,
    mimeType: input.mimeType ?? DEFAULT_BINARY_MIME[input.sourceType],
    contentHash: computeBufferHash(input.data),
    metadata: input.metadata ?? {}
  });

  await vault.stores.sources.upsert(record);
  return record;
}

export async function ingestHtmlSource(
  vault: StudyVault,
  input: Omit<IngestSourceInput, "sourceType" | "mimeType"> & { mimeType?: string }
) {
  return ingestSource(vault, {
    ...input,
    sourceType: "html",
    mimeType: input.mimeType ?? "text/html"
  });
}

export async function listSources(vault: StudyVault) {
  return vault.stores.sources.list();
}

/**
 * Delete a source: its stored file, the record itself, and the anchors / notes /
 * patches that hang off it (so nothing is orphaned). Returns false if not found.
 */
export async function deleteSource(vault: StudyVault, id: string): Promise<boolean> {
  const source = await vault.stores.sources.get(id);
  if (!source) return false;

  try {
    await vault.storage.deleteFile(resolveSourcePath(vault, source));
  } catch {
    // Missing/locked file shouldn't block removing the record from the list.
  }

  for (const store of [vault.stores.anchors, vault.stores.notes, vault.stores.patches]) {
    const related = (await store.list()).filter((item) => item.sourceId === id);
    for (const item of related) await store.delete(item.id);
  }

  await vault.stores.sources.delete(id);
  return true;
}

function resolveSourcePath(vault: StudyVault, source: SourceRecord) {
  // Pure traversal guard (portable across storage backends), then compose.
  assertSafeRelativePath(source.path);
  return path.join(vault.paths.rootDir, source.path);
}

export async function readSourceContent(vault: StudyVault, source: SourceRecord) {
  const text = await vault.storage.readText(resolveSourcePath(vault, source));
  if (text === null) throw new Error(`Source content not found: ${source.path}`);
  return text;
}

export async function readSourceFile(vault: StudyVault, source: SourceRecord) {
  const bytes = await vault.storage.readBytes(resolveSourcePath(vault, source));
  if (bytes === null) throw new Error(`Source file not found: ${source.path}`);
  return Buffer.from(bytes);
}

