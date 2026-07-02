// Sources domain services (X0 shared-core extraction, multi-platform.md §1-X0(1)).
// Each function is transport-agnostic: (deps, parsed input) → plain data, throwing
// typed errors from ./errors. The Express routes in app.ts are thin wrappers; the
// mobile direct-call adapter (X0b) will call these functions with the same inputs.
// Routes whose bodies were already one-liners over core (list/delete/url/web-live/
// local-file ingest) intentionally have NO service here — core is the seam for those.
import { z } from "zod";
import { injectStudyIds, materializeHtml } from "../../adapters/html/core";
import { sourceSchema, type HtmlSelectionAnchor, type SourceRecord } from "../../core/schema";
import { ingestBinarySource, ingestHtmlSource, readSourceContent, readSourceFile } from "../../core/store/sources";
import type { StudyVault } from "../../core/vault";
import { NotFoundError, ValidationError } from "./errors";

export type SourcesDeps = { vault: StudyVault };

export const ingestHtmlRequestSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1)
});
export type IngestHtmlInput = z.infer<typeof ingestHtmlRequestSchema>;

export const ingestPdfRequestSchema = z.object({
  title: z.string().min(1),
  dataBase64: z.string().min(1),
  // Absolute disk path of the picked file (desktop only), so the AI terminal can
  // default its working directory to the folder this file lives in.
  originalPath: z.string().min(1).optional()
});
export type IngestPdfInput = z.infer<typeof ingestPdfRequestSchema>;

export const ingestImageRequestSchema = z.object({
  title: z.string().min(1),
  dataBase64: z.string().min(1),
  mimeType: z.string().min(1).default("image/png"),
  originalPath: z.string().min(1).optional()
});
export type IngestImageInput = z.infer<typeof ingestImageRequestSchema>;

// Merge-patch a source's metadata. Used by per-source Product Kit activation
// (metadata.activeKitIds) — a generic metadata merge so the kit seam never needs
// a core schema change. Only metadata is mutable here; identity fields are fixed.
export const updateSourceRequestSchema = z.object({ metadata: z.record(z.string(), z.unknown()) });
export type UpdateSourceInput = z.infer<typeof updateSourceRequestSchema>;

/** Ingest pasted/imported HTML: inject stable study ids, persist as an html source. */
export async function ingestHtml({ vault }: SourcesDeps, input: IngestHtmlInput) {
  const injected = injectStudyIds(input.content, { idPrefix: "html" });
  const source = await ingestHtmlSource(vault, {
    title: input.title,
    content: injected.content,
    createdBy: "user"
  });
  return { source, injected: { added: injected.added, ids: injected.ids } };
}

/** Ingest a PDF from base64 bytes; rejects payloads without the %PDF- magic. */
export async function ingestPdf({ vault }: SourcesDeps, input: IngestPdfInput): Promise<SourceRecord> {
  const data = Buffer.from(input.dataBase64, "base64");
  if (data.length === 0 || !data.subarray(0, 5).toString("latin1").startsWith("%PDF-")) {
    throw new ValidationError("Provided data is not a valid PDF");
  }
  return ingestBinarySource(vault, {
    title: input.title,
    data,
    sourceType: "pdf",
    createdBy: "user",
    metadata: input.originalPath ? { originalPath: input.originalPath } : undefined
  });
}

/**
 * Seed an image source from base64 bytes (used by tests / programmatic import).
 * Images render in the host-page ImageReader so a region can be marked on them.
 */
export async function ingestImage({ vault }: SourcesDeps, input: IngestImageInput): Promise<SourceRecord> {
  const data = Buffer.from(input.dataBase64, "base64");
  if (data.length === 0) {
    throw new ValidationError("Provided image data is empty");
  }
  return ingestBinarySource(vault, {
    title: input.title,
    data,
    sourceType: "image",
    mimeType: input.mimeType,
    createdBy: "user",
    metadata: input.originalPath ? { originalPath: input.originalPath } : undefined
  });
}

/** Merge-patch `metadata` on an existing source (identity fields stay fixed). */
export async function updateSourceMetadata(
  { vault }: SourcesDeps,
  input: { sourceId: string } & UpdateSourceInput
): Promise<SourceRecord> {
  const existing = await vault.stores.sources.get(input.sourceId);
  if (!existing) throw new NotFoundError("Source not found");
  const source = sourceSchema.parse({
    ...existing,
    metadata: { ...existing.metadata, ...input.metadata },
    updatedAt: new Date().toISOString()
  });
  await vault.stores.sources.upsert(source);
  return source;
}

/** Raw stored bytes (used by the PDF reader and any binary source). */
export async function readSourceFileById({ vault }: SourcesDeps, input: { sourceId: string }) {
  const source = await vault.stores.sources.get(input.sourceId);
  if (!source) throw new NotFoundError("Source not found");
  return { source, data: await readSourceFile(vault, source) };
}

/** Stored text content of a source. */
export async function readSourceContentById({ vault }: SourcesDeps, input: { sourceId: string }) {
  const source = await vault.stores.sources.get(input.sourceId);
  if (!source) throw new NotFoundError("Source not found");
  return { source, content: await readSourceContent(vault, source) };
}

/** HTML source materialized with its anchors + applied patches (read model). */
export async function renderSource({ vault }: SourcesDeps, input: { sourceId: string }) {
  const source = await vault.stores.sources.get(input.sourceId);
  if (!source) throw new NotFoundError("Source not found");

  const content = await readSourceContent(vault, source);
  const anchors = await getHtmlAnchorsForSource(vault, source.id);
  const patches = (await vault.stores.patches.list()).filter((patch) => patch.sourceId === source.id);
  const anchorsById = Object.fromEntries(anchors.map((anchor) => [anchor.id, anchor]));
  const rendered = materializeHtml(content, anchorsById, patches);

  return { source, content: rendered.content, results: rendered.results };
}

async function getHtmlAnchorsForSource(vault: StudyVault, sourceId: string) {
  return (await vault.stores.anchors.list()).filter(
    (anchor): anchor is HtmlSelectionAnchor => anchor.sourceId === sourceId && anchor.anchorKind === "html_selection"
  );
}
