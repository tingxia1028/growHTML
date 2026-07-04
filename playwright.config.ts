import { defineConfig, devices } from "@playwright/test";
import { API_PORT, BASE_URL, CLIENT_PORT, E2E_VAULT_ROOT, SERVER } from "./e2e/harness";

// E2E-DEBT-001: the web suite runs on DEDICATED ports (14177/15173 — see
// e2e/harness.ts) against an EPHEMERAL OS-temp vault. It never binds the dev
// server's 4177/5173 and never opens the real data/vault, so `npm run e2e` is
// safe to run while a live dev session is up.
export default defineConfig({
  testDir: "e2e",
  // Create the fresh temp vault before the dev server boots; delete it after
  // the run (each run is deterministic — the suite seeds its own sources).
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Start our OWN server + client; each waited on its own URL.
  webServer: [
    {
      command: "npm run dev:server",
      url: `${SERVER}/api/health`,
      // NEVER reuse an already-running server. reuseExistingServer:true would make
      // Playwright reuse a server bound to the REAL data/vault (the env override
      // below only applies when Playwright STARTS the server), leaking test seed
      // data into data/vault. Always boot our own server on the ephemeral vault.
      reuseExistingServer: false,
      timeout: 60_000,
      // Space out mock stream chunks so the streaming-chat spec can observe the
      // reply arriving progressively (deterministic; content is unchanged).
      // Pin the MOCK provider for e2e regardless of any local `.env` (which may set
      // STUDY_VAULT_AI_PROVIDER=claude-cli for real dev) — specs assert deterministic
      // mock replies, and a real provider would be slow/non-deterministic and bill the
      // user's subscription. (dotenv never overrides env vars that are already set.)
      env: {
        PORT: String(API_PORT),
        STUDY_VAULT_ROOT: E2E_VAULT_ROOT,
        STUDY_VAULT_MOCK_STREAM_DELAY_MS: "60",
        STUDY_VAULT_AI_PROVIDER: "mock",
        // TRUST-1 kill switch: the ephemeral e2e vault must never seed an
        // auto-backup into a backups/ dir on boot.
        STUDY_VAULT_AUTO_BACKUP: "0"
      }
    },
    {
      // --strictPort: if our dedicated client port is somehow taken, FAIL instead
      // of letting Vite silently bump to port+1 (which would strand baseURL).
      command: `npm run dev:client -- --port ${CLIENT_PORT} --strictPort`,
      url: BASE_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      // vite.config.ts reads this to aim the /api proxy at OUR server instead of
      // the default dev API port 4177.
      env: { STUDY_VAULT_API_PORT: String(API_PORT) }
    }
  ]
});
