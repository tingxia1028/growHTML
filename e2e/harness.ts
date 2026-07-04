import os from "node:os";
import path from "node:path";

// E2E-DEBT-001 harness constants — the single source of truth for where the web
// e2e suite runs. Dedicated ports, deliberately FAR from the dev server's
// 4177/5173, so `npm run e2e` boots its own server+client and can run beside a
// live dev session without ever colliding with (or worse, reusing) it.
export const API_PORT = 14177;
export const CLIENT_PORT = 15173;
export const SERVER = `http://127.0.0.1:${API_PORT}`;
export const BASE_URL = `http://127.0.0.1:${CLIENT_PORT}`;

// Fresh OS-temp vault per run — never a repo-side directory, so test seed data
// can never leak into the real data/vault (the old reuseExistingServer bug) nor
// litter the working tree. Playwright's MAIN process evaluates this module first
// (config → globalSetup → webServer env) and publishes the pid-stamped path into
// its own env; WORKER processes (which re-evaluate the module but run with a
// different pid) inherit that env var, so every process — including specs that
// need to touch vault files directly (svpack's publish-ledger cleanup) — agrees
// on the same directory. global-teardown.ts deletes it after the run.
export const E2E_VAULT_ROOT =
  process.env.GROWTE_E2E_VAULT_ROOT ?? path.join(os.tmpdir(), `growte-e2e-vault-${process.pid}`);
process.env.GROWTE_E2E_VAULT_ROOT = E2E_VAULT_ROOT;
