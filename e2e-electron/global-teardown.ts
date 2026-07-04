import { rm } from "node:fs/promises";
import { E2E_ELECTRON_VAULT_ROOT } from "./harness";

// Delete the run's ephemeral vault root (created by global-setup.ts). Runs after all
// spec afterAll hooks have closed their app instances; retries absorb any straggling
// Windows file locks from the just-closed Electron processes.
export default async function globalTeardown(): Promise<void> {
  await rm(E2E_ELECTRON_VAULT_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  console.log(`[e2e-electron] ephemeral vault root removed: ${E2E_ELECTRON_VAULT_ROOT}`);
}
