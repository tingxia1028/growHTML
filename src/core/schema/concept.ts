import { z } from "zod";
import { conceptIdSchema, recordEnvelopeSchema } from "./common";

export const conceptSchema = recordEnvelopeSchema("concept", conceptIdSchema).extend({
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  description: z.string().default(""),
  tags: z.array(z.string().min(1)).default([]),
  confidence: z.number().min(0).max(1).optional()
});

export type ConceptRecord = z.infer<typeof conceptSchema>;

