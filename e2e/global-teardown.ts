import { rm } from "node:fs/promises";
import { E2E_VAULT_ROOT } from "./harness";

// Delete the run's ephemeral temp vault (created by global-setup.ts). Runs after
// Playwright has shut the webServer processes down; retries absorb any straggling
// Windows file locks from the just-killed server.
export default async function globalTeardown(): Promise<void> {
  await rm(E2E_VAULT_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  console.log(`[e2e] ephemeral vault removed: ${E2E_VAULT_ROOT}`);
}
