// Textbook Kit layer-propagation policy (user spec §11). Teacher-authored blocks
// (explanation / exercise / review-pack) are shareable; a student's mistakes stay
// PRIVATE and are stripped from any exported `.studypack`.
import type { KitLayerPolicy } from "../policy";

export const textbookLayerPolicy: KitLayerPolicy = {
  kitId: "textbook-learning",
  exportableContentTypes: ["textbook.explanation", "textbook.exercise", "textbook.review-pack"],
  privateByDefaultContentTypes: ["textbook.mistake"],
  copyableContentTypes: ["textbook.explanation", "textbook.exercise", "textbook.review-pack"]
};
