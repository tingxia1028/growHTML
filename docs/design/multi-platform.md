# Multi-Platform (Windows · macOS · Android · iOS) + Packaging & Release

The path from "one Windows Electron dev build launched by a script" to shipping on four
platforms with a release pipeline. Grounded in the tree (2026-07): `package.json` has **no
packager at all** — no electron-builder/forge, no signing, no updater; `electron:build` =
esbuild main/preload + vite build, launched by `scripts/launch-electron.cjs`; version 0.1.0.
Native baggage: `node-pty` (terminal + claude-pty; per-platform rebuild via
`electron:rebuild`, desktop-only). Companion to `architecture-review.md` (X0 ⊃ F2) and
`roadmap.md` (X-track).

## 0. Locked decisions (user, 2026-07)
1. **Mobile = Capacitor shell over the SAME React client, both Android + iOS simultaneously**
   (one shell, two store pipelines).
2. **Mobile V1 scope = 阅读 + 批注 + AI 聊天** — PDF/HTML reading, anchors+notes, AI chat
   (managed/BYOK-http). Explicitly OUT of V1: terminal (node-pty), webview-guest reading
   (live web / local HTML via Electron `<webview>`), cli-agent providers, svpack import.
3. **Desktop distribution = GitHub Releases + electron-updater auto-update** (latest/beta
   channels; domestic download mirror can be added later without changing the mechanism).

## 1. The core architectural call: where does the "server" run?
Today the app is client → HTTP → **in-process Node/Express server** (inside Electron main,
`src/server/start.ts`) → JSONL vault on disk. Phones have no Node. Evaluated:

| Route | Verdict |
|---|---|
| **A. Capacitor + shared core** — core logic runs IN the WebView; vault = real JSONL files via Capacitor Filesystem (same format as desktop) | ✅ **chosen**: 100% UI reuse, one vault format everywhere, local-first preserved |
| B. nodejs-mobile (embed Node) | ❌ fragile/heavy, iOS JIT constraints, weak maintenance |
| C. Mobile as thin client to a hosted server | ❌ breaks local-first; makes the G-track gateway a hard prerequisite |
| D. React Native / Flutter rewrite | ❌ a second codebase |

**Route A's honest cost is X0**, and it is exactly the debt `architecture-review.md` already
named:

### X0 — the shared-core enabler (F2 in full + storage adapter + node-dep audit)
1. **Service-layer extraction (F2 完全体).** app.ts's ~59 route bodies become
   transport-agnostic service functions (`src/server/services/` or `src/core/services/`).
   Desktop: Express handlers become one-line wrappers (zero behavior change — testable by
   the existing 200+ server tests). Mobile: the WebView calls the same services directly
   through an `entityClient` **backend adapter** (`http` today / `direct` on mobile) — the
   client's data seam is already centralized in `entityClient.ts`, so the swap is one layer.
2. **Storage adapter for mobile.** The vault already reads/writes through `StorageAdapter`
   (`src/core/storage/adapter.ts`; `nodeStorage.ts` is just one impl). Add a
   **Capacitor-Filesystem adapter** (app Documents dir → real files, user-backupable,
   survives WKWebView storage eviction — deliberately NOT IndexedDB/OPFS for the vault).
3. **Node-dependency audit of everything mobile V1 touches** (server-only leaves stay
   server-only):
   | Dep | Mobile status |
   |---|---|
   | `linkedom` (HTML ingest), `fflate`, `pdfjs-dist`, `mermaid`, `markmap`, zod, ulid | ✅ pure JS / browser-native |
   | `node:crypto` in `src/core/crypto` (svpack) + contentHash | V1 excluded on mobile; V2 = WebCrypto port (AES-GCM/HKDF/Ed25519 all exist in WebCrypto) |
   | `node-pty`, Electron `<webview>`, claude/codex SDKs (subprocess) | desktop-only, gated (see matrix) |
4. **Capability gating is mostly free**: AI providers hide by `kind` (A1 registry — mobile
   registers only mock/http/managed); desktop-only views (terminal) mount behind the
   existing desktop flag pattern (`window.studyVault`).

