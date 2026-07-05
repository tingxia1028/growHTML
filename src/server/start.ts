import { createServer, type Server } from "node:http";
import { openVault } from "../core/vault";
import { migrateStudyLayers } from "../core/study-layer/layers";
import { createApp } from "./app";
import { defaultBackupsDir } from "./dataTrust";
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
  /**
   * TRUST-1 backups (docs/design/data-trust.md §1). `dir` defaults to
   * STUDY_VAULT_BACKUPS_DIR env, else the sibling `backups/` of the resolved
   * vault root. `auto` (default FALSE — entry points that KNOW they serve a real
   * user opt in) arms the 24h app-start/idle auto-backup scheduler;
   * STUDY_VAULT_AUTO_BACKUP=0 force-disables it either way (e2e harnesses).
   */
  backups?: { dir?: string; auto?: boolean };
  /**
   * Whether this runs inside a PACKAGED desktop build (Electron main passes
   * `app.isPackaged`). Surfaced on /api/about so the client can degrade features
   * whose native deps are NOT shipped packaged — e.g. the codex provider's
   * `@openai/codex-sdk` (deliberately dev/source-only). Default false (dev/CLI).
   */
  isPackaged?: boolean;
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
    isPackaged: options.isPackaged,
    // A3b: stored provider selection + BYOK config (env vars still override/fallback).
    // Under the packaged desktop app this code runs IN the Electron main process, so
    // the default KeyStore resolves to safeStorage; plain Node (dev/CLI) → env-only.
    aiConfig: { dir: options.aiConfigDir ?? defaultAiConfigDir() },
    // TRUST-1/2: rotating backups beside the vault + the destructive-op guard; the
    // auto scheduler only when the entry point opted in AND the env kill switch is off.
    dataTrust: {
      backupsDir:
        options.backups?.dir ??
        process.env.STUDY_VAULT_BACKUPS_DIR ??
        defaultBackupsDir(vault.paths.rootDir),
      scheduleAuto: (options.backups?.auto ?? false) && process.env.STUDY_VAULT_AUTO_BACKUP !== "0"
    }
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
    // Stop accepting connections, THEN release the vault's store handles (STORE-SQL Stage-3
    // dispose path): for a sqlite vault this closes each `.db`/`-wal` handle so the OS can
    // unlink/rename it; a no-op on the jsonl default. Reached on Electron `before-quit`
    // (electron/main.ts) and every test/CLI `StartedServer.close()`, so no separate global
    // SIGINT/SIGTERM handler is needed (adding one could double-close or fight the Electron
    // lifecycle). vault.close() is sync and cannot throw, so it runs whether or not the HTTP
    // server closes cleanly.
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => {
          vault.close();
          if (error) reject(error);
          else resolve();
        })
      )
  };
}
