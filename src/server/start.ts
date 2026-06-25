import { createServer, type Server } from "node:http";
import { openVault } from "../core/vault";
import { migrateStudyLayers } from "../core/study-layer/layers";
import { createApp } from "./app";

export type StartServerOptions = {
  /** Listen port; 0 (default) picks a free port — read it back from `port`. */
  port?: number;
  host?: string;
  /** Directory of the built client to serve (single-origin app). */
  clientDir?: string;
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
  const vault = await openVault();
  // Backfill the owned-layer membership for any pre-Study-Layer anchors/notes.
  await migrateStudyLayers(vault);
  const app = createApp({ vault, clientDir: options.clientDir });
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
