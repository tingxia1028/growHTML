// Notes domain services (X0 shared-core extraction). Transport-agnostic:
// (deps, parsed input) → plain data, typed errors from ./errors. List/update/delete
// carry the svpack sealed read-model (merge + read-only guard), so their deps
// include the SealedRuntime.
import { z } from "zod";
import { WIKI_LINK_CONTENT_TYPES, extractWikiLinks } from "../../core/concepts/wikiLinks";
import { createEntityId } from "../../core/ids";
import { getNoteContentSpec, parseNoteContent } from "../../core/notes/contentTypes";
import { noteSchema, type NoteRecord } from "../../core/schema";
import { ensureOwnedLayer } from "../../core/study-layer/layers";
import { withTombstone } from "../../core/store/trash";
import type { StudyVault } from "../../core/vault";
import type { SealedRuntime } from "../svpack";
import { deleteAnchorsWithoutNotes } from "./anchors";
import { ensureConceptsByName } from "./concepts";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";

export type NotesDeps = { vault: StudyVault };
export type SealedNotesDeps = { vault: StudyVault; sealed: SealedRuntime };

export const createNoteRequestSchema = z.object({
  sourceId: z.string().min(1).optional(),
  anchorIds: z.array(z.string().min(1)).default([]),
  conceptIds: z.array(z.string().min(1)).default([]),
  // Study Layer membership (multi). When omitted, a source-attached note defaults to
  // that source's owned layer so it is never orphaned to invisibility (spec §5).
  layerIds: z.array(z.string().min(1)).optional(),
  contentType: z.string().min(1).default("markdown"),
  // D6 (note-presentation-unified.md §6): an auto-materialized anchor-context draft
  // sends status:"draft" so the note is born flagged (undo toast + draft marker).
  // Optional/additive; absent = a normal committed note (the byte-for-byte prior path).
  status: z.literal("draft").optional(),
  // Shape validated per-type by the NoteContentSpec, not here.
  content: z.unknown()
});
export type CreateNoteInput = z.infer<typeof createNoteRequestSchema>;

// Partial note update — attach/detach a note to concepts/anchors/layers after
// creation AND (since note-edit-delete V1) edit the note's CONTENT in place. When
// `content` is present it is re-validated against the note's own contentType spec
// (getNoteContentSpec(...).schema) before persisting, exactly like create — an
// unknown/invalid shape never reaches storage. The contentType itself is fixed on
// edit (editing content within the same type; changing type is out of scope).
// At least one field must be present.
export const updateNoteRequestSchema = z
  .object({
    conceptIds: z.array(z.string().min(1)).optional(),
    anchorIds: z.array(z.string().min(1)).optional(),
    // Study Layer membership — add/remove/move a note between layers (the full set
    // replaces the note's current layerIds, spec §8).
    layerIds: z.array(z.string().min(1)).optional(),
    // The note's structured content, re-validated per-type at the handler (not here).
    content: z.unknown().optional()
  })
  .refine(
    (input) =>
      input.conceptIds !== undefined ||
      input.anchorIds !== undefined ||
      input.layerIds !== undefined ||
      input.content !== undefined,
    { message: "note update requires conceptIds, anchorIds, layerIds, or content" }
  );
export type UpdateNoteInput = z.infer<typeof updateNoteRequestSchema>;

// —— [[双链]] wiki-links (CG-2, concept-light-and-graph §1.2) ——————————————————
// `[[名词]]` in a text note's content IS a concept link: on create/update the text
// is parsed and each name is create-or-matched (the shared normalizeConceptName
// identity), then UNIONED into the note's conceptIds — writing IS linking, and the
// graph derives the rest. ADDITIVE by design: removing `[[x]]` from the text does
// NOT unlink (unlinking stays an explicit act, so an edit can't silently drop a
// manually-made link).
async function conceptIdsWithWikiLinks(
  vault: StudyVault,
  contentType: string,
  content: unknown,
  conceptIds: readonly string[]
): Promise<string[]> {
  if (!WIKI_LINK_CONTENT_TYPES.has(contentType) || typeof content !== "string") return [...conceptIds];
  const names = extractWikiLinks(content);
  if (names.length === 0) return [...conceptIds];
  const linked = await ensureConceptsByName({ vault }, names);
  return Array.from(new Set([...conceptIds, ...linked.map((concept) => concept.id)]));
}

