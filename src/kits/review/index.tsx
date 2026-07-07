// Review Kit (review-loop.md §2/§4 — the 复习 drill as a KIT LENS) — a register-only
// ProductKit. It invents NO core entities and registers NO content spec: the SRS ENGINE
// stays CORE (src/core/review/* schedule/prompts/contentTypes) and so do the review SUPPORT
// modules in src/client/review/ (queue.ts — the REPORT-1 assembler uses weakReviewBuckets;
// reviewScope.ts — the mistake-book 复习错题 launch uses it; reviewIo.ts / the proactiveTick
// due signal; reviewPush.ts — the PRO-1 trigger). The kit contributes ONLY the ReviewPanel
// drill VIEW — the runner that composes those core organs into a review session.
//
// KIT-vs-core: the ONLY core touches are the register-only `productKits` one-liner
// (clientKits.tsx) + the ReviewPanel shell import. The VIEW self-registerViews
// (ReviewPanel.tsx, shell-imported — the report.list / mistake.book precedent). 复习 KEEPS
// its IconRail entry (a primary daily surface — kit-ness = the view's code location, NOT
// its reachability); its launches (rail / onboarding / reviewPush / mistake-book) are all
// kind-keyed `review.panel` nav, unchanged by the move. Mirrors bookmarksKit's minimal shape.

import type { ProductKit } from "../types";

export const reviewKit: ProductKit = {
  id: "review",
  name: "Review Kit",
  icon: "book-open-check",
  description:
    "复习:把到期的卡片/错题/弱项汇成一场复习,逐题作答→自评/AI 判分→写回记忆(SRS 引擎与队列在核心)。",
  // No contentSpecs (the review.grade type + SRS engine are CORE), no prompts, no members —
  // the review.panel VIEW self-registers (shell-imported), so install is a no-op.
  install() {}
};
