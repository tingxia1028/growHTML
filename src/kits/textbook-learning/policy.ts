// Textbook Kit layer-propagation policy (user spec §11). Teacher-authored blocks
// (explanation / exercise / review-pack) are shareable; a student's mistakes stay
// PRIVATE and are stripped from any exported `.studypack`.
import type { KitLayerPolicy } from "../policy";

export const textbookLayerPolicy: KitLayerPolicy = {
  kitId: "textbook-learning",
  exportableContentTypes: ["textbook.explanation", "textbook.exercise", "textbook.review-pack"],
  privateByDefaultContentTypes: ["textbook.mistake"],
  copyableContentTypes: ["textbook.explanation", "textbook.exercise", "textbook.review-pack"],
  // The stage axis the textbook kit seeds onto a source (F7a). These titles + orders
  // used to be hardcoded in core (PRESET_STAGES); they now live here as a kit opinion.
  // "复习" is purely an organizing filter (no scheduling/SRS — that is out of scope).
  stagePreset: [
    { title: "预习", order: 0 },
    { title: "学习", order: 1 },
    { title: "复习", order: 2 },
    { title: "拓展", order: 3 }
  ]
};
