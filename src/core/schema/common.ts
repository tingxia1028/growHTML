import { z } from "zod";
import { idPatternByKind } from "../ids";

export const schemaVersion = 1;

export const createdBySchema = z.enum(["user", "ai", "system"]);
export const visibilitySchema = z.enum(["private", "shared", "public"]);

export const isoDateTimeSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Expected an ISO-compatible date-time string"
});

export function idSchema(kind: keyof typeof idPatternByKind) {
  return z.string().regex(idPatternByKind[kind], `Expected a ${kind} id`);
}

export const sourceIdSchema = idSchema("source");
export const anchorIdSchema = idSchema("anchor");
export const noteIdSchema = idSchema("note");
export const patchIdSchema = idSchema("patch");
export const conceptIdSchema = idSchema("concept");
export const relationIdSchema = idSchema("relation");

export function recordEnvelopeSchema<TType extends string>(type: TType, id: z.ZodString) {
  return z.object({
    id,
    type: z.literal(type),
    schemaVersion: z.literal(schemaVersion),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    createdBy: createdBySchema,
    // Plugin escape hatch: every entity carries free-form metadata so future
    // plugins extend via metadata instead of forcing core schema changes.
    metadata: z.record(z.string(), z.unknown()).default({})
  });
}

const sourceNodeRefSchema = z.object({ type: z.literal("source"), id: sourceIdSchema });
const anchorNodeRefSchema = z.object({ type: z.literal("anchor"), id: anchorIdSchema });
const noteNodeRefSchema = z.object({ type: z.literal("note"), id: noteIdSchema });
const patchNodeRefSchema = z.object({ type: z.literal("patch"), id: patchIdSchema });
const conceptNodeRefSchema = z.object({ type: z.literal("concept"), id: conceptIdSchema });

export const nodeRefSchema = z.discriminatedUnion("type", [
  sourceNodeRefSchema,
  anchorNodeRefSchema,
  noteNodeRefSchema,
  patchNodeRefSchema,
  conceptNodeRefSchema
]);

export type CreatedBy = z.infer<typeof createdBySchema>;
export type Visibility = z.infer<typeof visibilitySchema>;
export type NodeRef = z.infer<typeof nodeRefSchema>;

