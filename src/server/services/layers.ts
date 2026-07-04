// Study Layers domain services (X0 shared-core extraction): the per-source lens
// axis (owned + preset stages + custom + imported) plus .studypack export/import.
// Transport-agnostic: (deps, parsed input) → plain data, typed errors from ./errors.
import { z } from "zod";
import { createCustomLayer, ensureOwnedLayer, ensurePresetStages } from "../../core/study-layer/layers";
import { noteSchema, studyLayerSchema, type StudyLayerRecord } from "../../core/schema";
import { activeKitIdsForSource } from "../../kits/activation";
import { stagePresetForKits } from "../../kits/policy";
import type { StudyVault } from "../../core/vault";
import type { SealedRuntime } from "../svpack";
import { buildStudyPack, commitImport, parseStudyPack, previewImport } from "../studyLayer";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors";

export type LayersDeps = { vault: StudyVault };
export type SealedLayersDeps = { vault: StudyVault; sealed: SealedRuntime };

// Create a user-defined ("custom") layer over a source — backs the layer manager.
export const createLayerRequestSchema = z.object({
  title: z.string().min(1),
  color: z.string().min(1).optional(),
  order: z.number().optional()
});
export type CreateLayerInput = z.infer<typeof createLayerRequestSchema>;

// Toggle a layer on/off (enabled, reused as the filter include/exclude), rename it,
// or set its presentation fields (color/order) for the manager.
export const updateLayerRequestSchema = z
  .object({
    enabled: z.boolean().optional(),
    title: z.string().min(1).optional(),
    color: z.string().min(1).optional(),
    order: z.number().optional(),
    // D3a (note-presentation-unified §D3): per-layer PAINT style (highlight color +
    // decoration). Reuses the core studyLayer style shape so the round-trip is one type.
    style: studyLayerSchema.shape.style
  })
  .refine(
    (input) =>
      input.enabled !== undefined ||
      input.title !== undefined ||
      input.color !== undefined ||
      input.order !== undefined ||
      input.style !== undefined,
    { message: "layer update requires enabled, title, color, order, or style" }
  );
export type UpdateLayerInput = z.infer<typeof updateLayerRequestSchema>;

/**
 * List the layers over a source, for the multi-select filter switcher. The owned
 * layer and kit-seeded child layers are created on demand here (lazily, the same way
 * ensureOwnedLayer works) so the switcher always sees them. F7a: these presets are
 * no longer a core-hardcoded taxonomy — they are SEEDED FROM THE SOURCE'S ACTIVE KIT.
 * We resolve the active kit ids (metadata.activeKitIds, else the workspace default —
 * which is FALLBACK_DEFAULT_KIT="textbook-learning" server-side, so a default vault
 * still gets 预习/学习/复习/拓展, now KIT-sourced) and ask the kit policies for their
 * combined stagePreset. No active kit / no kit stagePreset ⇒ empty list ⇒ NO preset
 * child layers created (owned + custom + imported still work). ensurePresetStages never
 * deletes, so pre-existing preset layers in migrated vaults are preserved.
 * Sealed imported layers merge into the result (read model, svpack §7.1).
 */
export async function listSourceLayers({ vault, sealed }: SealedLayersDeps, input: { sourceId: string }) {
  const source = await vault.stores.sources.get(input.sourceId);
  if (source) {
    await ensureOwnedLayer(vault, source);
    await ensurePresetStages(vault, source, stagePresetForKits(activeKitIdsForSource(source)));
  }
  const layers = (await vault.stores.layers.list()).filter((layer) => layer.localSourceId === input.sourceId);
  // Read-model merge (svpack §7.1): sealed imported layers show in the Lens like
  // any other (their plaintext "导入图层" umbrella parent is already in the store
  // list above), flagged sealed: true. Unbound sealed layers (no matched source)
  // have no localSourceId and only surface via GET /api/svpack until re-anchored.
  const sealedLayers = sealed.snapshot().layers.filter((layer) => layer.localSourceId === input.sourceId);
  return [...layers, ...sealedLayers];
}

