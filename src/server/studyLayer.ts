// Study Layer export / import orchestration. Lives in the server layer (not core)
// because re-realizing imported anchors needs the HTML adapter (DOM study-id lookup)
// — core stays adapter-free. The pure parts (rematch, fingerprint, owned-layer,
// pack schema) live under core/study-layer.

import { createEntityId } from "../core/ids";
import {
  anchorSchema,
  noteSchema,
  studyLayerSchema,
  type AnchorRecord,
  type NoteRecord,
  type SourceRecord,
  type StudyLayerRecord
} from "../core/schema";
import { createHtmlSelectionAnchor } from "../adapters/html/anchor";
import { createWebTextQuoteAnchor } from "../adapters/web/anchor";
import { createPdfSelectionAnchor } from "../adapters/pdf/anchor";
import { createImageRegionAnchor } from "../adapters/image/anchor";
import { parseHtmlDocument } from "../adapters/html/core";
import { readSourceContent } from "../core/store/sources";
import { ensureImportedParent, ensureOwnedLayer } from "../core/study-layer/layers";
import { fingerprintForSource, matchSourceByFingerprint } from "../core/study-layer/fingerprint";
import { rematchAnchor, type MatchStatus, type PortableAnchor, type RematchResult } from "../core/study-layer/rematch";
import { studyPackSchema, type PortablePackAnchor, type StudyPack } from "../core/study-layer/pack";
import { isPrivateByDefault } from "../kits/policy";
import type { StudyVault } from "../core/vault";

const HTML_TYPES = new Set(["html", "webpage", "markdown"]);

