// Sources domain services (X0 shared-core extraction, multi-platform.md §1-X0(1)).
// Each function is transport-agnostic: (deps, parsed input) → plain data, throwing
// typed errors from ./errors. The Express routes in app.ts are thin wrappers; the
// mobile direct-call adapter (X0b) will call these functions with the same inputs.
// Routes whose bodies were already one-liners over core (list/delete/url/web-live/
// local-file ingest) intentionally have NO service here — core is the seam for those.
import { z } from "zod";
import { injectStudyIds, materializeHtml } from "../../adapters/html/core";
import { getNoteContentSpec } from "../../core/notes/contentTypes";
import { sourceSchema, type HtmlSelectionAnchor, type SourceRecord } from "../../core/schema";
import { ingestBinarySource, ingestHtmlSource, readSourceContent, readSourceFile } from "../../core/store/sources";
import type { StudyVault } from "../../core/vault";
import type { SealedRuntime } from "../svpack";
import { NotFoundError, ValidationError } from "./errors";
import { listNotes } from "./notes";
import { projectedHtmlForSource } from "./sourceAuthoring";

export type SourcesDeps = { vault: StudyVault };
export type SealedSourcesDeps = { vault: StudyVault; sealed: SealedRuntime };

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

  // Markdown sources store RAW markdown (the SRC-1 editor round-trips it); the reader
  // HTML is derived deterministically (markdown renderer + study-id injection) in
  // projectedHtmlForSource. HTML-ish sources pass through unchanged as before.
  const content = projectedHtmlForSource(source, await readSourceContent(vault, source));
  const anchors = await getHtmlAnchorsForSource(vault, source.id);
  // SRC-3: `applied` patches are now BAKED into the stored content by the apply engine
  // (patches.ts rewrites the source through the SRC-2 pipeline), so re-materializing them
  // here would double-apply. Only non-applied patches are surfaced as skipped read-model
  // rows (the client's patch list still shows every status).
  const patches = (await vault.stores.patches.list()).filter(
    (patch) => patch.sourceId === source.id && patch.status !== "applied"
  );
  const anchorsById = Object.fromEntries(anchors.map((anchor) => [anchor.id, anchor]));
  const rendered = materializeHtml(content, anchorsById, patches);

  return { source, content: rendered.content, results: rendered.results };
}

async function getHtmlAnchorsForSource(vault: StudyVault, sourceId: string) {
  return (await vault.stores.anchors.list()).filter(
    (anchor): anchor is HtmlSelectionAnchor => anchor.sourceId === sourceId && anchor.anchorKind === "html_selection"
  );
}

// —— Attachment bundle (ai-workspace.md §W2) ——————————————————————————————————
// The chat-context bundle for ONE attached source: a bounded body excerpt + its notes
// reduced to text. Consumed by the client's resolveAttachmentBundles → ChatContext
// .sources[], so the caps here are the FIRST line of the token budget (the pure
// resolver adds the cross-source total cap on top, dropping tail excerpts).

/** Per-source excerpt cap — a HEAD slice of the body (W2 token budget). Exported for the test. */
export const BUNDLE_EXCERPT_MAX_CHARS = 4000;
/** Per-source note-count cap — the highest-signal notes ride, the rest are dropped. Exported for the test. */
export const BUNDLE_NOTE_COUNT_CAP = 20;

/** Source types whose stored bytes are BINARY (no text excerpt — title + notes only). */
const BINARY_SOURCE_TYPES = new Set(["pdf", "image", "word"]);

/**
 * Reduce an HTML-ish body to plain text for the excerpt: drop script/style, strip
 * tags, decode the few common entities, collapse whitespace. Pure + cheap (no JSDOM);
 * markdown/plain bodies pass through the same collapse harmlessly. Exported for the test.
 */
export function bundleExcerptText(raw: string): string {
  return raw
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Head-slice an excerpt to the char cap, marking a truncation so the model knows more exists. */
export function truncateExcerpt(text: string, max = BUNDLE_EXCERPT_MAX_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** One attached source's chat-context bundle (mirrors the ai ChatContextSource shape). */
export type SourceBundle = {
  sourceId: string;
  title: string;
  type: string;
  location?: string;
  excerpt?: string;
  notes: { contentType: string; text: string }[];
};

// Where the source lives (URL / file path), for the model's Location line — the same
// precedence the client's buildChatContext uses (sourceUrl/normalizedUrl → originalPath).
function bundleLocation(source: SourceRecord): string | undefined {
  const meta = (source.metadata ?? {}) as Record<string, unknown>;
  const url = (meta.sourceUrl ?? meta.normalizedUrl) as string | undefined;
  const filePath = meta.originalPath as string | undefined;
  return url || filePath || undefined;
}

/**
 * Build the attachment bundle for a source: the (optionally note-carrying) chat context
 * the widened ChatContext.sources[] rides. Notes come through `listNotes` (the shared
 * read-model), then:
 *   • SEALED (protected-import) notes are FILTERED OUT — write-locked content must never
 *     enter a prompt (W2 delta 5). listNotes flags them `sealed: true`.
 *   • surviving notes are reduced to plain text via their spec's toSearchText, capped at
 *     BUNDLE_NOTE_COUNT_CAP;
 * the source body (text-ish sources only) is stripped to text + head-sliced to
 * BUNDLE_EXCERPT_MAX_CHARS. `includeNotes:false` skips the note read entirely.
 */
export async function buildSourceBundle(
  { vault, sealed }: SealedSourcesDeps,
  input: { sourceId: string; includeNotes?: boolean }
): Promise<SourceBundle> {
  const source = await vault.stores.sources.get(input.sourceId);
  if (!source) throw new NotFoundError("Source not found");

  let excerpt: string | undefined;
  if (!BINARY_SOURCE_TYPES.has(source.sourceType)) {
    try {
      const text = bundleExcerptText(await readSourceContent(vault, source));
      excerpt = text ? truncateExcerpt(text) : undefined;
    } catch {
      // A missing/unreadable body must not fail the whole bundle — title + notes still help.
      excerpt = undefined;
    }
  }

  const notes: { contentType: string; text: string }[] = [];
  if (input.includeNotes !== false) {
    const listed = await listNotes({ vault, sealed }, { sourceId: source.id });
    for (const note of listed) {
      // Delta 5: never surface WRITE-LOCKED protected content to the model.
      if ((note as { sealed?: boolean }).sealed) continue;
      if (notes.length >= BUNDLE_NOTE_COUNT_CAP) break;
      const contentType = note.contentType ?? "markdown";
      const spec = getNoteContentSpec(contentType);
      let text = "";
      try {
        text = spec ? spec.toSearchText(note.content).trim() : "";
      } catch {
        text = "";
      }
      if (text) notes.push({ contentType, text });
    }
  }

  return {
    sourceId: source.id,
    title: source.title,
    type: source.sourceType,
    location: bundleLocation(source),
    excerpt,
    notes
  };
}