/** Create a custom layer over a source (404 when the source is missing). */
export async function createLayer(
  { vault }: LayersDeps,
  input: { sourceId: string } & CreateLayerInput
): Promise<StudyLayerRecord> {
  const source = await vault.stores.sources.get(input.sourceId);
  if (!source) throw new NotFoundError("Source not found");
  return createCustomLayer(vault, source, { title: input.title, color: input.color, order: input.order });
}

/**
 * Sealed imported layers are read-only records inside their pack blob (svpack §7.1).
 * Exposed separately so the transport can enforce it BEFORE body validation (403
 * wins over 400, exactly like the pre-extraction route order); update/delete/export
 * also re-check internally so direct callers can never bypass it.
 */
export function assertLayerWritable({ sealed }: { sealed: SealedRuntime }, layerId: string): void {
  if (sealed.snapshot().layerIds.has(layerId)) {
    throw new ForbiddenError("sealed content is read-only");
  }
}

/** Patch a layer's enabled/title/color/order. */
export async function updateLayer(
  { vault, sealed }: SealedLayersDeps,
  input: { layerId: string } & UpdateLayerInput
): Promise<StudyLayerRecord> {
  assertLayerWritable({ sealed }, input.layerId);
  const existing = await vault.stores.layers.get(input.layerId);
  if (!existing) throw new NotFoundError("Layer not found");
  const layer = studyLayerSchema.parse({
    ...existing,
    enabled: input.enabled ?? existing.enabled,
    title: input.title ?? existing.title,
    color: input.color ?? existing.color,
    order: input.order ?? existing.order,
    // D3a: patch the paint style (undefined = keep existing — this construction does NOT
    // spread `input`, so the field must be carried explicitly).
    style: input.style ?? existing.style,
    updatedAt: new Date().toISOString()
  });
  await vault.stores.layers.upsert(layer);
  return layer;
}

/**
 * Delete a CUSTOM layer (manager action). Preset / owned / imported layers are
 * structural and cannot be deleted here (409). The deleted layer id is cascade-
 * stripped from every note's `layerIds` so a note that lived ONLY in this layer
 * collapses to [] — i.e. "always visible", never orphaned to invisibility (spec §5).
 * Notes that also belong to other layers keep those memberships.
 */
export async function deleteLayer({ vault, sealed }: SealedLayersDeps, input: { layerId: string }): Promise<void> {
  // A sealed imported layer is deleted by deleting its pack (DELETE /api/svpack/:packId).
  assertLayerWritable({ sealed }, input.layerId);
  const existing = await vault.stores.layers.get(input.layerId);
  if (!existing) throw new NotFoundError("Layer not found");
  if (existing.role !== "custom") {
    throw new ConflictError("Only custom layers can be deleted");
  }
  const layerId = input.layerId;
  const affected = (await vault.stores.notes.list()).filter((note) => note.layerIds.includes(layerId));
  for (const note of affected) {
    await vault.stores.notes.upsert(
      noteSchema.parse({
        ...note,
        layerIds: note.layerIds.filter((id) => id !== layerId),
        updatedAt: new Date().toISOString()
      })
    );
  }
  await vault.stores.layers.delete(layerId);
}

/** Export a layer as a portable `.studypack` (local realizations stripped). */
export async function exportLayer({ vault, sealed }: SealedLayersDeps, input: { layerId: string }) {
  // Sealed imported layers are structurally absent from the entity stores that
  // buildStudyPack reads (svpack §7.2) — answer with the read-only refusal rather
  // than a misleading 404.
  assertLayerWritable({ sealed }, input.layerId);
  const pack = await buildStudyPack(vault, input.layerId);
  if (!pack) throw new NotFoundError("Layer not found");
  return pack;
}

/**
 * Preview an import: match the pack to a local source + rematch every anchor.
 * Does NOT persist anything. The raw pack is validated by parseStudyPack.
 */
export async function previewLayerImport({ vault }: LayersDeps, input: { pack: unknown }) {
  const pack = parseStudyPack(input.pack);
  return previewImport(vault, pack);
}

/** Commit an import: create an imported layer + re-located anchors + notes. */
export async function commitLayerImport(
  { vault }: LayersDeps,
  input: { pack: unknown; targetSourceId?: string }
) {
  const pack = parseStudyPack(input.pack);
  return commitImport(vault, pack, { targetSourceId: input.targetSourceId });
}
