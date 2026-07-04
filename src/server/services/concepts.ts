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
import { NotFoundError, ValidationError } from "./errors";

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

export const mergeConceptRequestSchema = z.object({
  targetConceptId: z.string().min(1)
});
export type MergeConceptInput = z.infer<typeof mergeConceptRequestSchema>;

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

function uniqStrings(values: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLocaleLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export async function deleteConcept({ vault }: ConceptsDeps, input: { conceptId: string }) {
  const concept = await vault.stores.concepts.get(input.conceptId);
  if (!concept) throw new NotFoundError("Concept not found");
  const now = new Date().toISOString();
  let notesUpdated = 0;
  let relationsRemoved = 0;

  const notes = await vault.stores.notes.list();
  for (const note of notes) {
    if (!note.conceptIds.includes(concept.id)) continue;
    await vault.stores.notes.upsert({
      ...note,
      conceptIds: note.conceptIds.filter((id) => id !== concept.id),
      updatedAt: now
    });
    notesUpdated += 1;
  }

  const relations = await vault.stores.relations.list();
  for (const relation of relations) {
    const touchesConcept =
      (relation.from.type === "concept" && relation.from.id === concept.id) ||
      (relation.to.type === "concept" && relation.to.id === concept.id);
    if (!touchesConcept) continue;
    if (await vault.stores.relations.delete(relation.id)) relationsRemoved += 1;
  }

  await vault.stores.concepts.delete(concept.id);
  return { ok: true as const, deletedConceptId: concept.id, notesUpdated, relationsRemoved };
}

export async function mergeConcept({ vault }: ConceptsDeps, input: { conceptId: string } & MergeConceptInput) {
  if (input.conceptId === input.targetConceptId) {
    throw new ValidationError("Cannot merge a concept into itself");
  }
  const [source, target] = await Promise.all([
    vault.stores.concepts.get(input.conceptId),
    vault.stores.concepts.get(input.targetConceptId)
  ]);
  if (!source || !target) throw new NotFoundError("Concept not found");

  const now = new Date().toISOString();
  let notesUpdated = 0;
  let relationsUpdated = 0;
  let relationsRemoved = 0;

  const merged = conceptSchema.parse({
    ...target,
    aliases: uniqStrings([...target.aliases, source.name, ...source.aliases]).filter(
      (alias) => alias.toLocaleLowerCase() !== target.name.toLocaleLowerCase()
    ),
    description: target.description || source.description,
    tags: uniqStrings([...target.tags, ...source.tags]),
    confidence: target.confidence ?? source.confidence,
    updatedAt: now
  });

  const notes = await vault.stores.notes.list();
  for (const note of notes) {
    if (!note.conceptIds.includes(source.id)) continue;
    const conceptIds = Array.from(new Set(note.conceptIds.map((id) => (id === source.id ? target.id : id))));
    await vault.stores.notes.upsert({ ...note, conceptIds, updatedAt: now });
    notesUpdated += 1;
  }

  const relationKey = (relation: RelationRecord) =>
    `${relation.from.type}:${relation.from.id}->${relation.to.type}:${relation.to.id}:${relation.relationKind}:${relation.label ?? ""}`;
  const seen = new Set((await vault.stores.relations.list()).map((relation) => relationKey(relation)));
  const relations = await vault.stores.relations.list();
  for (const relation of relations) {
    const touchesSource =
      (relation.from.type === "concept" && relation.from.id === source.id) ||
      (relation.to.type === "concept" && relation.to.id === source.id);
    if (!touchesSource) continue;
    seen.delete(relationKey(relation));
    const from = relation.from.type === "concept" && relation.from.id === source.id ? { ...relation.from, id: target.id } : relation.from;
    const to = relation.to.type === "concept" && relation.to.id === source.id ? { ...relation.to, id: target.id } : relation.to;
    if (from.type === "concept" && to.type === "concept" && from.id === to.id) {
      if (await vault.stores.relations.delete(relation.id)) relationsRemoved += 1;
      continue;
    }
    const updated = relationSchema.parse({ ...relation, from, to, updatedAt: now });
    const key = relationKey(updated);
    if (seen.has(key)) {
      if (await vault.stores.relations.delete(relation.id)) relationsRemoved += 1;
      continue;
    }
    seen.add(key);
    await vault.stores.relations.upsert(updated);
    relationsUpdated += 1;
  }

  await vault.stores.concepts.upsert(merged);
  await vault.stores.concepts.delete(source.id);
  return { concept: merged, mergedFrom: source.id, notesUpdated, relationsUpdated, relationsRemoved };
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
