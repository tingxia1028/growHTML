// Concepts + Relations domain services (X0 shared-core extraction). The bare list
// and delete routes stay one-liners over the entity stores in app.ts; these carry
// the envelope assembly (id/type/timestamps) and the concept back-reference join.
import { z } from "zod";
import { createEntityId } from "../../core/ids";
import {
  conceptSchema,
  nodeRefSchema,
  relationKindSchema,
  relationSchema,
  type ConceptRecord,
  type RelationRecord
} from "../../core/schema";
import type { StudyVault } from "../../core/vault";
import { NotFoundError } from "./errors";

export type ConceptsDeps = { vault: StudyVault };

export const createConceptRequestSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  description: z.string().default(""),
  tags: z.array(z.string().min(1)).default([]),
  confidence: z.number().min(0).max(1).optional()
});
export type CreateConceptInput = z.infer<typeof createConceptRequestSchema>;

export const createRelationRequestSchema = z.object({
  from: nodeRefSchema,
  to: nodeRefSchema,
  relationKind: relationKindSchema,
  label: z.string().optional(),
  confidence: z.number().min(0).max(1).optional()
});
export type CreateRelationInput = z.infer<typeof createRelationRequestSchema>;

export async function createConcept({ vault }: ConceptsDeps, input: CreateConceptInput): Promise<ConceptRecord> {
  const now = new Date().toISOString();
  const concept = conceptSchema.parse({
    id: createEntityId("concept"),
    type: "concept",
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: "user",
    ...input
  });
  await vault.stores.concepts.upsert(concept);
  return concept;
}

/** Concept detail with back-references: which notes link it and which relations touch it. */
export async function getConceptDetail({ vault }: ConceptsDeps, input: { conceptId: string }) {
  const concept = await vault.stores.concepts.get(input.conceptId);
  if (!concept) throw new NotFoundError("Concept not found");
  const notes = (await vault.stores.notes.list()).filter((note) => note.conceptIds.includes(concept.id));
  const relations = (await vault.stores.relations.list()).filter(
    (relation) => relation.from.id === concept.id || relation.to.id === concept.id
  );
  return { concept, notes, relations };
}

export async function createRelation({ vault }: ConceptsDeps, input: CreateRelationInput): Promise<RelationRecord> {
  const now = new Date().toISOString();
  const relation = relationSchema.parse({
    id: createEntityId("relation"),
    type: "relation",
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: "user",
    ...input
  });
  await vault.stores.relations.upsert(relation);
  return relation;
}
