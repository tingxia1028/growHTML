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
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { STUDY_VAULT_ROOT: e2eVaultRoot }
    },
    {
      command: "npm run dev:client",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000
    }
  ]
});
