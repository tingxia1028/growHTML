// Patches domain services (X0 shared-core extraction): AI/user HTML edit proposals
// with a minimal status state machine + conflict detection against the live source.
// The bare per-source list route stays a one-liner over the store in app.ts.
//
// SRC-3 (docs/design/source-authoring.md §4) finishes the DESIGNED lifecycle: the
// APPLY engine. `accepted → applied` verifies `oldText` still matches at the anchor
// (else → `conflict`) and then REWRITES the stored source content THROUGH THE SAME
// SRC-2 save pipeline (`rewriteSourceContent` → `updateStoredSourceContent` re-hash +
// re-project anchors) — no second content-rewrite path. `reverted` restores the prior
// bytes (stashed on the patch record) through the same pipeline. Patches double as the
// edit LOG (appliedAt/revertedAt + the prior-content stash on `metadata`).
import { z } from "zod";
import { applyHtmlPatchWithGuard } from "../../adapters/html/anchor";
import { createEntityId } from "../../core/ids";
import { readSourceContent } from "../../core/store/sources";
import {
  patchActionSchema,
  patchSchema,
  type AnchorRecord,
  type HtmlSelectionAnchor,
  type PatchRecord,
  type PatchStatus,
  type SourceRecord
} from "../../core/schema";
import type { StudyVault } from "../../core/vault";
import { ConflictError, NotFoundError } from "./errors";
import { rewriteSourceContent } from "./sourceAuthoring";

// Clock-injected so tests pin appliedAt/revertedAt deterministically (X0a idiom).
export type PatchesDeps = { vault: StudyVault; now?: () => Date };

const nowIso = (deps: PatchesDeps) => (deps.now ? deps.now() : new Date()).toISOString();

/** Where the apply engine stashes the pre-apply bytes so `reverted` can restore them. */
const PRIOR_CONTENT_KEY = "srcPriorContent";

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

export async function createPatch({ vault, now }: PatchesDeps, input: CreatePatchInput): Promise<PatchRecord> {
  const stamp = (now ? now() : new Date()).toISOString();
  const patch = patchSchema.parse({
    id: createEntityId("patch"),
    type: "patch",
    schemaVersion: 1,
    createdAt: stamp,
    updatedAt: stamp,
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
 * `{ error }`). `→ applied` runs the APPLY ENGINE: verify `oldText` at the anchor
 * (drift ⇒ flip to `conflict` FIRST as a persisted side effect, then raise
 * ConflictError carrying `{ patch, conflict }` verbatim — 409, no `error` field, as
 * before), then rewrite the stored content through the SRC-2 pipeline and stamp
 * `appliedAt`. `→ reverted` restores the pre-apply bytes and stamps `revertedAt`.
 */
export async function updatePatchStatus(
  deps: PatchesDeps,
  input: { patchId: string } & UpdatePatchInput
): Promise<PatchRecord> {
  const { vault } = deps;
  const existing = await vault.stores.patches.get(input.patchId);
  if (!existing) throw new NotFoundError("Patch not found");

  if (input.status !== existing.status && !patchTransitions[existing.status].includes(input.status)) {
    throw new ConflictError(`Invalid patch transition: ${existing.status} → ${input.status}`);
  }

  if (input.status === "applied") {
    return applyPatch(deps, existing);
  }

  if (input.status === "reverted") {
    return revertPatch(deps, existing);
  }

  const now = nowIso(deps);
  const patch = patchSchema.parse({ ...existing, status: input.status, updatedAt: now });
  await vault.stores.patches.upsert(patch);
  return patch;
}

/**
 * APPLY: resolve the anchor + verify `oldText` (via applyHtmlPatchWithGuard, the same
 * guard `detectPatchConflict` used), and on a clean match REWRITE the stored source
 * content through the SRC-2 pipeline. The pre-apply bytes are stashed on the patch so
 * `revert` can restore them, and `appliedAt` is stamped. Drift ⇒ persist `conflict` and
 * raise ConflictError({ patch, conflict }).
 */
async function applyPatch(deps: PatchesDeps, existing: PatchRecord): Promise<PatchRecord> {
  const { vault } = deps;
  const resolved = await resolvePatchTarget(vault, existing);
  if (!resolved.ok) {
    const patch = patchSchema.parse({ ...existing, status: "conflict", updatedAt: nowIso(deps) });
    await vault.stores.patches.upsert(patch);
    throw new ConflictError("patch conflict", { patch, conflict: resolved.conflict });
  }

  const { source, content, anchor } = resolved;
  const result = applyHtmlPatchWithGuard(content, anchor, existing);
  if (!result.ok) {
    const patch = patchSchema.parse({ ...existing, status: "conflict", updatedAt: nowIso(deps) });
    await vault.stores.patches.upsert(patch);
    throw new ConflictError("patch conflict", {
      patch,
      conflict: { reason: result.reason, message: result.message }
    });
  }

  // Rewrite THROUGH the SRC-2 pipeline (re-hash → bump revision → re-project anchors).
  // `content` is the pre-apply projected html; stash it so revert restores byte-for-byte.
  await rewriteSourceContent(vault, source, result.content);

  const now = nowIso(deps);
  const patch = patchSchema.parse({
    ...existing,
    status: "applied",
    appliedAt: now,
    updatedAt: now,
    metadata: { ...existing.metadata, [PRIOR_CONTENT_KEY]: content }
  });
  await vault.stores.patches.upsert(patch);
  return patch;
}

/**
 * REVERT: restore the pre-apply bytes stashed at apply time, through the SAME pipeline
 * (so anchors re-project back), and stamp `revertedAt`. If no prior content was stashed
 * (legacy applied patch), the status flips without a content rewrite — the record still
 * moves to `reverted`, matching the pre-SRC-3 render-time behavior.
 */
async function revertPatch(deps: PatchesDeps, existing: PatchRecord): Promise<PatchRecord> {
  const { vault } = deps;
  const prior = existing.metadata[PRIOR_CONTENT_KEY];
  if (typeof prior === "string") {
    const source = await vault.stores.sources.get(existing.sourceId);
    if (source) await rewriteSourceContent(vault, source, prior);
  }

  const now = nowIso(deps);
  const rest = { ...existing.metadata };
  delete rest[PRIOR_CONTENT_KEY];
  const patch = patchSchema.parse({
    ...existing,
    status: "reverted",
    revertedAt: now,
    updatedAt: now,
    metadata: rest
  });
  await vault.stores.patches.upsert(patch);
  return patch;
}

type PatchTarget =
  | { ok: true; source: SourceRecord; content: string; anchor: HtmlSelectionAnchor }
  | { ok: false; conflict: { reason: string; message?: string } };

/** Resolve the source + html_selection anchor a patch targets, or a conflict reason. */
async function resolvePatchTarget(vault: StudyVault, patch: PatchRecord): Promise<PatchTarget> {
  const source = await vault.stores.sources.get(patch.sourceId);
  if (!source) return { ok: false, conflict: { reason: "source_not_found" } };

  const anchor = (await vault.stores.anchors.get(patch.anchorId)) as AnchorRecord | null;
  if (!anchor || anchor.anchorKind !== "html_selection") {
    return { ok: false, conflict: { reason: "anchor_not_found" } };
  }

  const content = await readSourceContent(vault, source);
  return { ok: true, source, content, anchor };
}