/** Create a note; content is validated against its contentType's NoteContentSpec. */
export async function createNote({ vault }: NotesDeps, input: CreateNoteInput): Promise<NoteRecord> {
  // Unknown content type → typed 400 (a plain Error here would otherwise be 500).
  if (!getNoteContentSpec(input.contentType)) {
    throw new ValidationError(`Unknown note contentType: ${input.contentType}`);
  }
  // Validate content against its type's spec (ZodError → 400 at the transport edge).
  const content = parseNoteContent(input.contentType, input.content);
  // [[双链]]: text notes link their wiki-named concepts as a save byproduct.
  const conceptIds = await conceptIdsWithWikiLinks(vault, input.contentType, content, input.conceptIds);
  const now = new Date().toISOString();
  // Membership: explicit layerIds win; else a source-attached note defaults to that
  // source's "owned" layer (never orphan it to invisibility, spec §5); else empty.
  let layerIds: string[] = input.layerIds ?? [];
  if (!input.layerIds && input.sourceId) {
    const source = await vault.stores.sources.get(input.sourceId);
    if (source) layerIds = [(await ensureOwnedLayer(vault, source)).id];
  }
  const note = noteSchema.parse({
    id: createEntityId("note"),
    type: "note",
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: "user",
    sourceId: input.sourceId,
    anchorIds: input.anchorIds,
    conceptIds,
    contentType: input.contentType,
    content,
    visibility: "private",
    // D6: forward the draft flag when present; omitted status stays a normal note.
    ...(input.status ? { status: input.status } : {}),
    layerIds
  });

  await vault.stores.notes.upsert(note);
  return note;
}

export type ListNotesInput = {
  conceptId?: string;
  anchorId?: string;
  sourceId?: string;
  /** csv of layer ids (the client's multi-select filter); absent → stored toggles. */
  enabledLayerIds?: string;
};

/**
 * Entity-oriented note query: filter by concept/anchor/source (a note can hang off
 * several of each) intersected with layer visibility. Sealed notes ride along in
 * the result (read-model merge, svpack §7.1), flagged `sealed: true`.
 */
export async function listNotes({ vault, sealed }: SealedNotesDeps, input: ListNotesInput) {
  const { conceptId, anchorId, sourceId } = input;
  const snapshot = sealed.snapshot();
  const visible = await layerVisibilityFilter(vault, input.enabledLayerIds, snapshot.enabledLayerIds);
  const matches = (note: { sourceId?: string; anchorIds: string[]; conceptIds: string[]; layerIds: string[] }) =>
    (!conceptId || note.conceptIds.includes(conceptId)) &&
    (!anchorId || note.anchorIds.includes(anchorId)) &&
    (!sourceId || note.sourceId === sourceId) &&
    visible(note);
  const notes = (await vault.stores.notes.list()).filter(matches);
  const sealedNotes = snapshot.notes.filter(matches);
  return [...notes, ...sealedNotes];
}

/**
 * Sealed (protected-import) notes are read-only in V1 (svpack §7.1): annotate on
 * top by creating your OWN note on the same anchor instead. Exposed separately so
 * the transport can enforce it BEFORE body validation (403 wins over 400, exactly
 * like the pre-extraction route order); update/delete also re-check internally so
 * direct callers can never bypass it.
 */
export function assertNoteWritable({ sealed }: { sealed: SealedRuntime }, noteId: string): void {
  if (sealed.snapshot().noteIds.has(noteId)) {
    throw new ForbiddenError("sealed content is read-only");
  }
}

/**
 * Patch a note's attachments (concept/anchor/layer links) AND/OR its CONTENT.
 * Content is re-validated against the note's OWN contentType spec (same gate as
 * create); the contentType is FIXED on edit. Detached anchors that become orphans
 * are cascade-deleted. Sealed notes are read-only (svpack §7.1).
 */
