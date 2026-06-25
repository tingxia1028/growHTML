// Textbook Kit commands — AI actions that turn the focused passage into a Study
// Block. They follow the EXACT pattern of the built-in `anchor.add-note`:
// materialize the focus into an anchor, produce content, create a note. The only
// extra step is `client.generateStructured` (server-side AI → schema-valid object).
//
// These are host Commands; the kit registers them via KitInstallContext.commands,
// which wires them into the CommandRegistry (see src/kits/clientContext).

import type { Command, CommandContext } from "../../client/commands/registry";

// The text the AI reasons over: the materialized anchor's quote, falling back to
// the chat context quote (region selections have no quote).
function anchorText(ctx: CommandContext, fallback: string): string {
  return (ctx.focus.anchor?.quote || ctx.chatContext?.quote || fallback || "").trim();
}

// Shared body: ensure an anchor, generate structured content for `contentType`
// from `promptId`, save it as a note anchored to the passage.
async function generateBlock(
  ctx: CommandContext,
  promptId: string,
  contentType: string,
  extraInput: Record<string, unknown> = {}
): Promise<void> {
  const anchor = await ctx.focus.materializeAnchor();
  const text = anchorText(ctx, anchor?.quote ?? "");
  const { content } = await ctx.client.generateStructured({
    promptId,
    contentType,
    input: { anchorText: text, ...extraInput }
  });
  const { note } = await ctx.client.createNote({
    sourceId: ctx.sourceId,
    anchorIds: anchor ? [anchor.id] : [],
    contentType,
    content
  });
  ctx.actions.onNoteCreated?.(note);
}

// Available whenever there is a passage in focus (a saved anchor or a fresh draft).
const hasPassage = (ctx: CommandContext): boolean => !!ctx.focus.anchor || !!ctx.focus.draft;

export const explainConceptCommand: Command = {
  id: "textbook.explain-concept",
  title: "Explain",
  group: "textbook",
  isAvailable: hasPassage,
  run: (ctx) => generateBlock(ctx, "textbook.explain-concept", "textbook.explanation")
};

export const generatePracticeCommand: Command = {
  id: "textbook.generate-practice",
  title: "Generate Practice",
  group: "textbook",
  isAvailable: hasPassage,
  run: (ctx) => generateBlock(ctx, "textbook.generate-practice", "textbook.exercise")
};

export const markAsMistakeCommand: Command = {
  id: "textbook.mark-as-mistake",
  title: "Mark as Mistake",
  group: "textbook",
  isAvailable: hasPassage,
  run: (ctx) => generateBlock(ctx, "textbook.mark-as-mistake", "textbook.mistake")
};

// Review Pack is SOURCE-level (user spec §16 step 4): it synthesizes the source's
// Explanation + Mistake blocks into one revision pack, so it needs an active source
// (not a passage) and gathers the existing study blocks itself.
export const generateReviewPackCommand: Command = {
  id: "textbook.generate-review-pack",
  title: "Generate Review Pack",
  group: "textbook",
  isAvailable: (ctx) => !!ctx.sourceId,
  run: async (ctx) => {
    const sourceId = ctx.sourceId;
    if (!sourceId) return;
    const { notes } = await ctx.client.notes(sourceId);
    const explanations = notes.filter((n) => n.contentType === "textbook.explanation").map((n) => n.content);
    const mistakes = notes.filter((n) => n.contentType === "textbook.mistake").map((n) => n.content);
    const { content } = await ctx.client.generateStructured({
      promptId: "textbook.generate-review-pack",
      contentType: "textbook.review-pack",
      input: { sourceId, sourceTitle: ctx.chatContext?.sourceTitle, explanations, mistakes }
    });
    const { note } = await ctx.client.createNote({
      sourceId,
      anchorIds: [],
      contentType: "textbook.review-pack",
      content
    });
    ctx.actions.onNoteCreated?.(note);
  }
};

export const textbookCommands: Command[] = [
  explainConceptCommand,
  generatePracticeCommand,
  markAsMistakeCommand,
  generateReviewPackCommand
];
