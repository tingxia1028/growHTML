// CG-2 "AI 顺手挂" save half — anchor.add-note with payload.conceptNames:
//   • create-or-match by the shared normalized-name identity (existing name LINKS)
//   • the note is born with the resolved conceptIds
//   • pairwise same_topic relations land with AI_TAG_CONFIDENCE, deduped against
//     existing ones (either direction)
//   • no names ⇒ the pre-CG-2 path byte-for-byte (no concept reads/writes)
// operation.run's auto-save fallback rides the same helper when the server response
// carries `concepts`.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FocusContextValue } from "../focus/FocusContext";
import { AI_TAG_CONFIDENCE, runCommand, type CommandContext } from "./registry";

type AnyRecord = Record<string, unknown>;

function makeCtx(overrides: Partial<CommandContext["payload"]> = {}, relations: AnyRecord[] = []) {
  let conceptSeq = 0;
  const existingConcepts: Array<{ id: string; name: string; aliases: string[]; description: string; tags: string[] }> =
    [{ id: "concept_existing", name: "Render Thread", aliases: [], description: "", tags: [] }];
  const created: AnyRecord[] = [];
  const createdRelations: AnyRecord[] = [];
  const notes: AnyRecord[] = [];
  const actions = { onNoteCreated: vi.fn(), onConceptChanged: vi.fn() };

  const ctx: CommandContext = {
    focus: {
      anchor: null,
      draft: null,
      materializeAnchor: vi.fn(async () => null)
    } as unknown as FocusContextValue,
    client: {
      createNote: vi.fn(async (input: AnyRecord) => {
        const note = { id: `note_${notes.length + 1}`, anchorIds: [], conceptIds: [], layerIds: [], ...input };
        notes.push(note);
        return { note };
      }),
      createConcept: vi.fn(async ({ name }: { name: string }) => {
        conceptSeq += 1;
        const concept = { id: `concept_new_${conceptSeq}`, name, aliases: [], description: "", tags: [] };
        existingConcepts.push(concept);
        created.push(concept);
        return { concept };
      }),
      concepts: vi.fn(async () => ({ concepts: existingConcepts })),
      relations: vi.fn(async () => ({ relations })),
      createRelation: vi.fn(async (input: AnyRecord) => {
        createdRelations.push(input);
        return { relation: { id: `relation_${createdRelations.length}`, ...input } };
      }),
      // Unused by these paths but demanded by the client Pick.
      createPatch: vi.fn(),
      chat: vi.fn(),
      updateNote: vi.fn(),
      patchLayer: vi.fn(),
      createLayer: vi.fn(),
      deleteLayer: vi.fn(),
      generateStructured: vi.fn(),
      generateBlock: vi.fn(),
      notes: vi.fn(async () => ({ notes: [] })),
      deleteNote: vi.fn()
    } as unknown as CommandContext["client"],
    // add-note availability needs a source (or a focused passage).
    sourceId: "source_1",
    payload: { text: "the note body", ...overrides },
    actions
  };
  return { ctx, created, createdRelations, notes, actions };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("anchor.add-note conceptNames (CG-2 auto-tag)", () => {
  it("creates-or-matches names, links the note, and lays same_topic edges", async () => {
    const { ctx, created, createdRelations, notes, actions } = makeCtx({
      conceptNames: ["render thread", "GPU Pipeline"]
    });
    const ran = await runCommand("anchor.add-note", ctx);
    expect(ran).toBe(true);

    // "render thread" matched the EXISTING concept (normalized identity); only
    // "GPU Pipeline" was created.
    expect(created.map((concept) => concept.name)).toEqual(["GPU Pipeline"]);
    expect(notes[0].conceptIds).toEqual(["concept_existing", "concept_new_1"]);

    // One pairwise same_topic edge with the AI confidence stamp.
    expect(createdRelations).toHaveLength(1);
    expect(createdRelations[0]).toMatchObject({
      relationKind: "same_topic",
      confidence: AI_TAG_CONFIDENCE,
      from: { type: "concept", id: "concept_existing" },
      to: { type: "concept", id: "concept_new_1" }
    });
    expect(actions.onConceptChanged).toHaveBeenCalled();
    expect(actions.onNoteCreated).toHaveBeenCalled();
  });

  it("dedupes within the batch and against existing same_topic edges (either direction)", async () => {
    const existingEdge = {
      id: "relation_x",
      relationKind: "same_topic",
      from: { type: "concept", id: "concept_new_1" },
      to: { type: "concept", id: "concept_existing" }
    };
    const { ctx, createdRelations, notes } = makeCtx(
      { conceptNames: ["Alpha", "alpha", " ALPHA ", "Render Thread"] },
      [existingEdge]
    );
    await runCommand("anchor.add-note", ctx);
    // Batch dedupe: Alpha resolved once → concept_new_1; note links exactly two.
    expect(notes[0].conceptIds).toEqual(["concept_new_1", "concept_existing"]);
    // The reversed-direction existing edge suppressed the duplicate.
    expect(createdRelations).toHaveLength(0);
  });

  it("no conceptNames ⇒ the legacy path: no concept reads or writes at all", async () => {
    const { ctx, createdRelations, notes, actions } = makeCtx();
    await runCommand("anchor.add-note", ctx);
    expect(notes[0].conceptIds).toBeUndefined();
    expect(createdRelations).toHaveLength(0);
    expect((ctx.client.createConcept as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(actions.onConceptChanged).not.toHaveBeenCalled();
  });

  it("operation.run auto-save fallback links the response's suggested concepts", async () => {
    const { ctx, notes, createdRelations } = makeCtx({
      operationId: "op_x",
      outputType: "markdown",
      scope: "source",
      text: undefined
    });
    (ctx.client.generateStructured as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: "generated body",
      contentType: "markdown",
      provider: "mock",
      concepts: ["浮力", "密度"]
    });
    const ran = await runCommand("operation.run", ctx);
    expect(ran).toBe(true);
    expect(notes[0].conceptIds).toEqual(["concept_new_1", "concept_new_2"]);
    expect(createdRelations).toHaveLength(1);
    expect(createdRelations[0]).toMatchObject({ relationKind: "same_topic", confidence: AI_TAG_CONFIDENCE });
  });
});
