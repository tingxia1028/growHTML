// Textbook Learning Kit — the ProductKit. Registers ONLY (no core changes):
// - 3 Study Block note types (Explanation / Practice / Mistake) + domain language
// - 3 AI commands (explain / generate-practice / mark-as-mistake) + their prompts
// - selection-toolbar contributions (the textbook learning loop)
// Views / layouts land in phase 3.

import type { ProductKit } from "../types";
import { exerciseSpec, explanationSpec, mistakeSpec, reviewPackSpec, textbookContentSpecs } from "./contentTypes";
import { exercisePlugin, explanationPlugin, mistakePlugin, reviewPackPlugin } from "./noteTypes";
import { textbookLanguage } from "./language";
import { textbookCommands } from "./commands";
import { textbookSelectionToolbar, textbookSourceActions } from "./surfaces";
import { textbookPrompts } from "./prompts";
import { textbookLayerPolicy } from "./policy";
import { textbookLearningLayout } from "./layout";

export const textbookLearningKit: ProductKit = {
  id: "textbook-learning",
  name: "Textbook Learning Kit",
  description: "Turn a source into a textbook: explain passages, generate practice, track mistakes, review.",
  contentSpecs: textbookContentSpecs,
  prompts: textbookPrompts,
  layerPolicy: textbookLayerPolicy,
  install(ctx) {
    ctx.noteTypes.register(explanationSpec, explanationPlugin);
    ctx.noteTypes.register(exerciseSpec, exercisePlugin);
    ctx.noteTypes.register(mistakeSpec, mistakePlugin);
    ctx.noteTypes.register(reviewPackSpec, reviewPackPlugin);
    ctx.language.register(textbookLanguage);
    for (const command of textbookCommands) ctx.commands.register(command);
    ctx.surfaces.contribute("selection-toolbar", textbookSelectionToolbar);
    ctx.surfaces.contribute("source-actions", textbookSourceActions);
    ctx.layouts.register(textbookLearningLayout);
  }
};
