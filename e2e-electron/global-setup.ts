import { mkdir, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { E2E_ELECTRON_VAULT_ROOT } from "./harness";

// Start every Electron e2e run from a CLEAN, EPHEMERAL vault root under the OS temp
// dir (E2E-ELECTRON-001 — the same pattern as e2e/global-setup.ts). Each spec file
// launches its own app instance on its own subdirectory; global-teardown.ts deletes
// the whole root after the run. No repo-side `.e2e-electron-vault*` dir ever exists.
export default async function globalSetup(): Promise<void> {
  // Sweep stale siblings first: a hard-killed run (Ctrl-C before teardown) leaves its
  // pid-stamped root behind. Only OUR prefix is swept — the web suite's
  // `growte-e2e-vault-*` roots belong to its own setup/teardown.
  const tmp = os.tmpdir();
  for (const entry of await readdir(tmp).catch(() => [] as string[])) {
    if (!entry.startsWith("growte-e2e-electron-vault-")) continue;
    const stale = path.join(tmp, entry);
    if (stale === E2E_ELECTRON_VAULT_ROOT) continue;
    await rm(stale, { recursive: true, force: true }).catch(() => {});
  }

  await rm(E2E_ELECTRON_VAULT_ROOT, { recursive: true, force: true });
  await mkdir(E2E_ELECTRON_VAULT_ROOT, { recursive: true });
  console.log(`[e2e-electron] ephemeral vault root: ${E2E_ELECTRON_VAULT_ROOT}`);
}
