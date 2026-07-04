import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// STUDY_VAULT_API_PORT lets a harness aim the /api proxy at its own server
// (the Playwright e2e suite boots server+client on dedicated ports so it never
// touches a live dev session). Default stays the dev API port 4177.
const apiPort = process.env.STUDY_VAULT_API_PORT ?? "4177";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`
    }
  }
});
