// Concept-graph domain service (CG-1) — the transport-agnostic wrapper over the
// CORE engine (src/core/graph/conceptGraph): feed it vault truth, return the derived
// graph. Wired identically by `GET /api/graph` (app.ts) and the direct transport, so
// mobile assembles the same graph (X0 idiom). No persistence — the graph is always
// derived, so concept delete/merge (Codex's routes) are reflected on the next read.
//
// Query surface:
//   • (none)              → the FULL graph (nodes = every concept).
//   • conceptId [+depth]  → the BFS neighborhood around one concept — the
//                           inspector's degree/neighborhood query (depth 1–3).
//   • sourceId            → derive over ONLY that source's notes (the graph "as
//                           seen from this document"); concepts keep global
//                           note-counts semantics within the filtered note set.

import { z } from "zod";
import {
  deriveConceptGraph,
  graphNeighborhood,
  type ConceptGraph
} from "../../core/graph/conceptGraph";
import type { StudyVault } from "../../core/vault";
import type { SealedRuntime } from "../svpack";
import { NotFoundError } from "./errors";

export type GraphDeps = {
  vault: StudyVault;
  /** Optional: sealed (svpack) notes ride into derivation like listNotes merges them. */
  sealed?: SealedRuntime;
};

export const graphQuerySchema = z.object({
  conceptId: z.string().min(1).optional(),
  /** Neighborhood radius when conceptId is present (ignored otherwise). */
  depth: z.coerce.number().int().min(1).max(3).default(1),
  sourceId: z.string().min(1).optional()
});
export type GraphQueryInput = z.infer<typeof graphQuerySchema>;

export type ConceptGraphResponse = ConceptGraph & {
  meta: {
    conceptCount: number;
    noteCount: number;
    relationCount: number;
    /** Echo of the applied scope, so clients can label the view. */
    scope: { conceptId?: string; depth?: number; sourceId?: string };
  };
};

/** Assemble the concept graph from vault truth (+ sealed notes when wired). */
export async function getConceptGraph(
  { vault, sealed }: GraphDeps,
  input: GraphQueryInput
): Promise<ConceptGraphResponse> {
  const [concepts, storedNotes, relations] = await Promise.all([
    vault.stores.concepts.list(),
    vault.stores.notes.list(),
    vault.stores.relations.list()
  ]);
  // Sealed notes count too (read-model merge parity with listNotes): their concept
  // links exist and should size/connect nodes like any other note's.
  let notes = sealed ? [...storedNotes, ...sealed.snapshot().notes] : storedNotes;
  if (input.sourceId) notes = notes.filter((note) => note.sourceId === input.sourceId);

  let graph = deriveConceptGraph({ concepts, notes, relations });
  if (input.conceptId) {
    if (!concepts.some((concept) => concept.id === input.conceptId)) {
      throw new NotFoundError("Concept not found");
    }
    graph = graphNeighborhood(graph, input.conceptId, input.depth);
  }

  return {
    ...graph,
    meta: {
      conceptCount: concepts.length,
      noteCount: notes.length,
      relationCount: relations.length,
      scope: {
        ...(input.conceptId ? { conceptId: input.conceptId, depth: input.depth } : {}),
        ...(input.sourceId ? { sourceId: input.sourceId } : {})
      }
    }
  };
}
