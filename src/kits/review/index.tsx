// Review plugin — the first AI-native UPPER-LAYER plugin (review-loop.md §1): pure
// COMPOSITION of already-built core organs, registered through the same ProductKit
// seam the Textbook kit uses. It contributes:
//   - 3 operations as kit-prompt records (review.generate-check / review.grade-answer /
//     review.explain) — server-registered, dispatched through /api/kits/generate
//   - 1 HIDDEN content spec + client type (review.grade — the transient verdict shape;
//     grades are never persisted as notes, and hidden keeps it out of all composers)
// The Review SURFACE itself (src/client/review/ReviewPanel.tsx) is a registered
// workspace view — it registers via the view registry like plugin.manager does, so
// this kit record stays React-light and the view stays reachable through the shell.
// It contributes NO commands and NO toolbar surfaces: the runner drives the
// operations per queue item, which command surfaces can't express.

import type { ProductKit } from "../types";
import { reviewContentSpecs, reviewGradeSpec } from "./contentTypes";
import { reviewGradePlugin } from "./noteTypes";
import { reviewPrompts } from "./prompts";

export const reviewPlugin: ProductKit = {
  id: "review",
  name: "Review Loop",
  description: "复习环:把错题、小测、闪卡、复习包排成确定性的队列,AI 出题/判分/讲解,复习结果写入 learner memory.",
  // A STANDALONE plugin (plugin-viewer-model §8.1), not a kit: it uses the ProductKit
  // registration vehicle but is not an activation choice and registers a plain
  // PluginRecord (F5 — no more plugin==kit conflation for it).
  unit: "plugin",
  contentSpecs: reviewContentSpecs,
  prompts: reviewPrompts,
  install(ctx) {
    ctx.noteTypes.register(reviewGradeSpec, reviewGradePlugin);
  }
};
