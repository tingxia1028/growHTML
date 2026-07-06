// CG-1/CG-2 server acceptance — the graph service over a REAL (temp) vault, driven
// through the same services the routes wrap (X0 idiom, no HTTP):
//   • wiki-link capture: createNote("… [[X]] … [[Y]] …") creates-or-matches concepts
//     and the SAME note's conceptIds feed a derived co-occurrence edge — capture as
//     byproduct, graph alive with zero extra user work.
//   • delete/merge (Codex's concept routes) are REFLECTED on the next derivation —
//     no ghost nodes, edges re-pointed — because the graph is never stored.
//   • neighborhood + sourceId scoping + the typed 404.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEntityId } from "../../core/ids";
import { type StudyVault } from "../../core/vault";
import { openTestVault } from "../../core/testing/openTestVault";
import { installServerKits } from "../../kits/server";
import { NotFoundError } from "./errors";
import * as conceptsService from "./concepts";
import * as notesService from "./notes";
import { getConceptGraph, graphQuerySchema } from "./graph";

installServerKits();

let tempDir = "";
let vault: StudyVault;

const query = (raw: Record<string, string> = {}) => graphQuerySchema.parse(raw);

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "study-vault-graph-"));
  vault = await openTestVault({ rootDir: tempDir });
});

afterEach(async () => {
  vault?.close(); // STORE-SQL Stage-3: release sqlite handles before rm (no-op on jsonl)
  await rm(tempDir, { recursive: true, force: true });
});

describe("getConceptGraph over a live vault", () => {
  it("derives nodes from concepts and a co-occurrence edge from a wiki-linked note", async () => {
    // CG-2 seam: the note TEXT is the only input — both concepts + the edge follow.
    await notesService.createNote(
      { vault },
      notesService.createNoteRequestSchema.parse({
        contentType: "markdown",
        content: "浮力与 [[阿基米德原理]] 相关，也依赖 [[密度]]。"
      })
    );

    const graph = await getConceptGraph({ vault }, query());
    expect(graph.nodes.map((node) => node.name).sort()).toEqual(["密度", "阿基米德原理"].sort());
    expect(graph.nodes.every((node) => node.noteCount === 1)).toBe(true);
    const edge = graph.edges.find((candidate) => candidate.kind === "cooccurrence");
    expect(edge?.basis?.note).toBe(1);
    expect(graph.meta.conceptCount).toBe(2);

    // Same-named wiki link on a SECOND note links (create-or-match), not duplicates.
    await notesService.createNote(
      { vault },
      notesService.createNoteRequestSchema.parse({
        contentType: "markdown",
        content: "再谈 [[密度]] 与 [[压强]]"
      })
    );
    const after = await getConceptGraph({ vault }, query());
    expect(after.meta.conceptCount).toBe(3);
    const density = after.nodes.find((node) => node.name === "密度");
    expect(density?.noteCount).toBe(2);
    expect(density?.degree).toBe(2);
  });

  it("reflects concept DELETE on the next derivation (no ghost node, edges gone)", async () => {
    const [a, b] = await conceptsService.ensureConceptsByName({ vault }, ["Render Thread", "Game Thread"]);
    await conceptsService.createRelation(
      { vault },
      conceptsService.createRelationRequestSchema.parse({
        from: { type: "concept", id: a.id },
        to: { type: "concept", id: b.id },
        relationKind: "related"
      })
    );
    expect((await getConceptGraph({ vault }, query())).edges).toHaveLength(1);

    await conceptsService.deleteConcept({ vault }, { conceptId: b.id });
    const graph = await getConceptGraph({ vault }, query());
    expect(graph.nodes.map((node) => node.id)).toEqual([a.id]);
    expect(graph.edges).toEqual([]);
  });

  it("reflects concept MERGE: edges re-point to the target, source node disappears", async () => {
    const [a, b, c] = await conceptsService.ensureConceptsByName({ vault }, ["Alpha", "Beta", "Gamma"]);
    await conceptsService.createRelation(
      { vault },
      conceptsService.createRelationRequestSchema.parse({
        from: { type: "concept", id: b.id },
        to: { type: "concept", id: c.id },
        relationKind: "related"
      })
    );
    await conceptsService.mergeConcept({ vault }, { conceptId: b.id, targetConceptId: a.id });

    const graph = await getConceptGraph({ vault }, query());
    expect(graph.nodes.map((node) => node.id).sort()).toEqual([a.id, c.id].sort());
    const stored = graph.edges.filter((edge) => edge.kind === "stored");
    expect(stored).toHaveLength(1);
    expect([stored[0].source, stored[0].target].sort()).toEqual([a.id, c.id].sort());
  });

  it("answers the inspector's neighborhood query and scopes by source", async () => {
    // Two sources: sourceOne carries A+B (co-occurring note), sourceTwo carries C.
    const sourceOne = createEntityId("source");
    const sourceTwo = createEntityId("source");
    const [a, b, c] = await conceptsService.ensureConceptsByName({ vault }, ["A", "B", "C"]);
    await notesService.createNote(
      { vault },
      notesService.createNoteRequestSchema.parse({
        contentType: "markdown",
        content: "ab note",
        conceptIds: [a.id, b.id],
        // No such source record is needed — the note carries the id, derivation
        // groups by it (the layer default only applies to real sources).
        sourceId: sourceOne
      })
    );
    await notesService.createNote(
      { vault },
      notesService.createNoteRequestSchema.parse({
        contentType: "markdown",
        content: "c note",
        conceptIds: [c.id],
        sourceId: sourceTwo
      })
    );

    // Neighborhood around A at depth 1: A + B only (C is unreachable).
    const hood = await getConceptGraph({ vault }, query({ conceptId: a.id, depth: "1" }));
    expect(hood.nodes.map((node) => node.id).sort()).toEqual([a.id, b.id].sort());
    expect(hood.meta.scope).toEqual({ conceptId: a.id, depth: 1 });

    // Source scope: only sourceOne's notes feed counts/edges; C's node stays but empty.
    const scoped = await getConceptGraph({ vault }, query({ sourceId: sourceOne }));
    const cNode = scoped.nodes.find((node) => node.id === c.id);
    expect(cNode?.noteCount).toBe(0);
    expect(scoped.edges.some((edge) => edge.source === c.id || edge.target === c.id)).toBe(false);

    // Unknown concept → typed 404 (NotFoundError at the transport edge).
    await expect(getConceptGraph({ vault }, query({ conceptId: "concept_missing" }))).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});

describe("ensureConceptsByName", () => {
  it("dedupes by the shared normalized-name identity and returns input order", async () => {
    const first = await conceptsService.ensureConceptsByName({ vault }, ["Render  Thread", "render thread", "GPU"]);
    expect(first.map((concept) => concept.name)).toEqual(["Render Thread", "GPU"]);
    const again = await conceptsService.ensureConceptsByName({ vault }, ["RENDER THREAD"]);
    expect(again[0].id).toBe(first[0].id);
    expect(await vault.stores.concepts.list()).toHaveLength(2);
  });
});
