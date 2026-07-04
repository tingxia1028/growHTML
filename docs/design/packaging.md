# Packaging — Windows desktop (X1)

X1 makes the app installable: NSIS installer for Windows x64 via electron-builder,
auto-update via electron-updater against GitHub Releases. macOS is explicitly
deferred (no Apple Developer account yet — signing/notarization are mandatory there).
Grounding: roadmap.md X1 · multi-platform.md §3.

## How to build

```
npm run dist:dir   # unpacked app → release/win-unpacked/Growte.exe (fast smoke test)
npm run dist       # NSIS installer → release/Growte Setup <version>.exe (+ latest.yml)
```

Both run `electron:build` first (vite client → `dist/`, esbuild main/preloads →
`dist-electron/`). `release/` is gitignored. Version single-sources from
`package.json` — `/api/about` serves it (the package.json is inlined into the
server bundle at build time) and the UserMenu 关于 row displays it.

Note (`scripts/prep-electron-dist.cjs` + `electronDist` in electron-builder.yml):
the builder packages from a staged clean copy of `node_modules/electron/dist`
instead of downloading+extracting the Electron zip. Two reasons, both observed
on the dev machine: the extract→rename step EPERMs (something persistently holds
a handle on the freshly extracted directory), and the dev launcher
(`scripts/launch-electron.cjs`) brands a `Growte.exe` into the real dist dir
which a running dev client locks — the stage sidesteps both without killing the
live session. The stage is refreshed only when the installed Electron changes.

## Bundle strategy (the node_modules decision)

`dist-electron/main.cjs` is a FULL esbuild bundle: Electron main + the Express
server + every pure-JS dependency (express, msedge-tts, linkedom, ai/@ai-sdk/*,
electron-updater, electron-log, zod, …). Consequently `package.json
dependencies` is reduced to the only two packages that must exist on disk at
runtime, and electron-builder ships exactly those (+ transitives):

- **node-pty** — native N-API prebuilds (`prebuilds/win32-x64`; ABI-stable across
  Node/Electron, so `npmRebuild: false` and no toolchain at package time). It is
  lazy-imported (`electron/pty-bridge.ts`, `src/ai/pty/nodePtySession.ts`): a
  load failure degrades only the (hidden/deferred) terminal feature, never boot.
- **@anthropic-ai/claude-agent-sdk** — spawns its vendored `cli.js` relative to
  its own package dir; bundling would break that path resolution.

Both are `asarUnpack`ed (native binaries and spawned files cannot live inside
asar). Everything else in package.json is a devDependency consumed by
vite/esbuild — that is the standard electron-builder single-package layout
("dependencies = what ships").

**Deliberately NOT shipped: `@openai/codex-sdk`** — its `@openai/codex`
dependency vendors a **308MB** `codex.exe`. Selecting the codex provider in a
packaged build fails its lazy import with a clear error; every other provider
(mock/BYOK-http/claude cli-agent) works. Revisit if codex ships a slim SDK or we
add a "use codex from PATH" mode.

## Where data lives

| Mode | Vault root | Override |
|---|---|---|
| Packaged install | `%APPDATA%\Growte\vault` (`app.getPath("userData")/vault`) | `STUDY_VAULT_ROOT` env always wins |
| Dev / repo `npm run electron` | `<cwd>/data/vault` (unchanged) | `STUDY_VAULT_ROOT` |

Resolution: `electron/shell.ts resolveVaultRoot` (unit-tested) → passed through
`startServer({ vaultRoot })` → `openVault({ rootDir })`. AI provider config stays
in `~/.growte` (safeStorage-backed in the packaged app), identity in
`~/.growte/identity` — both user-scoped already, unaffected by packaging.

Logs: `%APPDATA%\Growte\logs\main.log` (electron-log). Boot writes the chosen
server URL + vault root; the updater logs there too.

## Updates + publish flow (manual for now)

- On every packaged boot, `electron/main.ts checkForUpdates()` runs
  `autoUpdater.checkForUpdatesAndNotify()` against the GitHub Releases feed
  (`electron-builder.yml publish: tingxia1028/growHTML`). Errors are logged and
  never block startup; UI is the native toast only (V1).
- **Publishing a release (manual):**
  1. Bump `package.json` version.
  2. `npm run dist` (green gates first: `npm run check`, `npx vitest run`).
  3. Either `npx electron-builder --win --x64 --publish always` with `GH_TOKEN`
     set, or create a GitHub Release by hand and upload
     `release/Growte Setup <version>.exe`, `…​.exe.blockmap`, and
     `release/latest.yml` (the updater feed file — required). Manual upload
     caveat: `latest.yml` references the asset with spaces DASHED
     (`Growte-Setup-<version>.exe`) — rename the uploaded exe/blockmap to match
     (GitHub does this automatically on upload; verify).
  4. Publish the release (not draft) — installed apps pick it up on next boot.
- CI release job = X4 (multi-platform.md §3), not this phase.

## Known gaps / TODO

- **Icon**: `electron/assets/growte-anchor.ico` (16–256px) is used for the exe,
  installer, and window. It is a placeholder-grade anchor mark — replace with
  real art before public distribution.
- **Code signing**: none — Windows SmartScreen will warn on first run (accepted
  for now; Azure Trusted Signing later, see multi-platform.md §3).
- **macOS**: deferred until the Apple Developer account exists (dmg+zip,
  hardenedRuntime, notarytool — spec already in multi-platform.md §3).
- The NSIS installer is per-user (`perMachine: false`), install-dir choosable
  (`oneClick: false`).
- **Installer size (~153MB)**: dominated by the claude SDK's vendored native
  `claude.exe` (`@anthropic-ai/claude-agent-sdk-win32-x64`, 215MB unpacked) —
  shipped so the claude cli-agent provider works out of the box. If size ever
  matters more than that, exclude it the same way codex was and require a
  user-installed claude CLI.
