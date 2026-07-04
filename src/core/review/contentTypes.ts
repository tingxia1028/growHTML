// Core review — the React-free content spec for the ONE content shape the review
// loop needs: `review.grade`, the structured verdict `review.grade-answer` returns
// ({ correct, explanation }). It is a TRANSIENT judgement, not study material:
// grades are NEVER persisted as notes (review-loop.md §2) — the spec exists so the
// /api/kits/generate path can validate the model's output through the exact same
// declared-form gate every other operation uses. The client half registers it
// HIDDEN, so it never appears in composers or the slash palette.
//
// REV-CORE (kit-flatten-and-core-review.md §1): this moved from the dissolved
// review PLUGIN into core — the review loop is the mission loop, not uninstallable.
// Design law (product-kernel §1): this is a content-type, not a new entity.

import { z } from "zod";
import { registerNoteContentSpec, type NoteContentSpec } from "../notes/contentTypes";

export const REVIEW_GRADE_CONTENT_TYPE = "review.grade";

const gradeSchema = z.object({
  /** Whether the user's answer matches the expected one. */
  correct: z.boolean(),
  /** Why — shown inline in the runner after grading. */
  explanation: z.string()
});
export type ReviewGradeContent = z.infer<typeof gradeSchema>;

export const reviewGradeSpec: NoteContentSpec<ReviewGradeContent> = {
  contentType: REVIEW_GRADE_CONTENT_TYPE,
  schema: gradeSchema,
  createDefault: () => ({ correct: false, explanation: "" }),
  toSearchText: (c) => c.explanation
};

// Core-seed registration: available the moment this module is imported (the same
// pattern as core/notes/contentTypes' built-ins) — no plugin manifest involved.
registerNoteContentSpec(reviewGradeSpec);
