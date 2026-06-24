import { z } from "zod";
import { anchorIdSchema, patchIdSchema, recordEnvelopeSchema, sourceIdSchema } from "./common";

export const patchActionSchema = z.enum([
  "insert_after_selection",
  "insert_before_selection",
  "replace_selection",
  "append_to_section",
  "rewrite_section",
  "add_annotation",
  "add_example",
  "add_diagram",
  "add_quiz",
  "restructure_document"
]);

export const patchStatusSchema = z.enum(["pending", "accepted", "rejected", "applied", "reverted", "conflict"]);

export const patchSchema = recordEnvelopeSchema("patch", patchIdSchema).extend({
  sourceId: sourceIdSchema,
  anchorId: anchorIdSchema,
  action: patchActionSchema,
  status: patchStatusSchema,
  oldText: z.string(),
  newContent: z.string().min(1),
  summary: z.string().optional(),
  appliedAt: z.string().optional(),
  revertedAt: z.string().optional()
});

export type PatchAction = z.infer<typeof patchActionSchema>;
export type PatchStatus = z.infer<typeof patchStatusSchema>;
export type PatchRecord = z.infer<typeof patchSchema>;

