import { mkdir, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { E2E_VAULT_ROOT } from "./harness";

// Start every web e2e run from a CLEAN, EPHEMERAL vault under the OS temp dir.
// The suite seeds its own sources via the API; a vault left over from a previous
// run accumulates sources, which makes the UI's "select the first source" default
// point at a stale document and breaks the assumption that the freshly seeded
// source is the active one. Creating it here (before the webServer boots and
// opens the vault) keeps runs deterministic; global-teardown.ts deletes it.
export default async function globalSetup(): Promise<void> {
  // Sweep stale siblings first: a hard-killed run (Ctrl-C before teardown) leaves
  // its pid-stamped dir behind. Two runs can't overlap anyway (fixed dedicated
  // ports), so anything matching the prefix is garbage from a previous run.
  const tmp = os.tmpdir();
  for (const entry of await readdir(tmp).catch(() => [] as string[])) {
    if (!entry.startsWith("growte-e2e-vault-")) continue;
    const stale = path.join(tmp, entry);
    if (stale === E2E_VAULT_ROOT) continue;
    await rm(stale, { recursive: true, force: true }).catch(() => {});
  }

  await rm(E2E_VAULT_ROOT, { recursive: true, force: true });
  await mkdir(E2E_VAULT_ROOT, { recursive: true });
  console.log(`[e2e] ephemeral vault: ${E2E_VAULT_ROOT}`);
}
