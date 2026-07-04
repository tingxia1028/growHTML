import path from "node:path";
import { createEntityId } from "../ids";
import { sha256Hex } from "../storage/sha256";
import { assertSafeRelativePath } from "../storage/paths";
import { sourceSchema, type CreatedBy, type SourceRecord, type SourceType } from "../schema";
import type { StudyVault } from "../vault";
import type { SnapshotStore } from "./snapshotStore";
import { withTombstone } from "./trash";

export type IngestSourceInput = {
  title: string;
  content: string;
  sourceType: Extract<SourceType, "html" | "webpage" | "markdown" | "web_live" | "code" | "transcript">;
  mimeType?: string;
  metadata?: Record<string, unknown>;
  createdBy?: CreatedBy;
  createdAt?: string;
  /** SRC-1: "authored" for documents born in the app (editable body); defaults "imported". */
  origin?: "authored" | "imported";
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
    metadata: input.metadata ?? {},
    origin: input.origin ?? "imported",
    revision: 1
  });

  await vault.stores.sources.upsert(record);
  return record;
}

/**
 * Overwrite a source's stored TEXT content in place (SRC-2 edit pipeline,
 * docs/design/source-authoring.md §3): rewrite the file, re-hash, bump `revision`.
 * This is only the STORAGE half — re-projecting the source's anchors against the
 * new content is the caller's job (src/server/services/sourceAuthoring.ts).
 */
export async function updateStoredSourceContent(
  vault: StudyVault,
  source: SourceRecord,
  content: string,
  opts: { title?: string } = {}
): Promise<SourceRecord> {
  await vault.storage.writeText(resolveSourcePath(vault, source), content);
  const record = sourceSchema.parse({
    ...source,
    title: opts.title ?? source.title,
    contentHash: computeContentHash(content),
    revision: (source.revision ?? 1) + 1,
    updatedAt: new Date().toISOString()
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
 * Delete a source — SOFT (TRUST-3, docs/design/data-trust.md §3): the record and
 * the anchors / notes / patches that hang off it are tombstoned into the recycle
 * bin (cascade-marked `metadata.trash.cascadeOf = sourceId` so restore resurrects
 * exactly this cascade). The stored FILE stays on disk — restore needs it; only
 * an explicit purge (`purgeSourceRecord` via the trash surfaces) removes it.
 * Returns false if the source is not live (absent or already in the bin).
 */
export async function deleteSource(vault: StudyVault, id: string): Promise<boolean> {
  const source = await vault.stores.sources.get(id);
  if (!source) return false;

  const deletedAt = new Date().toISOString();
  await trashLiveDependents(vault.stores.anchors, id, deletedAt);
  await trashLiveDependents(vault.stores.notes, id, deletedAt);
  await trashLiveDependents(vault.stores.patches, id, deletedAt);
  await vault.stores.sources.upsert(withTombstone(source, deletedAt));
  return true;
}

/** Tombstone every LIVE record of `store` hanging off `sourceId`, cascade-marked. */
async function trashLiveDependents<
  T extends { id: string; updatedAt: string; deletedAt?: string; sourceId?: string; metadata: Record<string, unknown> }
>(store: SnapshotStore<T>, sourceId: string, deletedAt: string): Promise<void> {
  const related = (await store.list()).filter((item) => item.sourceId === sourceId);
  for (const item of related) {
    await store.upsert(withTombstone(item, deletedAt, sourceId));
  }
}

/**
 * PURGE a source's stored file off disk (TRUST-3 永久删除 / auto-purge only —
 * a soft delete never touches the file). Best-effort: a missing/locked file
 * shouldn't block removing the records.
 */
export async function deleteStoredSourceFile(vault: StudyVault, source: SourceRecord): Promise<void> {
  try {
    await vault.storage.deleteFile(resolveSourcePath(vault, source));
  } catch {
    // Missing/locked file shouldn't block the purge.
  }
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

