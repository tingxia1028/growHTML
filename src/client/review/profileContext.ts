// REV-2 — the compact 学生画像 text woven into `review.explain` (the FIRST MEM-3
// consumer, review-loop.md §4-REV-2). ACTION-2a promoted the builder itself to
// core (src/core/memory/profileContext.ts) so the SERVER composes the identical
// learner context into the auto-context envelope for EVERY operation; this module
// stays as the client's import seam (ReviewPanel + tests are untouched). Hidden
// facts are the user's "don't say that" — excluded inside the core builder
// exactly as the 画像页 hides them.

export { buildProfileContext, PROFILE_CONTEXT_WEAK_LIMIT } from "../../core/memory/profileContext";
