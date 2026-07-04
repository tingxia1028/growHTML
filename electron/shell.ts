// Pure helpers for the Electron main process, kept free of any `electron`
// import so they can be unit-tested under Vitest (electron is not importable
// outside the Electron runtime).

export function isDevMode(env: NodeJS.ProcessEnv, argv: string[] = []): boolean {
  return env.ELECTRON_DEV === "1" || env.ELECTRON_DEV === "true" || argv.includes("--dev");
}

export const DEV_SERVER_URL = "http://127.0.0.1:5173";

// In dev we point the window at the Vite dev server (it proxies /api to the
// in-process server); in production we load the single-origin server URL.
export function resolveStartUrl(env: NodeJS.ProcessEnv, serverUrl: string): string {
  return isDevMode(env) ? (env.ELECTRON_DEV_URL ?? DEV_SERVER_URL) : serverUrl;
}

// The built client lives next to the bundled main process: dist-electron/main.cjs
// → ../dist. In dev the client is served by Vite, so no clientDir is needed.
export function resolveClientDir(env: NodeJS.ProcessEnv, dirname: string, join: (...parts: string[]) => string): string | undefined {
  return isDevMode(env) ? undefined : join(dirname, "..", "dist");
}

// Where the study vault lives (X1). Returns an EXPLICIT override root, or
// undefined to keep openVault's default resolution:
//   - STUDY_VAULT_ROOT env always wins (openVault already resolves it) → undefined
//   - unpackaged (dev / `npm run electron` from the repo) → undefined, which keeps
//     the historical cwd-relative `data/vault`
//   - packaged install → `<userData>/vault` — the install dir is not writable and
//     is not where a user's study data belongs.
export function resolveVaultRoot(
  env: NodeJS.ProcessEnv,
  isPackaged: boolean,
  userDataDir: string,
  join: (...parts: string[]) => string
): string | undefined {
  if (env.STUDY_VAULT_ROOT) return undefined;
  if (!isPackaged) return undefined;
  return join(userDataDir, "vault");
}
