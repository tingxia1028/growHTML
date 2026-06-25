// Client kit registration — the list of installed Product Kits + a side-effect that
// installs them. Imported for its side effect next to the built-in note types (see
// src/client/workspace/views.tsx), mirroring the built-in registration pattern.

import { installClientKits } from "./clientContext";
import { textbookLearningKit } from "./textbook-learning";

export const productKits = [textbookLearningKit];

installClientKits(productKits);
