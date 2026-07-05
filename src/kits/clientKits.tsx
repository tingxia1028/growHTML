// Client kit registration — the list of installed Product Kits + a side-effect that
// installs them. Imported for its side effect next to the built-in note types (see
// src/client/workspace/views.tsx), mirroring the built-in registration pattern.

import { installClientKits } from "./clientContext";
import { textbookLearningKit } from "./textbook-learning";
import { subjectKits } from "./subject";
import { teachbackKit } from "./teachback";
import { mistakePhotoKit } from "./mistake-photo";
import { studyReportKit } from "./study-report";
import { bookmarksKit } from "./bookmarks";
import { reviewKit } from "./review";

// The subject kits (M-B) register like every kit — types render everywhere — but are
// NOT default-installed (catalog.ts): their create affordances light up on market install.
// (REV-CORE: the review ENGINE is CORE — the SRS schedule/prompts/grade type + the review
// SUPPORT modules in src/client/review/ (queue/scope/io/push) register at core seed with no
// plugin record. Only the review.panel drill VIEW is a register-only KIT lens now: reviewKit
// below, mirroring bookmarksKit — the ENGINE it composes stays entirely core.)
// PRO-2 teach-back kit (proactive-learning.md §2): a register-only kit. It is UNCATALOGED
// (no market entry) → always-available (isPluginEffectiveInstalled returns true for
// uncataloged ids), so its note types render + its teachback.start command works day-one.
// The runner PANEL self-registerViews (TeachbackPanel.tsx, shell-imported), not via the
// dead `views` kit sink.
// V-2 拍错题 kit (vision-input.md §3): a register-only kit, UNCATALOGED (no market entry)
// → always-available, so its `mistake-photo.capture` command works day-one. It registers
// NO note type (the extracted card is the CORE `mistake` type) — only its capture command.
// REPORT-1 study-report kit (study-report-delivery.md §1): a register-only kit, UNCATALOGED
// → always-available, so its study-report.generate / study-report.open commands + the
// study-report.report note type work day-one. The report.list VIEW self-registers
// (ReportListView.tsx, shell-imported), not via the dead `views` kit sink.
// bookmarks kit (bookmark-modeling.md): a register-only kit, UNCATALOGED → always-available.
// It registers NO content spec (the `bookmark` type is a CORE built-in) — only the
// bookmark.list browse LENS, which self-registers (BookmarkListView.tsx, shell-imported).
// Its Cmd+K launch is the CORE commandEntries.ts NAV entry, not a kit command.
// review kit (review-loop.md §2/§4): a register-only kit, UNCATALOGED → always-available.
// It registers NO content spec — the SRS ENGINE + review SUPPORT modules stay CORE; only the
// review.panel drill VIEW self-registers (ReviewPanel.tsx, shell-imported). 复习 KEEPS its
// IconRail entry (a primary daily surface); the nav is kind-keyed `review.panel`, unchanged.
export const productKits = [
  textbookLearningKit,
  ...subjectKits,
  teachbackKit,
  mistakePhotoKit,
  studyReportKit,
  bookmarksKit,
  reviewKit
];

installClientKits(productKits);
