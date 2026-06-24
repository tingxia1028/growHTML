import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import { startServer } from "./start";

const port = Number(process.env.PORT ?? 4177);

// Serve the built client too when it exists (production single-origin mode);
// in dev the Vite server proxies /api here, so leave clientDir unset.
const distDir = path.resolve(process.cwd(), "dist");
const clientDir = existsSync(path.join(distDir, "index.html")) ? distDir : undefined;

const { url } = await startServer({ port, clientDir });
console.log(`AI Study Vault listening on ${url}${clientDir ? " (serving built client)" : " (API only)"}`);
