// Patches domain services (X0 shared-core extraction): AI/user HTML edit proposals
// with a minimal status state machine + conflict detection against the live source.
// The bare per-source list route stays a one-liner over the store in app.ts.
import { z } from "zod";
import { applyHtmlPatchWithGuard } from "../../adapters/html/anchor";
import { createEntityId } from "../../core/ids";
import { readSourceContent } from "../../core/store/sources";
import {
  patchActionSchema,
  patchSchema,
  type AnchorRecord,
  type PatchRecord,
  type PatchStatus
} from "../../core/schema";
import type { StudyVault } from "../../core/vault";
import { ConflictError, NotFoundError } from "./errors";

export type PatchesDeps = { vault: StudyVault };

export const createPatchRequestSchema = z.object({
  sourceId: z.string().min(1),
  anchorId: z.string().min(1),
  action: patchActionSchema,
  oldText: z.string().default(""),
  newContent: z.string().min(1),
  summary: z.string().optional()
});
export type CreatePatchInput = z.infer<typeof createPatchRequestSchema>;

export const updatePatchRequestSchema = z.object({
  status: z.enum(["pending", "accepted", "rejected", "applied", "reverted"])
});
export type UpdatePatchInput = z.infer<typeof updatePatchRequestSchema>;

// `conflict` is system-set (never requested); other transitions follow a minimal state machine.
const patchTransitions: Record<PatchStatus, readonly PatchStatus[]> = {
  pending: ["accepted", "rejected", "applied"],
  accepted: ["applied", "rejected"],
  applied: ["reverted"],
  reverted: ["applied"],
  rejected: [],
  conflict: ["applied"]
};

export async function createPatch({ vault }: PatchesDeps, input: CreatePatchInput): Promise<PatchRecord> {
  const now = new Date().toISOString();
  const patch = patchSchema.parse({
    id: createEntityId("patch"),
    type: "patch",
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: "user",
    sourceId: input.sourceId,
    anchorId: input.anchorId,
    action: input.action,
    status: "pending",
    oldText: input.oldText,
    newContent: input.newContent,
    summary: input.summary
  });

  await vault.stores.patches.upsert(patch);
  return patch;
}

/**
 * Drive the patch state machine. Invalid transitions raise ConflictError (409
 * `{ error }`); applying over drifted source content flips the record to
 * `conflict` FIRST (persisted side effect) and raises ConflictError carrying the
 * `{ patch, conflict }` body verbatim (409, no `error` field — as before).
 */
export async function updatePatchStatus(
  { vault }: PatchesDeps,
  input: { patchId: string } & UpdatePatchInput
): Promise<PatchRecord> {
  const existing = await vault.stores.patches.get(input.patchId);
  if (!existing) throw new NotFoundError("Patch not found");

  if (input.status !== existing.status && !patchTransitions[existing.status].includes(input.status)) {
    throw new ConflictError(`Invalid patch transition: ${existing.status} → ${input.status}`);
  }

  if (input.status === "applied") {
    const conflict = await detectPatchConflict(vault, existing);
    if (conflict) {
      const patch = {
        ...existing,
        status: "conflict" as const,
        updatedAt: new Date().toISOString()
      };
      await vault.stores.patches.upsert(patch);
      throw new ConflictError("patch conflict", { patch, conflict });
    }
  }

  const now = new Date().toISOString();
  const patch = patchSchema.parse({
    ...existing,
    status: input.status,
    updatedAt: now,
    appliedAt: input.status === "applied" ? now : existing.appliedAt,
    revertedAt: input.status === "reverted" ? now : existing.revertedAt
  });
  await vault.stores.patches.upsert(patch);
  return patch;
}

async function detectPatchConflict(vault: StudyVault, patch: PatchRecord) {
  const source = await vault.stores.sources.get(patch.sourceId);
  if (!source) return { reason: "source_not_found" };

  const anchor = (await vault.stores.anchors.get(patch.anchorId)) as AnchorRecord | null;
  if (!anchor || anchor.anchorKind !== "html_selection") return { reason: "anchor_not_found" };

  const content = await readSourceContent(vault, source);
  const result = applyHtmlPatchWithGuard(content, anchor, patch);
  if (result.ok) return null;

  return {
    reason: result.reason,
    message: result.message
  };
}