// Plain text for rematch: strip tags from HTML-ish sources, pass others through.
function plainTextForSource(content: string, sourceType: string): string {
  if (HTML_TYPES.has(sourceType)) {
    return content
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return content;
}

// Find the data-study-id of the most specific local element whose text contains the
// (re-located) quote — used to rebuild an imported html_selection anchor against the
// importer's own injected study-ids (the author's studyId is meaningless here).
function resolveLocalStudyId(content: string, quote: string): string | null {
  const needle = quote.replace(/\s+/g, " ").trim();
  if (!needle) return null;
  try {
    const doc = parseHtmlDocument(content);
    const els = Array.from(doc.querySelectorAll("[data-study-id]")) as unknown as Array<{
      textContent: string | null;
      getAttribute: (name: string) => string | null;
    }>;
    let best: { id: string; len: number } | null = null;
    for (const el of els) {
      const text = (el.textContent ?? "").replace(/\s+/g, " ");
      if (!text.includes(needle)) continue;
      const id = el.getAttribute("data-study-id");
      if (!id) continue;
      if (!best || text.length < best.len) best = { id, len: text.length };
    }
    return best?.id ?? null;
  } catch {
    return null;
  }
}

function toPortable(anchor: AnchorRecord): PortablePackAnchor {
  const base: PortablePackAnchor = {
    refId: anchor.id,
    anchorKind: anchor.anchorKind,
    quote: anchor.quote ?? "",
    contextBefore: anchor.contextBefore ?? "",
    contextAfter: anchor.contextAfter ?? ""
  };
  if (anchor.anchorKind === "pdf_selection") {
    base.page = anchor.page;
    if (anchor.rect) base.rect = anchor.rect;
  }
  if (anchor.anchorKind === "image_region") base.rect = anchor.rect;
  if (anchor.anchorKind === "web_text_quote") base.normalizedUrl = anchor.normalizedUrl;
  if (anchor.anchorKind === "code_range") {
    base.filePath = anchor.filePath;
    base.symbol = anchor.symbol;
  }
  return base;
}

// —— Export ————————————————————————————————————————————————————————————————

export async function buildStudyPack(vault: StudyVault, layerId: string): Promise<StudyPack | null> {
  const layer = await vault.stores.layers.get(layerId);
  if (!layer) return null;

  // A layer's notes = notes whose multi-membership includes it (spec §7). Anchor
  // membership is now DERIVED from those notes (anchor.layerId is no longer the source
  // of truth), unioned with any standalone anchors still carrying this layerId for
  // backward-compat (a highlight with no note shouldn't be dropped on export).
  const layerNotes = (await vault.stores.notes.list()).filter((n) => n.layerIds.includes(layerId));
  const notedAnchorIds = new Set(layerNotes.flatMap((n) => n.anchorIds));
  const allAnchors = await vault.stores.anchors.list();
  const layerAnchors = allAnchors.filter((a) => notedAnchorIds.has(a.id) || a.layerId === layerId);

  // Propagation policy (user spec §11): a kit can mark a contentType private-by-default
  // (e.g. textbook.mistake) so it never leaves the vault on export. Drop those notes,
  // then drop any anchor referenced ONLY by dropped notes (standalone + shared anchors
  // stay). Notes without a policy (markdown, …) are always exportable.
  const notes = layerNotes.filter((n) => !isPrivateByDefault(n.contentType));
  const keptAnchorIds = new Set(notes.flatMap((n) => n.anchorIds));
  const droppedAnchorIds = new Set(
    layerNotes.filter((n) => isPrivateByDefault(n.contentType)).flatMap((n) => n.anchorIds)
  );
  const anchors = layerAnchors.filter((a) => !(droppedAnchorIds.has(a.id) && !keptAnchorIds.has(a.id)));
  const anchorIds = new Set(anchors.map((a) => a.id));

  let fingerprint = layer.sourceFingerprint ?? {};
  if (layer.localSourceId) {
    const source = await vault.stores.sources.get(layer.localSourceId);
    if (source) fingerprint = fingerprintForSource(source);
  }

  return studyPackSchema.parse({
    packId: createEntityId("layer"),
    createdAt: new Date().toISOString(),
    app: "ai-study-vault",
    sourceFingerprint: fingerprint,
    layer: {
      title: layer.title,
      description: layer.description,
      author: layer.author,
      visibility: layer.visibility
    },
    anchors: anchors.map(toPortable),
    // Strip local realizations from notes: keep content + which anchors (by ref) they hang off.
    notes: notes.map((note) => ({
      contentType: note.contentType,
      content: note.content,
      anchorRefs: note.anchorIds.filter((id) => anchorIds.has(id)),
      conceptRefs: []
    }))
  });
}

// —— Preview ———————————————————————————————————————————————————————————————

export type ImportPreview = {
  matchedSourceId: string | null;
  matchedBy: string | null;
  anchors: Array<{ refId: string; anchorKind: string; status: MatchStatus }>;
  stats: { matched: number; fuzzy: number; unmatched: number };
};

async function rematchAgainstSource(
  vault: StudyVault,
  source: SourceRecord | null,
  fingerprint: StudyPack["sourceFingerprint"],
  portable: PortableAnchor
): Promise<RematchResult> {
  if (!source) return { status: "unmatched" };
  const content = await readSourceContent(vault, source).catch(() => "");
  const text = plainTextForSource(content, source.sourceType);
  const sameBinary = !!fingerprint.contentHash && fingerprint.contentHash === source.contentHash;
  return rematchAnchor(portable, { text, sameBinary });
}

export async function previewImport(vault: StudyVault, pack: StudyPack): Promise<ImportPreview> {
  const sources = await vault.stores.sources.list();
  const match = matchSourceByFingerprint(sources, pack.sourceFingerprint);
  const source = match?.source ?? null;

  const stats = { matched: 0, fuzzy: 0, unmatched: 0 };
  const anchors: ImportPreview["anchors"] = [];
  for (const portable of pack.anchors) {
    const result = await rematchAgainstSource(vault, source, pack.sourceFingerprint, portable);
    stats[result.status] += 1;
    anchors.push({ refId: portable.refId, anchorKind: portable.anchorKind, status: result.status });
  }

  return {
    matchedSourceId: source?.id ?? null,
    matchedBy: match?.by ?? null,
    anchors,
    stats
  };
}

// —— Commit ————————————————————————————————————————————————————————————————

export type ImportCommitResult = {
  layerId: string;
  sourceId: string | null;
  createdAnchors: number;
  importedNotes: number;
  stats: { matched: number; fuzzy: number; unmatched: number };
};

// Build a local anchor record for a re-located imported anchor. Returns null when the
// kind can't be realized locally (e.g. html with no resolvable study-id, code_range in
// V1) — the caller keeps the note and stashes the portable info so nothing is lost.
function realizeAnchor(
  source: SourceRecord,
  content: string,
  portable: PortablePackAnchor,
  result: RematchResult,
  layerId: string
): AnchorRecord | null {
  const status = result.status;
  const quote = result.text?.quote ?? portable.quote;
  const contextBefore = result.text?.contextBefore ?? portable.contextBefore ?? "";
  const contextAfter = result.text?.contextAfter ?? portable.contextAfter ?? "";

  let record: AnchorRecord | null = null;
  switch (portable.anchorKind) {
    case "html_selection": {
      const studyId = resolveLocalStudyId(content, quote);
      if (!studyId) return null;
      record = createHtmlSelectionAnchor({ sourceId: source.id, studyId, quote, contextBefore, contextAfter });
      break;
    }
    case "web_text_quote": {
      const normalizedUrl =
        portable.normalizedUrl ?? (source.metadata?.normalizedUrl as string | undefined);
      if (!normalizedUrl) return null;
      record = createWebTextQuoteAnchor({ sourceId: source.id, normalizedUrl, quote, contextBefore, contextAfter });
      break;
    }
    case "pdf_selection": {
      if (!portable.page) return null;
      record = createPdfSelectionAnchor({
        sourceId: source.id,
        page: portable.page,
        rect: portable.rect,
        quote,
        contextBefore,
        contextAfter
      });
      break;
    }
    case "image_region": {
      if (!portable.rect) return null;
      record = createImageRegionAnchor({ sourceId: source.id, rect: portable.rect, quote });
      break;
    }
    default:
      // code_range (and any future kind) — not auto-realized in V1.
      return null;
  }

  return anchorSchema.parse({ ...record, layerId, matchStatus: status });
}

export async function commitImport(
  vault: StudyVault,
  pack: StudyPack,
  opts: { targetSourceId?: string } = {}
): Promise<ImportCommitResult> {
  const sources = await vault.stores.sources.list();
  const source = opts.targetSourceId
    ? sources.find((s) => s.id === opts.targetSourceId) ?? null
    : matchSourceByFingerprint(sources, pack.sourceFingerprint)?.source ?? null;

  // Nest the imported layer under the source's "Imported" parent (spec §8.2: hierarchy
  // is import-driven). Only when we resolved a local source — an unmatched pack has no
  // source to hang a per-source parent off, so it stays top-level until rematched.
  const importedParent = source ? await ensureImportedParent(vault, source) : null;

  const now = new Date().toISOString();
  const layer = studyLayerSchema.parse({
    id: createEntityId("layer"),
    type: "layer",
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: "user",
    sourceFingerprint: pack.sourceFingerprint,
    localSourceId: source?.id,
    title: pack.layer.title,
    description: pack.layer.description,
    author: pack.layer.author,
    visibility: pack.layer.visibility,
    importMode: "imported",
    enabled: true,
    role: "shared",
    parentId: importedParent?.id,
    origin: { packId: pack.packId, importedAt: now }
  });
  await vault.stores.layers.upsert(layer);

  const content = source ? await readSourceContent(vault, source).catch(() => "") : "";
  const text = source ? plainTextForSource(content, source.sourceType) : "";
  const sameBinary = !!source && !!pack.sourceFingerprint.contentHash && pack.sourceFingerprint.contentHash === source.contentHash;

  const stats = { matched: 0, fuzzy: 0, unmatched: 0 };
  // refId → { anchorId? , portable } so notes can resolve their anchors (and keep
  // un-located ones for manual rematch).
  const byRef = new Map<string, { anchorId: string | null; portable: PortablePackAnchor; status: MatchStatus }>();
  let createdAnchors = 0;

  for (const portable of pack.anchors) {
    const result: RematchResult = source ? rematchAnchor(portable, { text, sameBinary }) : { status: "unmatched" };
    stats[result.status] += 1;

    let anchorId: string | null = null;
    if (source && result.status !== "unmatched") {
      const record = realizeAnchor(source, content, portable, result, layer.id);
      if (record) {
        await vault.stores.anchors.upsert(record);
        anchorId = record.id;
        createdAnchors += 1;
      }
    }
    byRef.set(portable.refId, { anchorId, portable, status: result.status });
  }

  let importedNotes = 0;
  for (const portableNote of pack.notes) {
    const resolved = portableNote.anchorRefs.map((ref) => byRef.get(ref)).filter(Boolean) as Array<{
      anchorId: string | null;
      portable: PortablePackAnchor;
      status: MatchStatus;
    }>;
    const anchorIds = resolved.map((r) => r.anchorId).filter((id): id is string => !!id);
    // Never lose: portable info for anchors we couldn't re-locate, for manual rematch later.
    const unmatchedAnchors = resolved.filter((r) => !r.anchorId).map((r) => ({ ...r.portable, status: r.status }));

    const note = noteSchema.parse({
      id: createEntityId("note"),
      type: "note",
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: "user",
      sourceId: source?.id,
      anchorIds,
      conceptIds: [],
      contentType: portableNote.contentType,
      content: portableNote.content,
      visibility: "private",
      // Membership merges into the target imported layer (spec §7).
      layerIds: [layer.id],
      origin: { copiedFrom: pack.packId },
      metadata: unmatchedAnchors.length ? { unmatchedAnchors } : {}
    });
    await vault.stores.notes.upsert(note);
    importedNotes += 1;
  }

  return { layerId: layer.id, sourceId: source?.id ?? null, createdAnchors, importedNotes, stats };
}

export function parseStudyPack(input: unknown): StudyPack {
  return studyPackSchema.parse(input);
}
