import { z } from "zod";
import { nodeRefSchema, recordEnvelopeSchema, relationIdSchema } from "./common";

export const relationKindSchema = z.enum([
  "related",
  "explains",
  "extends",
  "contradicts",
  "depends_on",
  "same_topic",
  "derived_from",
  "references",
  "modifies",
  "summarizes"
]);

export const relationSchema = recordEnvelopeSchema("relation", relationIdSchema).extend({
  from: nodeRefSchema,
  to: nodeRefSchema,
  relationKind: relationKindSchema,
  label: z.string().optional(),
  confidence: z.number().min(0).max(1).optional()
});

export type RelationKind = z.infer<typeof relationKindSchema>;
export type RelationRecord = z.infer<typeof relationSchema>;

