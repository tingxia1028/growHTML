// Subject kit commands — one AI generation command per M-B exemplar type, following
// the EXACT textbook pattern (src/kits/textbook-learning/commands.ts): materialize the
// focused passage into an anchor → server-side structured generation against the
// type's core schema → hand the draft to the preview stage when the host wired
// onGenerated (only Save persists), else the legacy auto-save. The produced content
// always lands on a REGISTERED `subject.*` contentType, so display flows through
// getNoteType().render like every other note (the adaptive-note mandatory contract).

import type { Command, CommandContext } from "../../client/commands/registry";

function anchorText(ctx: CommandContext, fallback: string): string {
  return (ctx.focus.anchor?.quote || ctx.chatContext?.quote || fallback || "").trim();
}

async function generateSubjectNote(ctx: CommandContext, promptId: string, contentType: string): Promise<void> {
  const anchor = await ctx.focus.materializeAnchor();
  const text = anchorText(ctx, anchor?.quote ?? "");
  const input = { anchorText: text };
  const { content } = await ctx.client.generateStructured({ promptId, contentType, input });
  if (ctx.actions.onGenerated) {
    ctx.actions.onGenerated({ promptId, contentType, input, content, anchorId: anchor?.id, sourceId: ctx.sourceId });
    return;
  }
  const { note } = await ctx.client.createNote({
    sourceId: ctx.sourceId,
    anchorIds: anchor ? [anchor.id] : [],
    contentType,
    content
  });
  ctx.actions.onNoteCreated?.(note);
}

const hasPassage = (ctx: CommandContext): boolean => !!ctx.focus.anchor || !!ctx.focus.draft;

export const generateVocabCommand: Command = {
  id: "subject.generate-vocab",
  title: "生词卡",
  group: "subject",
  isAvailable: hasPassage,
  run: (ctx) => generateSubjectNote(ctx, "subject.generate-vocab", "subject.vocab")
};

export const generateFormulaCommand: Command = {
  id: "subject.generate-formula",
  title: "公式卡",
  group: "subject",
  isAvailable: hasPassage,
  run: (ctx) => generateSubjectNote(ctx, "subject.generate-formula", "subject.formula")
};

export const generateTimelineCommand: Command = {
  id: "subject.generate-timeline",
  title: "时间线",
  group: "subject",
  isAvailable: hasPassage,
  run: (ctx) => generateSubjectNote(ctx, "subject.generate-timeline", "subject.timeline")
};

// —— M-C commands (one per remaining type) ————————————————————————————————————

export const generateDerivationCommand: Command = {
  id: "subject.generate-derivation",
  title: "推导步骤",
  group: "subject",
  isAvailable: hasPassage,
  run: (ctx) => generateSubjectNote(ctx, "subject.generate-derivation", "subject.derivation")
};

export const generateTheoremCommand: Command = {
  id: "subject.generate-theorem",
  title: "定理卡",
  group: "subject",
  isAvailable: hasPassage,
  run: (ctx) => generateSubjectNote(ctx, "subject.generate-theorem", "subject.theorem")
};

export const generateGrammarCommand: Command = {
  id: "subject.generate-grammar",
  title: "语法点",
  group: "subject",
  isAvailable: hasPassage,
  run: (ctx) => generateSubjectNote(ctx, "subject.generate-grammar", "subject.grammar")
};

export const generateExcerptCommand: Command = {
  id: "subject.generate-excerpt",
  title: "摘抄赏析",
  group: "subject",
  isAvailable: hasPassage,
  run: (ctx) => generateSubjectNote(ctx, "subject.generate-excerpt", "subject.excerpt")
};

export const generateArgumentCommand: Command = {
  id: "subject.generate-argument",
  title: "论证结构",
  group: "subject",
  isAvailable: hasPassage,
  run: (ctx) => generateSubjectNote(ctx, "subject.generate-argument", "subject.argument")
};

export const generateFigureCommand: Command = {
  id: "subject.generate-figure",
  title: "人物卡",
  group: "subject",
  isAvailable: hasPassage,
  run: (ctx) => generateSubjectNote(ctx, "subject.generate-figure", "subject.figure")
};

export const generateCauseEffectCommand: Command = {
  id: "subject.generate-cause-effect",
  title: "因果链",
  group: "subject",
  isAvailable: hasPassage,
  run: (ctx) => generateSubjectNote(ctx, "subject.generate-cause-effect", "subject.cause-effect")
};

export const generateExperimentCommand: Command = {
  id: "subject.generate-experiment",
  title: "实验记录",
  group: "subject",
  isAvailable: hasPassage,
  run: (ctx) => generateSubjectNote(ctx, "subject.generate-experiment", "subject.experiment")
};
