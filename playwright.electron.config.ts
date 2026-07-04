import { defineConfig } from "@playwright/test";

// Separate config for the Electron desktop self-test: no webServer (each spec file
// launches the app itself via e2e-electron/harness.ts, and the app boots its own
// in-process server on an ephemeral port) and a single worker (one app instance at
// a time). E2E-ELECTRON-001: the harness gives every spec a fresh OS-temp vault
// (global setup/teardown own the per-run root) — no repo-side vault dirs, no
// contact with the real data/vault, safe to run beside a live dev session.
export default defineConfig({
  testDir: "e2e-electron",
  globalSetup: "./e2e-electron/global-setup.ts",
  globalTeardown: "./e2e-electron/global-teardown.ts",
  // Webview-heavy flows (guest paint polling + pixel readbacks) run slower than the
  // web suite; give each test the same headroom the polls assume.
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list"
});
