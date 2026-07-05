// Client kit registration — the list of installed Product Kits + a side-effect that
// installs them. Imported for its side effect next to the built-in note types (see
// src/client/workspace/views.tsx), mirroring the built-in registration pattern.

import { installClientKits } from "./clientContext";
import { textbookLearningKit } from "./textbook-learning";
import { subjectKits } from "./subject";
import { teachbackKit } from "./teachback";
import { mistakePhotoKit } from "./mistake-photo";

// The subject kits (M-B) register like every kit — types render everywhere — but are
// NOT default-installed (catalog.ts): their create affordances light up on market install.
// (REV-CORE: the review loop is CORE — its panel/types/prompts register at core seed,
// no plugin record, so it is deliberately absent here.)
// PRO-2 teach-back kit (proactive-learning.md §2): a register-only kit. It is UNCATALOGED
// (no market entry) → always-available (isPluginEffectiveInstalled returns true for
// uncataloged ids), so its note types render + its teachback.start command works day-one.
// The runner PANEL self-registerViews (TeachbackPanel.tsx, shell-imported), not via the
// dead `views` kit sink.
// V-2 拍错题 kit (vision-input.md §3): a register-only kit, UNCATALOGED (no market entry)
// → always-available, so its `mistake-photo.capture` command works day-one. It registers
// NO note type (the extracted card is the CORE `mistake` type) — only its capture command.
export const productKits = [textbookLearningKit, ...subjectKits, teachbackKit, mistakePhotoKit];

installClientKits(productKits);
