// Review plugin — core (React-free) content spec for the ONE new content shape the
// review loop needs: `review.grade`, the structured verdict `review.grade-answer`
// returns ({ correct, explanation }). It is a TRANSIENT judgement, not study
// material: grades are NEVER persisted as notes (review-loop.md §2) — the spec
// exists so the /api/kits/generate path can validate the model's output through the
// exact same declared-form gate every other operation uses. The client half
// registers it HIDDEN, so it never appears in composers or the slash palette.
//
// Design law (product-kernel §1): this is a content-type, not a new entity.

import { z } from "zod";
import type { NoteContentSpec } from "../../core/notes/contentTypes";

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

// All review-plugin core specs — registered by both the server (validation) and the
// client (defaults / hidden renderer), mirroring textbookContentSpecs.
export const reviewContentSpecs: NoteContentSpec[] = [reviewGradeSpec as NoteContentSpec];
