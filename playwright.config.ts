import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Isolated vault so the click self-test never touches the real data/vault.
const e2eVaultRoot = path.resolve(process.cwd(), ".e2e-vault");

export default defineConfig({
  testDir: "e2e",
  // Wipe the isolated vault before the dev server boots so each run is deterministic
  // (the suite seeds its own sources; stale ones break the "first source" default).
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Start the real server + client; each waited on its own URL.
  webServer: [
    {
      command: "npm run dev:server",
      url: "http://127.0.0.1:4177/api/health",
      // NEVER reuse an already-running server. reuseExistingServer:true would make
      // Playwright reuse a dev server bound to the REAL data/vault (the env override
      // below only applies when Playwright STARTS the server), leaking test seed data
      // into data/vault. Always boot our own server on the isolated .e2e-vault.
      // Cost: ports 4177/5173 must be free before `npm run e2e` (kill any dev server).
      reuseExistingServer: false,
      timeout: 60_000,
      // Space out mock stream chunks so the streaming-chat spec can observe the
      // reply arriving progressively (deterministic; content is unchanged).
      // Pin the MOCK provider for e2e regardless of any local `.env` (which may set
      // STUDY_VAULT_AI_PROVIDER=claude-cli for real dev) — specs assert deterministic
      // mock replies, and a real provider would be slow/non-deterministic and bill the
      // user's subscription.
      env: {
        STUDY_VAULT_ROOT: e2eVaultRoot,
        STUDY_VAULT_MOCK_STREAM_DELAY_MS: "60",
        STUDY_VAULT_AI_PROVIDER: "mock",
        // TRUST-1 kill switch: the ephemeral e2e vault must never seed an
        // auto-backup into a repo-side backups/ dir on boot.
        STUDY_VAULT_AUTO_BACKUP: "0"
      }
    },
    {
      command: "npm run dev:client",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
      timeout: 60_000
    }
  ]
});
