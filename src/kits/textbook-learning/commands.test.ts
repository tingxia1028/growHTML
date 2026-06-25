import { describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../../client/commands/registry";
import type { AnyAnchor } from "../../client/data/entityClient";
import type { FocusContextValue } from "../../client/focus/FocusContext";
import {
  explainConceptCommand,
  generatePracticeCommand,
  generateReviewPackCommand,
  markAsMistakeCommand
} from "./commands";

const anchor: AnyAnchor = {
  id: "anchor_1",
  sourceId: "src_1",
  anchorKind: "html_selection",
  studyId: "p1",
  selector: '[data-study-id="p1"]',
  quote: "the cell membrane controls what enters"
};

function fakeFocus(over: Partial<FocusContextValue> = {}): FocusContextValue {
  return {
    focus: { type: "anchor", anchorId: "anchor_1" },
    draft: null,
    anchor,
    setFocus: vi.fn(),
    setDraft: vi.fn(),
    setAnchor: vi.fn(),
    clear: vi.fn(),
    materializeAnchor: vi.fn(async () => anchor),
    ...over
  };
}

function ctx(over: Partial<CommandContext> = {}): CommandContext {
  const generateStructured = vi.fn(async ({ contentType }: { contentType: string }) => ({
    content: { __type: contentType },
    provider: "mock"
  }));
  const createNote = vi.fn(async () => ({ note: { id: "note_1" } as never }));
  return {
    focus: fakeFocus(),
    client: {
      createNote,
      createPatch: vi.fn(),
      chat: vi.fn(),
      createConcept: vi.fn(),
      updateNote: vi.fn(),
      createRelation: vi.fn(),
      patchLayer: vi.fn(),
      generateStructured,
      notes: vi.fn(async () => ({
        notes: [
          { id: "n1", contentType: "textbook.explanation", content: { title: "E" }, anchorIds: [], conceptIds: [], visibility: "private" },
          { id: "n2", contentType: "textbook.mistake", content: { question: "Q" }, anchorIds: [], conceptIds: [], visibility: "private" },
          { id: "n3", contentType: "markdown", content: "x", anchorIds: [], conceptIds: [], visibility: "private" }
        ]
      }))
    } as unknown as CommandContext["client"],
    sourceId: "src_1",
    payload: {},
    actions: {},
    ...over
  };
}

describe("textbook commands", () => {
  it("explain: generates an explanation block from the focused passage and saves it anchored", async () => {
    const onNoteCreated = vi.fn();
    const c = ctx({ actions: { onNoteCreated } });
    expect(explainConceptCommand.isAvailable(c)).toBe(true);
    await explainConceptCommand.run(c);

    expect(c.focus.materializeAnchor).toHaveBeenCalled();
    expect(c.client.generateStructured).toHaveBeenCalledWith(
      expect.objectContaining({
        promptId: "textbook.explain-concept",
        contentType: "textbook.explanation",
        input: expect.objectContaining({ anchorText: anchor.quote })
      })
    );
    expect(c.client.createNote).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: "src_1",
        anchorIds: ["anchor_1"],
        contentType: "textbook.explanation",
        content: { __type: "textbook.explanation" }
      })
    );
    expect(onNoteCreated).toHaveBeenCalled();
  });

  it("practice + mistake target their own content types", async () => {
    const cp = ctx();
    await generatePracticeCommand.run(cp);
    expect(cp.client.createNote).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: "textbook.exercise" })
    );

    const cm = ctx();
    await markAsMistakeCommand.run(cm);
    expect(cm.client.createNote).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: "textbook.mistake" })
    );
  });

  it("is unavailable with no passage in focus", async () => {
    const c = ctx({ focus: fakeFocus({ focus: null, anchor: null, draft: null }) });
    expect(explainConceptCommand.isAvailable(c)).toBe(false);
    expect(generatePracticeCommand.isAvailable(c)).toBe(false);
    expect(markAsMistakeCommand.isAvailable(c)).toBe(false);
  });

  it("review pack: gathers the source's explanation+mistake blocks and saves a source-level pack", async () => {
    const c = ctx();
    expect(generateReviewPackCommand.isAvailable(c)).toBe(true);
    await generateReviewPackCommand.run(c);

    expect(c.client.notes).toHaveBeenCalledWith("src_1");
    expect(c.client.generateStructured).toHaveBeenCalledWith(
      expect.objectContaining({
        promptId: "textbook.generate-review-pack",
        contentType: "textbook.review-pack",
        input: expect.objectContaining({
          sourceId: "src_1",
          explanations: [{ title: "E" }],
          mistakes: [{ question: "Q" }]
        })
      })
    );
    expect(c.client.createNote).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "src_1", anchorIds: [], contentType: "textbook.review-pack" })
    );
  });

  it("review pack is unavailable with no active source", () => {
    expect(generateReviewPackCommand.isAvailable(ctx({ sourceId: undefined }))).toBe(false);
  });
});
