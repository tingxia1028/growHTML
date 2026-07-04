// Anchors domain services (X0 shared-core extraction). Transport-agnostic:
// (deps, parsed input) → plain data, typed errors from ./errors. The anchor list
// carries the svpack read-model merge, so its deps include the SealedRuntime.
import { z } from "zod";
import { createHtmlSelectionAnchor } from "../../adapters/html/anchor";
import { createWebTextQuoteAnchor } from "../../adapters/web/anchor";
import { createPdfSelectionAnchor } from "../../adapters/pdf/anchor";
import { createImageRegionAnchor } from "../../adapters/image/anchor";
import { ensureOwnedLayer } from "../../core/study-layer/layers";
import { withTombstone } from "../../core/store/trash";
import type { StudyVault } from "../../core/vault";
import type { SealedRuntime } from "../svpack";
import { NotFoundError, ValidationError } from "./errors";

export type AnchorsDeps = { vault: StudyVault };
export type SealedAnchorsDeps = { vault: StudyVault; sealed: SealedRuntime };

export const createAnchorRequestSchema = z
  .object({
    sourceId: z.string().min(1),
    anchorKind: z
      .enum(["html_selection", "web_text_quote", "pdf_selection", "image_region"])
      .default("html_selection"),
    studyId: z.string().min(1).optional(),
    selector: z.string().min(1).optional(),
    normalizedUrl: z.string().min(1).optional(),
    page: z.number().int().positive().optional(),
    // Geometric region [x, y, w, h] (0..1) for figures / scanned pages / images.
    rect: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
    // Quote is optional now: a region anchor has no text. Text kinds still require
    // a non-empty quote OR a rect (enforced below).
    quote: z.string().default(""),
    contextBefore: z.string().default(""),
    contextAfter: z.string().default("")
  })
  // An anchor must carry SOMETHING to locate it: a non-empty quote or a rect.
  .refine((input) => input.quote.trim().length > 0 || !!input.rect, {
    message: "anchor requires a non-empty quote or a rect"
  });
export type CreateAnchorInput = z.infer<typeof createAnchorRequestSchema>;

/** Create an anchor of any kind; every new anchor joins its source's "owned" layer. */
export async function createAnchor({ vault }: AnchorsDeps, input: CreateAnchorInput) {
  const source = await vault.stores.sources.get(input.sourceId);
  if (!source) throw new NotFoundError("Source not found");
  // Every new anchor joins this source's "owned" layer (created on first use).
  const ownedLayer = await ensureOwnedLayer(vault, source);
  const stampLayer = <T extends { id: string }>(anchor: T) => ({ ...anchor, layerId: ownedLayer.id });

  if (input.anchorKind === "web_text_quote") {
    const normalizedUrl = input.normalizedUrl ?? (source.metadata?.normalizedUrl as string | undefined);
    if (!normalizedUrl) {
      throw new ValidationError("web_text_quote anchors require a normalizedUrl");
    }
    const webAnchor = createWebTextQuoteAnchor({
      sourceId: source.id,
      normalizedUrl,
      quote: input.quote,
      contextBefore: input.contextBefore,
      contextAfter: input.contextAfter,
      createdBy: "user"
    });
    const stamped = stampLayer(webAnchor);
    await vault.stores.anchors.upsert(stamped);
    return stamped;
  }

  if (input.anchorKind === "pdf_selection") {
    if (!input.page) {
      throw new ValidationError("pdf_selection anchors require a page");
    }
    // A pdf anchor is either a text quote or a geometric region (rect, empty
    // quote). The request schema already guarantees one of them is present.
    const pdfAnchor = createPdfSelectionAnchor({
      sourceId: source.id,
      page: input.page,
      rect: input.rect,
      quote: input.quote,
      contextBefore: input.contextBefore,
      contextAfter: input.contextAfter,
      createdBy: "user"
    });
    const stamped = stampLayer(pdfAnchor);
    await vault.stores.anchors.upsert(stamped);
    return stamped;
  }

  if (input.anchorKind === "image_region") {
    if (!input.rect) {
      throw new ValidationError("image_region anchors require a rect");
    }
    const imageAnchor = createImageRegionAnchor({
      sourceId: source.id,
      rect: input.rect,
      quote: input.quote,
      createdBy: "user"
    });
    const stamped = stampLayer(imageAnchor);
    await vault.stores.anchors.upsert(stamped);
    return stamped;
  }

  // html_selection requires both a studyId and a non-empty quote.
  if (!input.studyId) {
    throw new ValidationError("html_selection anchors require a studyId");
  }
  if (!input.quote.trim()) {
    throw new ValidationError("html_selection anchors require a quote");
  }
  const anchor = createHtmlSelectionAnchor({
    sourceId: source.id,
    studyId: input.studyId,
    selector: input.selector,
    quote: input.quote,
    contextBefore: input.contextBefore,
    contextAfter: input.contextAfter,
    createdBy: "user"
  });
  const stamped = stampLayer(anchor);
  await vault.stores.anchors.upsert(stamped);
  return stamped;
}

