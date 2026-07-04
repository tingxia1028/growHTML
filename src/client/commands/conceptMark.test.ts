// CONCEPT-UX-1 选中即建概念 — the concept.mark-selection command. One click on the
// selection toolbar must: name a concept from the selected text (collapsed, ~40-char
// cap), DEDUPE by normalized name (link, never duplicate), and link the passage via
// the EXISTING storage path — ONE marker note carrying anchorIds + conceptIds (there
// is no anchor.conceptIds; concept back-refs join over notes).

import { describe, expect, it, vi } from "vitest";
import { getCommand, runCommand, type CommandContext } from "./registry";
import type { AnyAnchor, ConceptRecord } from "../data/entityClient";
import type { FocusContextValue } from "../focus/FocusContext";

const anchor: AnyAnchor = {
  id: "anchor_1",
  sourceId: "src_1",
  anchorKind: "html_selection",
  studyId: "p1",
  selector: '[data-study-id="p1"]',
  quote: "passage"
};

function fakeFocus(over: Partial<FocusContextValue> = {}): FocusContextValue {
  return {
    focus: { type: "anchor-draft", draft: { mode: "quote", sourceId: "src_1", kind: "html", quote: "passage" } },
    draft: { mode: "quote", sourceId: "src_1", kind: "html", quote: "passage" },
    anchor: null,
    revealSeq: 0,
    setFocus: vi.fn(),
    setDraft: vi.fn(),
    setAnchor: vi.fn(),
    clear: vi.fn(),
    materializeAnchor: vi.fn(async () => anchor),
    ...over
  };
}

function concept(id: string, name: string): ConceptRecord {
  return { id, name, aliases: [], description: "", tags: [] };
}

function baseCtx(over: Partial<CommandContext> = {}, existingConcepts: ConceptRecord[] = []): CommandContext {
  return {
    focus: fakeFocus(),
    client: {
      createNote: vi.fn(async (input: unknown) => ({ note: { id: "note_1", ...(input as object) } as never })),
      createPatch: vi.fn(),
      chat: vi.fn(),
      concepts: vi.fn(async () => ({ concepts: existingConcepts })),
      createConcept: vi.fn(async (input: { name: string }) => ({ concept: concept("concept_new", input.name) })),
      updateNote: vi.fn(),
      createRelation: vi.fn(),
      patchLayer: vi.fn(),
      createLayer: vi.fn(),
      deleteLayer: vi.fn(),
      generateStructured: vi.fn(),
      generateBlock: vi.fn(),
      notes: vi.fn(async () => ({ notes: [] as never })),
      deleteNote: vi.fn(async () => ({ ok: true as const }))
    } as unknown as CommandContext["client"],
    sourceId: "src_1",
    payload: {},
    actions: {},
    ...over
  };
}

describe("command: concept.mark-selection", () => {
  it("creates a concept named from the selection and links the anchor via ONE marker note", async () => {
    const onConceptMarked = vi.fn();
    const onConceptChanged = vi.fn();
    const onNoteCreated = vi.fn();
    const ctx = baseCtx({ actions: { onConceptMarked, onConceptChanged, onNoteCreated } });

    const ran = await runCommand("concept.mark-selection", ctx);

    expect(ran).toBe(true);
    expect(ctx.focus.materializeAnchor).toHaveBeenCalledOnce();
    expect(ctx.client.createConcept).toHaveBeenCalledWith({ name: "passage" });
    // The link artifact: a marker note carrying BOTH the anchor and the concept —
    // the existing note.conceptIds storage path.
    expect(ctx.client.createNote).toHaveBeenCalledWith({
      sourceId: "src_1",
      anchorIds: ["anchor_1"],
      conceptIds: ["concept_new"],
      contentType: "markdown",
      content: "passage"
    });
    expect(onConceptMarked).toHaveBeenCalledWith(
      expect.objectContaining({ linkedExisting: false, concept: expect.objectContaining({ id: "concept_new" }) })
    );
    expect(onConceptChanged).toHaveBeenCalledOnce();
    expect(onNoteCreated).toHaveBeenCalledOnce();
  });

  it("DEDUPES by normalized name: an existing concept (case/whitespace-insensitive) is linked, not duplicated", async () => {
    const onConceptMarked = vi.fn();
    const existing = concept("concept_x", "  PASSAGE ");
    const ctx = baseCtx({ actions: { onConceptMarked } }, [existing]);

    await runCommand("concept.mark-selection", ctx);

    expect(ctx.client.createConcept).not.toHaveBeenCalled();
    expect(ctx.client.createNote).toHaveBeenCalledWith(
      expect.objectContaining({ conceptIds: ["concept_x"] })
    );
    expect(onConceptMarked).toHaveBeenCalledWith(
      expect.objectContaining({ linkedExisting: true, concept: existing })
    );
  });

  it("caps the concept name at 40 chars (collapsed whitespace first)", async () => {
    const longQuote = "alpha  beta   gamma delta epsilon zeta eta theta iota kappa";
    const ctx = baseCtx({
      focus: fakeFocus({
        focus: { type: "anchor-draft", draft: { mode: "quote", sourceId: "src_1", kind: "html", quote: longQuote } },
        draft: { mode: "quote", sourceId: "src_1", kind: "html", quote: longQuote }
      })
    });

    await runCommand("concept.mark-selection", ctx);

    const createConcept = ctx.client.createConcept as ReturnType<typeof vi.fn>;
    const name = createConcept.mock.calls[0][0].name as string;
    expect(name.length).toBeLessThanOrEqual(40);
    expect(name).toBe("alpha beta gamma delta epsilon zeta eta".slice(0, 40).trim());
    // The marker note keeps the FULL collapsed quote (the name cap is name-only).
    expect(ctx.client.createNote).toHaveBeenCalledWith(
      expect.objectContaining({ content: "alpha beta gamma delta epsilon zeta eta theta iota kappa" })
    );
  });

  it("is unavailable for a REGION draft (no text → no name to build)", () => {
    const ctx = baseCtx({
      focus: fakeFocus({
        focus: { type: "anchor-draft", draft: { mode: "region", sourceId: "src_1", kind: "image", rect: [0, 0, 1, 1] } },
        draft: { mode: "region", sourceId: "src_1", kind: "image", rect: [0, 0, 1, 1] }
      })
    });
    expect(getCommand("concept.mark-selection")!.isAvailable(ctx)).toBe(false);
  });

  it("is unavailable with no passage in focus at all", () => {
    const ctx = baseCtx({ focus: fakeFocus({ focus: null, draft: null }) });
    expect(getCommand("concept.mark-selection")!.isAvailable(ctx)).toBe(false);
  });

  it("without a wired `concepts` read it still creates (dedupe simply skipped)", async () => {
    const ctx = baseCtx();
    delete (ctx.client as { concepts?: unknown }).concepts;
    await runCommand("concept.mark-selection", ctx);
    expect(ctx.client.createConcept).toHaveBeenCalledWith({ name: "passage" });
  });
});
