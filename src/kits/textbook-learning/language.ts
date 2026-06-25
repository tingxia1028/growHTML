// Textbook Learning Kit — domain language (user spec §10). Renames the generic core
// vocabulary for the student/teacher product and gives each Study Block a friendly
// label (used by the composer type picker + card headers).

import type { KitLanguage } from "../types";

export const textbookLanguage: KitLanguage = {
  source: "Textbook",
  anchor: "Knowledge Point",
  note: "Study Block",
  layer: "Learning Layer",
  contentTypes: {
    "textbook.explanation": "Explanation",
    "textbook.exercise": "Practice",
    "textbook.mistake": "Mistake"
  }
};