export async function updateNote(
  { vault, sealed }: SealedNotesDeps,
  input: { noteId: string } & UpdateNoteInput
): Promise<NoteRecord> {
  assertNoteWritable({ sealed }, input.noteId);
  const existing = await vault.stores.notes.get(input.noteId);
  if (!existing) throw new NotFoundError("Note not found");
  // Re-validate edited content against the note's existing contentType (ZodError →
  // 400 at the transport edge); when absent the stored content is kept unchanged.
  const content =
    input.content !== undefined ? parseNoteContent(existing.contentType, input.content) : existing.content;
  const previousAnchorIds = existing.anchorIds;
  // [[双链]] on edit: re-parse EDITED text content so newly-typed links land (the
  // union keeps every existing link — additive, never a silent unlink).
  const baseConceptIds = input.conceptIds ?? existing.conceptIds;
  const conceptIds =
    input.content !== undefined
      ? await conceptIdsWithWikiLinks(vault, existing.contentType, content, baseConceptIds)
      : baseConceptIds;
  const note = noteSchema.parse({
    ...existing,
    conceptIds,
    anchorIds: input.anchorIds ?? existing.anchorIds,
    layerIds: input.layerIds ?? existing.layerIds,
    content,
    updatedAt: new Date().toISOString()
  });
  await vault.stores.notes.upsert(note);
  if (input.anchorIds !== undefined) {
    const nextAnchorIds = new Set(note.anchorIds);
    await deleteAnchorsWithoutNotes(
      vault,
      previousAnchorIds.filter((anchorId) => !nextAnchorIds.has(anchorId))
    );
  }
  return note;
}

/**
 * Delete a note — SOFT (TRUST-3, docs/design/data-trust.md §3): the record is
 * tombstoned into the recycle bin behind the same API shape (the DELETE route is
 * unchanged; real deletion happens only via the trash purge surfaces).
 * ORPHAN-ANCHOR CASCADE: painting is DERIVED from anchors (the reader maps every
 * anchor in a source to a highlight), so trashing only the note record would
 * leave its anchors behind and the highlight would STAY painted. So after
 * trashing the note we cascade-TRASH each of its anchors that is now ORPHANED —
 * referenced by NO remaining live note AND NO patch — marked `cascadeOf: noteId`
 * so restoring the note resurrects them (and the highlight). Anchors still
 * shared by another live note or referenced by a patch are KEPT live.
 * See docs/design/note-edit-delete.md + data-trust.md §3.
 */
export async function deleteNote({ vault, sealed }: SealedNotesDeps, input: { noteId: string }): Promise<void> {
  // Sealed notes can only leave via DELETE /api/svpack/:packId (whole-pack delete).
  assertNoteWritable({ sealed }, input.noteId);
  const note = await vault.stores.notes.get(input.noteId);
  if (!note) throw new NotFoundError("Note not found");
  const deletedAt = new Date().toISOString();
  await vault.stores.notes.upsert(withTombstone(note, deletedAt));
  await deleteAnchorsWithoutNotes(vault, note.anchorIds, { deletedAt, cascadeOf: note.id });
}

// Build the OR-over-enabled-layers note-visibility predicate. A note is visible iff
// its layerIds intersects the enabled set (OR across its layers). A note with EMPTY
// layerIds is always visible (never orphan it to invisibility). The enabled set comes
// from an explicit `enabledLayerIds` csv when supplied (the client's multi-select
// filter), else from every layer whose `enabled` flag is on (the stored toggle —
// reused as the filter source of truth).
async function layerVisibilityFilter(
  vault: StudyVault,
  enabledLayerIdsParam: unknown,
  // Sealed layers live outside the entity stores (svpack §7.1), so the default
  // enabled set must union them in — otherwise sealed notes could never be visible.
  // An EXPLICIT enabledLayerIds param stays authoritative (the client's filter can
  // include or exclude a sealed layer id like any other).
  sealedEnabledLayerIds: ReadonlySet<string> = new Set()
): Promise<(note: { layerIds: string[] }) => boolean> {
  let enabled: Set<string>;
  if (typeof enabledLayerIdsParam === "string") {
    enabled = new Set(enabledLayerIdsParam.split(",").map((id) => id.trim()).filter(Boolean));
  } else {
    enabled = new Set((await vault.stores.layers.list()).filter((layer) => layer.enabled).map((layer) => layer.id));
    for (const id of sealedEnabledLayerIds) enabled.add(id);
  }
  return (note) => note.layerIds.length === 0 || note.layerIds.some((id) => enabled.has(id));
}
