import { defineConfig } from "vitest/config";

// Vitest picks up *.spec.ts by default; keep Playwright e2e specs out of unit runs.
export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "e2e/**",
      "e2e-electron/**",
      ".e2e-vault/**",
      ".e2e-electron-vault/**",
      "**/*.config.*"
    ]
  }
});
