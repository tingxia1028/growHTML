import path from "node:path";

/**
 * Resolve the default vault root for the Node-side entry points (CLI server, Electron main,
 * scripts). PLAT-LAYER Part-4a moved this OUT of the portable core (`src/core/vault.ts`): it
 * reads `process.env`/`process.cwd()`, which the portable store graph must not depend on.
 * `openVault` no longer defaults `rootDir` — every Node caller resolves it here explicitly.
 */
export function getDefaultVaultRoot() {
  return process.env.STUDY_VAULT_ROOT
    ? path.resolve(process.env.STUDY_VAULT_ROOT)
    : path.resolve(process.cwd(), "data", "vault");
}
