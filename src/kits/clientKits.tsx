// Client kit registration — the list of installed Product Kits + a side-effect that
// installs them. Imported for its side effect next to the built-in note types (see
// src/client/workspace/views.tsx), mirroring the built-in registration pattern.

import { installClientKits } from "./clientContext";
import { textbookLearningKit } from "./textbook-learning";
import { subjectKits } from "./subject";

// The subject kits (M-B) register like every kit — types render everywhere — but are
// NOT default-installed (catalog.ts): their create affordances light up on market install.
// (REV-CORE: the review loop is CORE — its panel/types/prompts register at core seed,
// no plugin record, so it is deliberately absent here.)
export const productKits = [textbookLearningKit, ...subjectKits];

installClientKits(productKits);
