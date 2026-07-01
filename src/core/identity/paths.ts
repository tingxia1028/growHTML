// server-only (node:fs/node:os) — never import from src/client.
// One shared default for the identity leaf. Device/publisher keys, pins, and the
// clock high-water-mark live OUTSIDE any vault (design §5.1/§7.1): copying a vault
// directory must never carry the keys that unseal it. Every function in this leaf
// takes the directory as a parameter so tests point it at a temp dir.

import os from "node:os";
import path from "node:path";

export function defaultIdentityDir(): string {
  return path.join(os.homedir(), ".growte", "identity");
}
