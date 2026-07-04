import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import { startServer } from "./start";

const port = Number(process.env.PORT ?? 4177);

// Serve the built client too when it exists (production single-origin mode);
// in dev the Vite server proxies /api here, so leave clientDir unset.
const distDir = path.resolve(process.cwd(), "dist");
const clientDir = existsSync(path.join(distDir, "index.html")) ? distDir : undefined;

// TRUST-1: the dev/CLI entry serves a real vault → arm the 24h auto-backup
// scheduler (data/vault → data/backups; STUDY_VAULT_AUTO_BACKUP=0 disables — the
// plain-e2e harness sets it so ephemeral .e2e-vault runs never litter backups).
const { url } = await startServer({ port, clientDir, backups: { auto: true } });
console.log(`AI Study Vault listening on ${url}${clientDir ? " (serving built client)" : " (API only)"}`);
