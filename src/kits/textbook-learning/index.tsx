// Textbook Learning Kit — the ProductKit, decomposed into REAL member plugins (F5,
// docs/design/plugin-viewer-model.md §8.10): a kit carries no capability of its own —
// capability lives in the member plugins; the kit bundles them + kit-level config
// (layout / layer policy / server-side prompts). Member ids double as the market's
// CatalogEntry ids (explanation / practice / mistake / review-pack / textbook-language),
// so catalog kit `members[]` resolve against the plugin read model.
//
// Each member registers ONLY (no core changes): its Study Block note type, its AI
// command, and its toolbar surface item — through the same KitInstallContext sinks,
// now tagged with the member's own plugin id.

import type { KitMemberPlugin, ProductKit } from "../types";
import { exerciseSpec, explanationSpec, mistakeSpec, reviewPackSpec, textbookContentSpecs } from "./contentTypes";
import { exercisePlugin, explanationPlugin, mistakePlugin, reviewPackPlugin } from "./noteTypes";
import { textbookLanguage } from "./language";
import {
  explainConceptCommand,
  generatePracticeCommand,
  generateReviewPackCommand,
  markAsMistakeCommand
} from "./commands";
import { textbookSelectionToolbar, textbookSourceActions } from "./surfaces";
import { textbookPrompts } from "./prompts";
import { textbookLayerPolicy } from "./policy";
import { textbookLearningLayout } from "./layout";

// One member = one Study Block loop step: its note type + its command + its surface.
const explanationMember: KitMemberPlugin = {
  id: "explanation",
  name: "讲解 Explanation",
  install(ctx) {
    ctx.noteTypes.register(explanationSpec, explanationPlugin);
    ctx.commands.register(explainConceptCommand);
    ctx.surfaces.contribute(
      "selection-toolbar",
      textbookSelectionToolbar.filter((item) => item.commandId === explainConceptCommand.id)
    );
  }
};

const practiceMember: KitMemberPlugin = {
  id: "practice",
  name: "练习 Practice",
  install(ctx) {
    ctx.noteTypes.register(exerciseSpec, exercisePlugin);
    ctx.commands.register(generatePracticeCommand);
    ctx.surfaces.contribute(
      "selection-toolbar",
      textbookSelectionToolbar.filter((item) => item.commandId === generatePracticeCommand.id)
    );
  }
};

const mistakeMember: KitMemberPlugin = {
  id: "mistake",
  name: "错题 Mistake",
  install(ctx) {
    ctx.noteTypes.register(mistakeSpec, mistakePlugin);
    ctx.commands.register(markAsMistakeCommand);
    ctx.surfaces.contribute(
      "selection-toolbar",
      textbookSelectionToolbar.filter((item) => item.commandId === markAsMistakeCommand.id)
    );
  }
};

const reviewPackMember: KitMemberPlugin = {
  id: "review-pack",
  name: "复习包 Review Pack",
  install(ctx) {
    ctx.noteTypes.register(reviewPackSpec, reviewPackPlugin);
    ctx.commands.register(generateReviewPackCommand);
    ctx.surfaces.contribute("source-actions", textbookSourceActions);
  }
};

// Language packs are plugins (§8.1). The language sink registers the vocabulary under
// the OWNING KIT id (per-source activation scopes language lookups by active kit ids)
// while the contribution is recorded on this member — see clientContext's language sink.
const languageMember: KitMemberPlugin = {
  id: "textbook-language",
  name: "Textbook language",
  install(ctx) {
    ctx.language.register(textbookLanguage);
  }
};

export const textbookLearningKit: ProductKit = {
  id: "textbook-learning",
  name: "Textbook Learning Kit",
  description: "Turn a source into a textbook: explain passages, generate practice, track mistakes, review.",
  contentSpecs: textbookContentSpecs,
  prompts: textbookPrompts,
  layerPolicy: textbookLayerPolicy,
  members: [explanationMember, practiceMember, mistakeMember, reviewPackMember, languageMember],
  // Kit-level config only (capability lives in the members above).
  install(ctx) {
    ctx.layouts.register(textbookLearningLayout);
  }
};