/**
 * Anchor painting is DERIVED, not stored: an anchor paints iff it has a note in
 * an ENABLED layer (OR across that note's layers). One anchor can be shared by
 * several notes with different layers, so we can't read `anchor.layerId` (kept
 * only for backward-compat). Note-less anchors are no longer painted; truly
 * orphaned ones are pruned so stale highlights cannot reappear.
 */
export async function listSourceAnchors({ vault, sealed }: SealedAnchorsDeps, input: { sourceId: string }) {
  const sourceId = input.sourceId;
  const layers = await vault.stores.layers.list();
  const enabled = new Set(layers.filter((layer) => layer.enabled).map((layer) => layer.id));
  const sourceNotes = (await vault.stores.notes.list()).filter((note) => note.sourceId === sourceId);
  const sourceAnchors = (await vault.stores.anchors.list()).filter((anchor) => anchor.sourceId === sourceId);

  // Anchor id -> does any note on it sit in an enabled layer? A note with EMPTY
  // layerIds is "always visible" (never orphan it), so it paints its anchors
  // regardless of the enabled set.
  const paintedByNote = new Set<string>();
  const noted = new Set<string>();
  for (const note of sourceNotes) {
    const visible = note.layerIds.length === 0 || note.layerIds.some((id) => enabled.has(id));
    for (const anchorId of note.anchorIds) {
      noted.add(anchorId);
      if (visible) paintedByNote.add(anchorId);
    }
  }

  await deleteAnchorsWithoutNotes(
    vault,
    sourceAnchors.filter((anchor) => !noted.has(anchor.id)).map((anchor) => anchor.id)
  );

  // Current rule: only note-backed anchors paint; note-less anchors never do.
  const anchors = sourceAnchors.filter((anchor) => paintedByNote.has(anchor.id));
  // Read-model merge (svpack §7.1): anchors of ACTIVE sealed packs paint alongside
  // store anchors, flagged `sealed: true`. They are note-backed by construction
  // (realizeImportRecords only realizes anchors its notes reference), and never
  // pass through the orphan prune above (which walks store anchors only).
  const sealedAnchors = sealed.snapshot().anchors.filter((anchor) => anchor.sourceId === sourceId);
  return [...anchors, ...sealedAnchors];
}

/**
 * Orphan-anchor cascade shared by the notes domain: SOFT-delete (TRUST-3) each
 * candidate anchor that no remaining LIVE note references (anchorIds) and no
 * patch references (anchorId). Tombstoning instead of hard-deleting keeps the
 * anchor restorable — restoring a trashed note resurrects its anchors, so the
 * highlight comes back too. `cascadeOf` marks the parent (the deleted note)
 * whose restore should resurrect these anchors; the edit-detach/prune paths
 * pass none (their tombstones just age out via auto-purge).
 */
export async function deleteAnchorsWithoutNotes(
  vault: StudyVault,
  anchorIds: Iterable<string>,
  trash?: { deletedAt?: string; cascadeOf?: string }
) {
  const candidates = [...new Set(anchorIds)];
  if (candidates.length === 0) return;

  const [notes, patches] = await Promise.all([vault.stores.notes.list(), vault.stores.patches.list()]);
  const referencedByNote = new Set<string>();
  for (const note of notes) {
    for (const anchorId of note.anchorIds) referencedByNote.add(anchorId);
  }
  const referencedByPatch = new Set(patches.map((patch) => patch.anchorId));

  const deletedAt = trash?.deletedAt ?? new Date().toISOString();
  for (const anchorId of candidates) {
    if (!referencedByNote.has(anchorId) && !referencedByPatch.has(anchorId)) {
      const anchor = await vault.stores.anchors.get(anchorId);
      if (anchor) await vault.stores.anchors.upsert(withTombstone(anchor, deletedAt, trash?.cascadeOf));
    }
  }
}
