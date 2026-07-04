import { createServer, type Server } from "node:http";
import { openVault } from "../core/vault";
import { migrateStudyLayers } from "../core/study-layer/layers";
import { createApp } from "./app";
import { consolidateMemory } from "./memory";
import { defaultAiConfigDir } from "./services/aiProviders";

export type StartServerOptions = {
  /** Listen port; 0 (default) picks a free port — read it back from `port`. */
  port?: number;
  host?: string;
  /** Directory of the built client to serve (single-origin app). */
  clientDir?: string;
  /**
   * Vault root override. Default (undefined) keeps openVault's resolution:
   * STUDY_VAULT_ROOT env, else cwd-relative data/vault. The packaged desktop
   * app passes `<userData>/vault` here (X1) — an install dir is not writable.
   */
  vaultRoot?: string;
  /**
   * App-level AI provider config home (ai-providers.json + key blobs). Defaults
   * to ~/.growte — the real entry points (CLI server, Electron main) always get
   * stored provider config; unit tests build createApp directly and inject.
   */
  aiConfigDir?: string;
};

export type StartedServer = {
  server: Server;
  port: number;
  url: string;
  close: () => Promise<void>;
};

// Boots the vault + Express on an HTTP server and resolves once it is listening.
// Reused by the CLI entry (`src/server/index.ts`) and the Electron main process.
export async function startServer(options: StartServerOptions = {}): Promise<StartedServer> {
  const host = options.host ?? "127.0.0.1";
  const vault = await openVault({ rootDir: options.vaultRoot });
  // Backfill the owned-layer membership for any pre-Study-Layer anchors/notes.
  await migrateStudyLayers(vault);
  // MEM-2 app-start consolidation pass (learner-memory §4): roll captured events into
  // digests + compact the raw stream once per boot. Never blocks serving on failure.
  try {
    await consolidateMemory({ vault });
  } catch (error) {
    console.warn("[memory] app-start consolidation failed (will retry on next trigger):", error);
  }
  const app = createApp({
    vault,
    clientDir: options.clientDir,
    // A3b: stored provider selection + BYOK config (env vars still override/fallback).
    // Under the packaged desktop app this code runs IN the Electron main process, so
    // the default KeyStore resolves to safeStorage; plain Node (dev/CLI) → env-only.
    aiConfig: { dir: options.aiConfigDir ?? defaultAiConfigDir() }
  });
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : Number(options.port ?? 0);

  return {
    server,
    port,
    url: `http://${host}:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}