## 2. Capability matrix (honest)
| Capability | Win/macOS (Electron) | Android/iOS (Capacitor V1) |
|---|---|---|
| PDF / HTML / markdown reading + anchors + notes | ✓ | ✓ same code |
| Live web / local-HTML (webview guest realm) | ✓ | ✗ V1 (degrade: open externally); revisit after **F3** unifies reader paint |
| AI mock / BYOK-http / managed | ✓ | ✓ (vendor CORS via Capacitor native HTTP plugin) |
| AI cli-agent (claude/codex subscriptions) | ✓ | ✗ (kind-gated, auto-hidden) |
| Terminal (xterm + node-pty) | ✓ | ✗ |
| svpack export/import | ✓ | V2 (WebCrypto port) |
| Cross-device sync | — | V1 = standalone vault; real sync = accounts (G-track follow-on, already agreed) |

## 3. Packaging & release pipeline
### Desktop (X1)
- **electron-builder**: Windows NSIS installer; macOS **universal dmg+zip (x64+arm64)** with
  hardenedRuntime + entitlements + **notarization** (notarytool). `node-pty` per-platform
  rebuild hooks. `asarUnpack` for native modules.
- **Auto-update**: electron-updater against GitHub Releases; channels latest/beta;
  staged-rollout later if needed.
- **Signing reality**: macOS **requires** an Apple Developer account ($99/yr — user to-do,
  same class as 个体工商户); Windows Authenticode is optional at first (SmartScreen warning
  without it; Azure Trusted Signing later).
### Mobile (X2/X3)
- One Capacitor project (`mobile/`), both platforms: Android → AAB + upload keystore;
  iOS → Xcode + TestFlight.
- **China reality (rides the license track)**: Google Play doesn't cover the mainland —
  domestic stores (华为/小米/应用宝) generally require **软著**; interim = direct APK from
  the site. iOS mainland App Store listing requires **ICP 备案** (post-2024 rule). Both gate
  STORE distribution, not development/TestFlight.
### CI/CD (X4, GitHub Actions)
- PR gate: `tsc` + `vitest` + Playwright e2e (web config).
- Tag `v*`: matrix build (windows-latest, macos-latest → desktop artifacts + notarize;
  macos → iOS archive; ubuntu → Android AAB) → draft GitHub Release with `latest.yml`
  feeds. Version single-sourced from package.json.

## 4. Phases (each independently shippable)
- **X0 — shared-core enabler**: service-layer extraction (F2 full), entityClient backend
  adapter seam, Capacitor-FS storage adapter, node-dep audit. Desktop behavior unchanged
  (existing server tests are the guard). *Parallel-safe: server+core files, no reader files.*
- **X1 — desktop packaging + updates**: electron-builder config (win+mac), signing/notarize,
  electron-updater + GitHub Releases, CI release job. First shippable installer.
- **X2 — mobile shell (both platforms)**: Capacitor project; direct-core backend; FS
  adapter; V1 scope per §0 (reading+annotation+AI chat); device debug loops on Android
  (local) + iOS (needs a Mac in the loop — flagged).
- **X3 — mobile distribution**: direct APK + TestFlight now; domestic stores + App Store
  China when 软著/ICP/license land.
- **X4 — release train**: e2e gates, channels, changelog discipline, crash/log story.

## 5. Dependencies & risks
- **X0 ⊃ F2** (do it once, as this); **F3** unblocks webview-guest parity on mobile (V2);
  **G-track** hosts future account sync; **license track** gates store distribution.
- iOS WKWebView storage eviction → vault on Capacitor Filesystem (files), never IndexedDB.
- `node-pty` must never enter the mobile bundle (Capacitor build excludes server entry —
  enforce with a build-time import check in X2).
- Apple Developer enrollment + a Mac for iOS signing/debug are user-side prerequisites
  (X2 can develop Android-first in practice while those arrive, even though both shells are
  built together).
- Windows unsigned SmartScreen friction until a cert lands (accepted for now).

## 6. Tests
- X0: existing server suite green over the extracted services (the refactor guard) + a new
  direct-call adapter test that runs a service roundtrip without HTTP.
- X1: CI produces installable artifacts on both OSes; update from vN→vN+1 verified once
  manually, then scripted.
- X2: Playwright web config against the Capacitor dev server for the V1 scope; a device
  smoke checklist (open PDF → anchor → note → AI chat).
