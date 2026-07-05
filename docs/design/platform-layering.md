# Platform layering — the 3-layer boundary refactor (UI / application / platform)

Status: **Plan, verification-grounded (2026-07-05).** Owner-proposed; every claim below grepped against
HEAD `887fb0a` + cross-verified by a second agent pass. Goal: split the codebase into **UI (React, display
only) · application (note/anchor/source/chat/review business flows) · platform (files/storage/dialogs/
clipboard/stream/native)** and make the boundaries LINT-ENFORCED, so Electron/Web/Capacitor become just
different launch shells. Pays off NOW via F1 (the #1 architecture risk / merge-contention source), not only
for the (paused) mobile track.

## Current state (verified — more seamed than it looks; the work is two client chunks)
ALREADY DONE, load-bearing, green, dual-backend-tested (`directTransport.test.ts`):
- `VaultTransport` (`transport.ts:20-27`) + `createHttpTransport`/`createDirectTransport` +
  `configureVaultTransport` (`entityClient.ts:805-821`) — all JSON routes go through the transport.
- `StorageAdapter` (`adapter.ts:6-19`) injected via `openVault({storage})` — the file-bytes seam;
  `nodeStorage` + `memoryStorage` exist.
- The vault-free iron rule is TRUE in code (no `src/ai/**` imports the store) — just UNENFORCED.

Plan-only, ZERO code yet: `x2a-build-spec.md` + `sqlite-migration-build-spec.md` (no `src/client/mobile/`,
no `capacitorStorage.ts`). "Done" credit is the pre-existing X0 seams, not these specs.

## The 6 parts — EXISTS / NEW / real size
1. **PlatformAdapter (client)** — GREENFIELD, **~30 files** (not 4). Funnel: `window.studyVault` 17/7 files,
   `localStorage` 41/14, `window.confirm/prompt/alert` 22/12, bare `fetch(` 12/9. A `PlatformAdapter`
   (`kind` + `capabilities` + `prefs`/`dialogs`/`files`/`clipboard`/`assets`) with desktop/web impls;
   mobile later. Client-only → **parallelizable with SQLite**.
2. **Split WorkspaceContext** — the BIGGEST/RISKIEST + the real bulk. Actual **2680 lines, 128-field
   `WorkspaceContextValue`, 67 activeSource refs, 45 useState/71 useCallback** (the F1 doc's 1753/79/46 is
   stale by ~50% — reconciled). 17 natural domain seams already banner-marked in the type. Split by domain
   (source/note/anchor/chat/layout/platform); `WorkspaceContext` only COMPOSES; domains depend on
   `entityClient` + `platform`, never `window`/`electron`. Incremental (do NOT rewrite at once).
3. **VaultTransport** — interface DONE for JSON; the 3 HTTP-only holes (`assetUrl` `:1232`, `chatStream`
   `:1257`, `agentStream` `:1324`) are by-design (`transport.ts:10-18`). Real remaining work = the
   **directTransport ROUTE-coverage gap** (workspace/plugin/operations/concepts/relations/assets/vault = 0
   each) — mobile parity (x2a commit-2). Reframe "widen the interface" → "close the route gap."
4. **De-Node the vault** — file-bytes seam DONE; remaining = 3 Node deps in `vault.ts` (`node:path` `:1`,
   `process.cwd()`/env default `:33-35`, `nodeStorage` default `:87`) + a `PathAdapter` (or logical
   `/`-paths). **⚠ `CapacitorStorage` does NOT exist yet** (only node/memory — x2a plans it, unimplemented).
5. **Desktop isolation + mobile import guard** — NO boundary enforcement exists anywhere (this is the FIRST
   in the repo, no pattern to copy). Desktop-only surfaces confirmed: `<webview>` (`WebviewReader.tsx`),
   node-pty (`nodePtySession.ts`, `pty-bridge.ts:67-93`), `safeStorage` (`keyStore.ts`), CLI agents
   (`claudeCliProvider.ts`), svpack `node:crypto` (`crypto/primitives.ts`, `sealedImports.ts:10,127-130`).
   `scripts/check-mobile-imports.ts` forbids electron/node:*/pty/webview in the mobile bundle. **BLOCKED by
   the barrel leak below.**
6. **Acceptance = lint-enforced boundaries.** Current status: core ⊄ React/window/electron TRUE; portable
   ⊄ node:fs/path VIOLATED only by `vault.ts` (=Part 4); views ⊄ fetch/studyVault/localStorage VIOLATED
   (=Part 1); entityClient all-through-transport PARTIAL (3 by-design holes + hardcoded `/api/assets/${id}`
   at `ChatMessageBody.tsx:60`, `views.tsx:781`); WorkspaceContext only-composes VIOLATED (=Part 2);
   mobile-build node-free UNENFORCED. The rules become CI/lint checks (enforced > verbal — same spirit as
   the vault-free iron rule).

## Two things the owner's plan missed (both real)
- **The `vault.ts`/`openVault` co-land pin with SQLite #47.** Both refactors edit the SAME call:
  `openVault(...)` → `createEntityStores(paths.studyDir, storage)` (`vault.ts:110`). Part 4 removes the
  `storage`/`process.cwd()` defaults; SQLite adds an `engine` param. Additive → **land BOTH on the
  signature in ONE PR**, then the two tracks proceed independently (no other overlap). This is the only
  serialization point.
- **The `errors.ts` barrel-leak prerequisite (before the guard can go green).** `VisionUnsupportedError`
  lives in the `src/ai` barrel; `errors.ts:8` pulls that barrel (with `node:child_process`/`crypto`) into
  **8 of 12 directTransport services** (20 files import `errors.ts`). Relocate `VisionUnsupportedError` out
  of the barrel FIRST (x2a delta already flags this) or the mobile import guard is red on day one.

## Sequencing (owner order, validated + corrected)
1. **PlatformAdapter type + desktop/web impls** — clean, bounded, HIGH-leverage first step (~30 call-sites,
   parallel with SQLite). 2. **Funnel** localStorage/confirm/window.studyVault into it. 3. **WorkspaceContext
   domains** — promote/re-budget: #1 risk, the bulk; incremental. 4. **directTransport route coverage** (the
   real Part-3 work) + the `assetUrl` seam ripple. 5. **`errors.ts` barrel fix** (guard prerequisite).
   6. **De-Node `vault.ts`** — co-land the `openVault`/`createEntityStores` signature WITH SQLite's `engine`
   param. 7. **mobile import guard.** 8. **Capacitor shell** (last, device-gated, PAUSED mobile track).

**Parallel vs serial with SQLite #47:** PARALLEL (never touch `vault.ts`) — Parts 1, 2, the `errors.ts`
barrel fix, directTransport route additions, the assetUrl ripple. SERIAL on `vault.ts` — Part 4 de-Node ↔
SQLite `engine` thread (one shared signature PR).

## Doc reconciliations done with this plan
`architecture-review.md` F1 numbers refreshed (1753→2680 lines, 79→128 fields, 46→67 refs). `CapacitorStorage`
noted as unimplemented (x2a plan-only). x2a/sqlite line refs have drifted (files grew) — trust the greps here.
