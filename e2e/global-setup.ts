import { rm } from "node:fs/promises";
import path from "node:path";

// Start every web e2e run from a CLEAN vault. The suite seeds its own sources via
// the API; a vault left over from a previous run accumulates sources, which makes
// the UI's "select the first source" default point at a stale document and breaks
// the assumption that the freshly seeded source is the active one. Wiping here
// (before the webServer boots and opens the vault) keeps runs deterministic.
export default async function globalSetup(): Promise<void> {
  const vaultRoot = path.resolve(process.cwd(), ".e2e-vault");
  await rm(vaultRoot, { recursive: true, force: true });
}
