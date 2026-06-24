import { defineConfig } from "@playwright/test";

// Separate config for the Electron desktop self-test: no webServer (the app
// boots its own in-process server) and a single worker (one app instance).
export default defineConfig({
  testDir: "e2e-electron",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list"
});
