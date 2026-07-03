# Progress Log

Use this file as the live status board for implementation work.

## Current Status

- Date: 2026-07-02
- Phase: Source Viewer annotation markers
- Active task: None
- Overall status: Complete. Newly materialized focused anchors now enter the client paint/reveal projection and show immediately.

## 2026-07-02 - ANNOT-FOCUS-001 Newly focused anchor visibility

- Goal: a newly added/materialized anchor should immediately show its Source Viewer anchor marker, even when it does not yet have a visible note.
- Active plan: merge the current `focus.anchor` into the workspace anchor list for the active source before deriving `paintAnchors` and `revealAnchors`, without changing the server's historical note-less anchor cleanup.
- Result: `WorkspaceContext` now merges the current focused anchor into the client-visible anchor projection, and the DOM annotation dispatcher paints claimed anchors even when their note list is empty so the marker overlay has a positioning key. No-note markers now render only the anchor glyph, not a fake markdown note glyph.
- Verification: `npx vitest run src/client/workspace/anchorProjection.test.ts src/client/markerOverlay.test.ts src/client/annotationMarkers.test.ts src/client/annotations.test.ts src/client/annotationDom.test.ts src/client/surfaces/DomReader.test.ts`; `npm run check`; `npm run build`; `npm run electron:build:webview-preload`; desktop client restarted.

## 2026-07-02 - ANNOT-MARKER-001 Interactive annotation markers

- Goal: Source Viewer passages with notes should show clear anchor/note marker icons; clicking the anchor marker should focus/reveal the anchor, and clicking the note marker should open the shared note card with every note attached to that anchor.
- Active plan: make `buildMarkerHtml` emit role-marked controls, have `MarkerOverlay` handle marker clicks and dispatch note-card clicks to the live annotated element, and thread an anchor-focus callback from `WorkspaceContext` through the reader contract.
- Result: marker chips now render explicit anchor/note buttons; PDF/image/DOM snapshot readers route marker actions through `MarkerOverlay`, while live/local webview readers forward marker clicks from the guest preload. Note marker clicks reuse the shared annotation card so multi-note anchors show all note previews instead of a single raw note window.
- Verification: `npx vitest run src/client/markerOverlay.test.ts src/client/annotationMarkers.test.ts src/client/annotationDom.test.ts src/client/surfaces/DomReader.test.ts src/client/selection/webviewSelection.test.ts`; `npm run check`; `npm run build`; `npm run electron:build:webview-preload`; desktop client restarted.

## 2026-07-01 - ANNOT-PIN-001 Pinned annotation card follows anchor

- Goal: pinned Source Viewer note cards should track the source text/anchor as the document scrolls or resizes, instead of staying at the old window coordinate after the page has moved away.
- Active plan: keep the current highlighted target in `annotationLayer`, place the card from the live target rect, recompute on scroll/resize, ignore legacy saved `left/top` for ordinary positioning, and persist anchor-relative offsets only after drag/resize.
- Result: click-pinned cards now recompute from their anchor target. Old saved viewport coordinates only restore card size; dragged cards store `anchorDx/anchorDy` so custom placement also follows the text. Clicking a different highlighted anchor switches the pinned card instead of closing it.
- Verification: `npx vitest run src/client/annotationDom.test.ts`; `npm run check`; `npm run build`; `npm run electron:build:webview-preload`.

## 2026-07-01 - LINKED-NOTE-001 Linked note focus behavior

- Goal: clicking a Linked Notes icon should jump the source viewer to the anchor and show the note's small card in the Notes viewer, not open an inline popover beside the Anchor panel.
- Active plan: remove the local `openNoteId` preview state from `anchorViews`, set anchor focus + note focus on click, auto-switch the right sidebar to the Notes tab on note focus, and highlight/scroll the matching note card in `NoteListPanel`.
- Verification target: `npm run check`, focused workspace tests for click/focus behavior, and `npm run build` if the UI bundle path changes.
- Result: Anchor-panel linked-note icons no longer render an inline `ArtifactCard`; clicking them calls `focus.setAnchor(anchor)` and then focuses `{type:"note"}`. The right sidebar switches to Notes on note focus, and NoteListPanel opens, scrolls to, and blue-highlights the focused note card.
- Verification: `npm run check`; `npx vitest run src/client/workspace/anchorViews.test.tsx src/client/workspace/NoteListPanel.test.tsx src/client/workspace/RightSidebarTabs.test.tsx`; `npm run build`.

## 2026-07-01 - ANNOT-REF-001 Source Viewer note popover and marker pass

- Goal: make Source Viewer annotation popovers use the same note preview form as the Notes/Anchor lists, and show compact anchor markers/counts beside highlighted passages.
- Active plan: extend the host-built `PaintAnchor` payload with safe preview metadata, keep `annotationLayer` framework-free, and render markers/popovers from those attributes across DOM/PDF/webview/image surfaces.
- Verification target: `npm run check`, focused annotation/surface tests, and a Playwright smoke screenshot against the running Source Viewer.
- Result: `PaintAnchor` now carries per-note preview metadata; DOM/PDF/image/webview annotation painters forward rich note HTML and note counts to the shared annotation layer; the floating card renders preview-card HTML instead of raw JSON; highlighted anchors receive a compact anchor/count badge. Desktop Growte was restarted after rebuilding `dist-electron/webview-preload.cjs`.
- Verification: `npm run check`; `npx vitest run src/client/annotationDom.test.ts src/client/surfaces/DomReader.test.ts src/client/selection/webviewSelection.test.ts src/client/surfaces/overlay.test.ts src/client/surfaces/DomReader.reveal.test.tsx`; `npm run build`; browser smoke confirmed the app and Source Viewer mount at `http://127.0.0.1:5173`.

## 2026-07-01 - NOTE-REF-001 note preview/expanded reference pass

- Goal: make all note type preview cards and expanded views use the supplied Note card system visual language.
- Active plan: preserve the existing NoteType registry and shared `ArtifactCard`/`FocusOverlay` path; replace the shared shell styling and add per-type preview/full visual treatments.
- Verification target: `npm run check`, focused component/unit tests for artifact cards, note type registry, and note list behavior; screenshot smoke if the dev server is available.
- Result: shared note previews now use the compact reference card shell; expanded note windows use the horizontal reference shell with icon/title/anchor/layer/actions; built-in markdown, quiz, flashcard, media, interactive, diagram, and code types have matching body treatments. Textbook kit note types now return compact card previews in `mode: "card"` instead of rendering full study blocks inside preview cards.
- Verification: `npm run check`; focused Vitest suites for artifact cards, note type registry, workspace views, bookmarks, and textbook note types; Playwright smoke screenshots saved under `C:/Users/Jump/AppData/Local/Temp/note-ref-001-smoke-kit-card.png` and `C:/Users/Jump/AppData/Local/Temp/note-ref-001-overlay-final.png`.

## 2026-06-29 - Frameless window controls

- Goal: keep the title/menu bar removed while bringing back `- / square / x` window controls.
- Result: added a narrow Electron window-control IPC bridge, desktop-only TopBar buttons, Windows-like hover styling, and no-drag handling. Restarted the desktop client so the new preload is active.
- Verification: `npm run check`, browser hidden-controls smoke, Electron main/preload builds, Electron DOM smoke, and `npm run build` passed.

## 2026-06-29 - Opened-file reader tab header

- Goal: make the active file tab in the reader header match the reference crop instead of looking like a blue selected button.
- Result: replaced the active file icon with the document-style icon and restyled the active tab as a white neutral page tab with gray text/icons, soft border, top-only radius, and a hidden bottom border that connects to the reader surface.
- Verification: `npm run check`, browser computed-style/screenshot smoke, and `npm run build` passed.

## 2026-06-29 - UI typography and grayscale calibration

- Goal: make controls, labels, muted text, borders, and icons closer to the reference's lighter neutral hierarchy.
- Result: softened the default light theme tokens, control text weights, active blue states, neutral borders, muted labels, chat bubbles, and Layer Lens/card shadows. Runtime default-theme injection now matches the CSS calibration.
- Verification: `npm run check`, focused theme registry test, in-app browser computed-style/screenshot smoke, and `npm run build` passed.

## 2026-06-29 - UI pure AI chat

- Goal: make AI Chat use a bottom command-style input with the conversation history above it, and remove note support from the chat panel.
- Result: removed Note mode, note type detection, save-reply-as-note actions, selection note toolbar, and generation preview from AI Chat. The panel is now title/context, a scrollable conversation history, and a bottom `Type / for commands` input with a return-arrow send button. The composer submit path is fixed to `anchor.ask-ai`.
- Verification: `npm run check`, browser DOM smoke against `http://127.0.0.1:5173`, and `npm run build` passed.

## 2026-06-29 - UI no-note anchor cleanup

- Goal: remove the Layer Lens control for showing anchors without visible notes, and automatically clear anchors that no note references.
- Result: removed the Layer Lens no-note anchor switch; source anchor painting now only returns anchors backed by visible notes; note-less orphan anchors are pruned when reading anchors, deleting notes, or detaching anchors from notes. Patch-referenced anchors are kept internally for patch integrity but no longer paint without a note.
- Verification: `npm run check`, `npx vitest run src/server/app.test.ts`, browser DOM smoke against `http://127.0.0.1:5173`, and `npm run build` passed.

## 2026-06-29 - UI panel containment

- Goal: make all docked columns adapt their contents to the panel border width, fixing the AI Chat composer row clipping the `Save Note` button.
- Result: major panel containers now clamp content to their border boxes; compact rows such as `.composer-actions` wrap; the detected-type chip, note type picker, and primary composer button shrink or move to the next line instead of overflowing.
- Verification: `npm run check` and `npm run build` passed; Playwright DOM width check confirmed `.library-panel`, `.reader-panel`, `.anchor-panel`, `.study-panel`, and `.composer-actions` all have `scrollWidth <= clientWidth`.

## 2026-06-29 - UI brand mark refinement

- Goal: make the top-left anchor icon and `Growte` wordmark match the reference crop more closely.
- Result: the anchor icon is larger and black with the original line weight, and the wordmark now uses the bundled Source Serif 4 at a lighter weight instead of the heavier sans-serif rendering.
- Verification: `npm run check` and `npm run build` passed; browser crop screenshot `C:/Users/Jump/AppData/Local/Temp/growte-top-left-after.png` confirms the serif wordmark and larger icon.

## 2026-06-29 - UI native title bar removal

- Goal: remove the OS-level strip showing the app icon and `GrowHTML` title above the React UI.
- Result: Electron now creates the main window with `frame: false`; the in-app `.topbar` is marked as the drag region, while its buttons/popovers are explicitly no-drag so controls remain clickable.
- Verification: `npm run check`, `npm run electron:build:main`, and `npm run electron:build:preload` passed; Electron dev client was restarted with the rebuilt `dist-electron/main.cjs`.

## 2026-06-29 - UI folder tree shell removal

- Goal: remove the extra card shell around the open-folder tree headed by the folder name, such as `testinput`.
- Result: `LibraryView` now renders the `FileTree` directly in a lightweight host; the duplicate `.folder-root-head` title bar is gone, and the close affordance is a small overlay button rather than a bordered panel header.
- Verification: `npm run check` and `npm run build` passed; build emitted only the existing chunk-size warning.

## 2026-06-29 - UI collapsed rail removal

- Goal: remove folded vertical dock tabs such as "Sources" from the simplified reference UI.
- Result: pane collapse is disabled at the dock model level; explicit user collapse state and narrow-viewport auto-collapse are both ignored, so `.dock-rail` and `.dock-collapse-btn` are no longer rendered.
- Verification: `npm run check`, targeted `dock.test.ts`, DOM smoke against the running app, and `npm run build` passed; the Playwright spec command was blocked by the already-running dev server on port 4177, so the same absence checks were verified with the live app DOM smoke.

## 2026-06-29 - UI chrome cleanup

- Goal: remove the native desktop menu, the top-right book/settings buttons, and the saved note list in the right sidebar.
- Result: Electron now hides the application menu, TopBar only keeps Layers and Concepts on the right, and StudyView no longer renders `.note-list` cards.
- Verification: `npm run check` and `npm run build` passed; DOM smoke confirmed the two top-right buttons and right-panel note list are absent; Electron dev client relaunched.

## 2026-06-29 - UI reference recreation

- Goal: recreate the supplied Growte workspace screenshot in the existing React/Vite workspace shell.
- Result: added a TopBar Layer Lens popover, tightened the default dock widths, polished topbar/rail/panels/PDF toolbar/right chat styling, and changed the empty-vault demo to a physics textbook page.
- Verification: `npm run check`, `npx vitest run scripts/seed.test.ts`, `npm run test`, Playwright screenshot at 1600x900, and `npm run build` passed.

## Previous Status

- Date: 2026-06-23
- Phase: Post-Slice-1 — desktop shell in place; read+annotate experience runs in web + Electron
- Active task: PTY transport provider (`claude-pty`) done (token-efficient persistent session). Next: visible xterm terminal plugin + Electron node-pty bridge (needs `@electron/rebuild`, display verify). Backlog: mobile Capacitor adapter, packaging, per-author shared-note filtering.
- Overall status: all green — 89 unit, 5 web e2e, 2 electron e2e. Core data layer is now Node-dependency-free except `NodeStorageAdapter` (mobile-ready). Remaining manual checks: visible Electron window + webview guest select→highlight (both display-only).

## Completed

| Time | Task | Notes |
| --- | --- | --- |
| 2026-06-23 | Repository cloned | `growHTML` cloned under `C:\CG\growNote\growHTML`. |
| 2026-06-23 | Project structure reviewed | Confirmed React/Vite/Express TypeScript project and available npm scripts. |
| 2026-06-23 | Workflow docs created | Added implementation planning, progress, verification, subagent, and decision logs under `docs/implementation/`. |
| 2026-06-23 | Implementation branch created | Switched to `codex/ai-study-vault`. |
| 2026-06-23 | Product document reviewed | Read AI Study Vault v0.3 attachment as UTF-8 and extracted core objects/milestones. |
| 2026-06-23 | Obsidian public references checked | Confirmed public references should be API/docs/sample/community plugins, not proprietary app internals. |
| 2026-06-23 | PRD v0.3 read in full | Read `docs/implementation/prd.md`; mapped its objects/milestones/closed-loop onto current code and gaps. |
| 2026-06-23 | Direction approved | Greenfield rewrite in-place; data layer first; provider-as-plugin (Claude Agent SDK first); keep stack + add Zod/Vitest. Recorded in `00`/`04`. |
| 2026-06-23 | Slice 1 plan locked | C1-C8 sequence, verification matrix, fixture contract, store semantics, and HTML adapter split are documented. |
| 2026-06-23 | C1 completed | Added Zod-first entity schemas, typed ULID helpers, golden fixtures, and schema/id tests. `npm run check` and `npm run test` passed. |
| 2026-06-23 | C2 completed | Added JSONL primitives, snapshot upsert store, append-only log support, entity store mapping, and store tests. `npm run check` and `npm run test` passed. |
| 2026-06-23 | C3 completed | Added vault open/create, manifest schema, directory layout creation, entity store wiring, and vault tests. `npm run check` and `npm run test` passed. |
| 2026-06-23 | C4 completed | Added HTML source ingest, source hash/slug/path helpers, source listing/reading, and ingest tests. `npm run check` and `npm run test` passed. |
| 2026-06-23 | C5a completed | Worker added linkedom HTML core, id injection, patch application/materialization, and tests. Integrated with full `npm run check` and `npm run test` passing. |
| 2026-06-23 | C5b completed | Added HTML anchor creation/resolve fallback and guarded patch conflict checks. `npm run check` and `npm run test` passed. |
| 2026-06-23 | C6 completed | Added injectable Express Vault API and supertest coverage for source ingest/list/render, anchors, notes, patch apply/revert, and conflicts. `npm run check` and `npm run test` passed. |
| 2026-06-23 | C8 completed | Added seed script/tests and ran `npm run seed`, creating a deterministic demo source in the default vault. |
| 2026-06-23 | C7 completed | Replaced the old client with a minimal Vault UI: source library, read-only reader, content capture, manual Note, manual Patch, apply/revert, and reload persistence verification. `npm run check`, `npm run test`, `npm run build`, and browser QA passed. |
| 2026-06-23 | Slice 1 code review + fixes | Reviewed all Slice 1 code; fixed store concurrency lost-updates (write lock), path-traversal guard, API enum contracts, patch state machine; removed 8 dead old modules. +2 regression tests. `check`+`test` green. |
| 2026-06-23 | C1 amendment | `Note.contentType` (open string, default markdown) + `metadata` promoted to record envelope (Source deduped); API passes optional contentType; +2 schema tests. `check`+`test` green (45). |
| 2026-06-23 | Click self-test (E2E) | Added Playwright; `e2e/loop.spec.ts` drives the real server+client through the full no-AI loop (isolated `.e2e-vault`). `npm run e2e` green (1 passed). Established as the per-step UI self-verification standard. |
| 2026-06-23 | Webpage URL → local snapshot | `POST /api/sources/url` fetches a URL, sanitizes/absolutizes (linkedom), normalizes the URL, injects study-ids, and stores a local `webpage` Source with `metadata.sourceUrl/normalizedUrl`. Client "Import from URL" box added. `check` + `test` (49) + `e2e` all green. |
| 2026-06-23 | NoteLayer overlay (step ①) | Stored notes now paint onto the reader document as anchored highlights (`.sv-annotated`) with the note text as a hover tooltip, recomputed on notes/anchors change (`decorateNotes`). E2E extended to assert overlay appears on save and survives reload. `check` + `test` (49) + `e2e` green. |
| 2026-06-23 | Open local PDF (step ②) | Binary source ingest (`ingestBinarySource` + `computeBufferHash` + `readSourceFile`), `POST /api/sources/pdf` (base64, `%PDF-` magic guard) and `GET /api/sources/:id/file` (raw bytes). Client "Import PDF" file picker + native PDF reader iframe (`/file`); PDF sources skip the HTML render pipeline. +2 API tests, +1 E2E (import → served bytes). `check` + `test` (51) + `e2e` (2) green. PDF anchoring/notes-on-PDF deferred (needs a PDF.js text layer). |
| 2026-06-23 | Rich note forms (step ③) | `NoteContentRenderer` registry (`src/adapters/notes/render.ts`): pure, dependency-free, XSS-escaped renderers for `markdown` (prose), `mindmap` (nested tree), `flashcard` (flip card); unknown/parse-fail → inert escaped plain text. Client renders notes via the registry + a content-type selector in the composer. +7 renderer unit tests, +1 flashcard E2E, loop E2E asserts markdown→HTML. `check` + `test` (58) + `e2e` (3) green. mermaid/markmap + tier-C sandboxed artifacts deferred. |
| 2026-06-23 | AI runtime + chat (step ④) | Capability-based `ModelProvider` boundary (`src/ai/`): deterministic offline `MockModelProvider` (verified default), `ClaudeCliProvider` scaffold (subprocess `claude -p`, subscription OAuth) with the **`buildSubprocessEnv` API-key-stripping safeguard** unit-tested, `createModelProvider` env-selected factory. `POST /api/chat` (Zod-validated, provider-injected). Client AI Chat panel (context = selected quote + source title) + "Save as note" → markdown note. +5 AI unit tests, +2 chat API tests, +1 chat E2E. `check` + `test` (65) + `e2e` (4) green. Real CLI provider not default / not headlessly tested. |
| 2026-06-23 | Single-origin server | `createApp` optionally serves the built client (`clientDir`) with an SPA fallback; new `startServer` (`src/server/start.ts`) boots vault+Express on a chosen/free port; `src/server/index.ts` serves `dist/` when present. +1 static-serving API test, +1 real-HTTP `startServer` test. `check` + `test` (67) green. |
| 2026-06-23 | Electron shell (desktop) | `electron/` shell: `main.ts` boots the single-origin server in-process (prod) or loads Vite (dev `--dev`), `preload.ts` (locked-down contextBridge), pure tested helpers (`shell.ts`). esbuild bundles main/preload → `dist-electron/*.cjs` (`--packages=external`); scripts `electron:build` / `electron` / `electron:dev`. +3 shell unit tests; both bundles build clean (52.8kb/195b). `check` + `test` (70) + `e2e` (4) green. |
| 2026-06-23 | Electron desktop self-test | Playwright `_electron` test (`e2e-electron/app.spec.ts`, `npm run e2e:electron`) launches the REAL packaged app and drives import → select → anchor → note → on-document overlay → AI chat — proving the renderer loads from the in-process server and the full loop works on the desktop shell. 1 passed (550ms). Electron binary fetched via npmmirror mirror (GitHub stalled in-locale). Visible-window-on-a-display is the only remaining (cosmetic) manual check — this automation session is non-interactive. |
| 2026-06-23 | SourceViewer registry (plugin seam) | Replaced hardcoded `sourceType === "pdf"` branches with a `getSourceViewer` registry (`src/client/viewers.ts`): each type → `{kind, htmlPipeline}`; `registerSourceViewer` lets plugins add/override viewers (e.g. the upcoming `webview`). App reader + workspace loader now consult the registry. Source viewers are now genuine plugins (joining the note-form and AI-provider registries). +3 unit tests. `check` + `test` (73) + `e2e` (4) + `e2e:electron` (1) all green. |
| 2026-06-23 | Webview annotation — core anchor model (slice 1) | Added `web_text_quote` anchor kind (W3C TextQuoteSelector; envelope quote/contextBefore/contextAfter = exact/prefix/suffix + `normalizedUrl`) and a pure `createTextQuoteSelector`/`resolveTextQuote` (`src/adapters/web/textQuote.ts`) that disambiguates repeated quotes via prefix/suffix overlap — no study-ids, works on third-party DOM. +5 unit tests. `check` + `test` (78) green. |
| 2026-06-23 | StorageAdapter seam (mobile prep) | Abstracted all vault `node:fs` behind a `StorageAdapter` interface (`src/core/storage/`): `NodeStorageAdapter` (default; atomic temp+fsync+rename, fsync'd append) + `MemoryStorageAdapter` (reference for a mobile Capacitor/SQLite backend). Threaded an optional `storage` (default Node) through jsonl primitives → snapshot store → entity stores → `openVault` (now exposes `vault.storage`) → sources file I/O. Pure refactor, no behavior change. +1 test runs the WHOLE vault (open/ingest/persist/reopen) on `MemoryStorageAdapter`, proving non-Node portability. `check` + `test` (85) + `e2e` (5) + `e2e:electron` (2) all green. |
| 2026-06-24 | Visible xterm terminal + main PTY bridge | `electron/pty-bridge.ts` (IPC PTY hub, **injectable spawner**: real node-pty lazy-loaded + API-key strip, OR in-process fake echo via `STUDY_VAULT_PTY_FAKE=1`), preload `studyVault.pty` channel, `TerminalPanel.tsx` (xterm.js + fit), "AI Terminal" toggle in the library. Run `claude`/`codex`/any shell live in-app. +1 electron e2e drives the FULL pipeline (toggle → start → output→xterm→mirror, input echo) deterministically via the fake spawner. `check` + `test` (96) + `e2e` (5) + `e2e:electron` (3) all green. Real claude/codex needs node-pty built for Electron: `npm run electron:rebuild` (Windows source build hit a winpty issue in the sandbox; needs MSVC build tools on the target machine). |
| 2026-06-24 | PTY-backed AI provider (transport mode) | New `claude-pty` `ModelProvider` (`src/ai/claudePtyProvider.ts`): keeps ONE persistent interactive `claude` PTY session across turns (reuses CLI context + prompt cache → cheaper multi-turn than cold `claude -p`), behind a `PtySession` seam (`pty/session.ts`: real `nodePtySession.ts` via dynamic-imported `node-pty` + API-key strip; `FakePtySession` for tests). Pure ANSI parser (`pty/terminalParse.ts`). Factory prefers `claude-pty` when `STUDY_VAULT_AI_PROVIDER=claude-pty`; SDK/`-p`/mock remain. +7 unit tests (parser, provider via fake session incl. persistent-session reuse, factory selection without loading node-pty). `check` + `test` (96) + `e2e` (5) + `e2e:electron` (2) all green. node-pty verified loadable under Node (1.1.0, prebuilt); real CLI + Electron ABI rebuild (`@electron/rebuild`) + visible xterm terminal plugin = next slice (manual/display verify). |
| 2026-06-23 | Hashing + path guard de-Node'd (mobile prep) | Replaced `node:crypto` with a pure-TS `sha256Hex` (`src/core/storage/sha256.ts`; same `sha256:` output) and the Node `path.sep` traversal check with a pure `assertSafeRelativePath`. Result: the **non-test core data layer's only hard Node dependency is now `NodeStorageAdapter`** (plus portable `node:path` composition). +4 unit tests (sha256 vs FIPS vectors + cross-block parity with node:crypto; path guard accept/reject). `check` + `test` (89) + `e2e` (5) + `e2e:electron` (2) all green. Mobile port now = write one Capacitor `StorageAdapter` + point the client `api` at an in-process data layer. |
| 2026-06-23 | Diagram note forms — mermaid + markmap (step ③) | Added an async/DOM diagram-renderer registry (`src/adapters/notes/diagrams.ts`, dynamic-imported `mermaid` + `markmap-lib`/`markmap-view` so the main bundle stays lean) alongside the pure string `noteRenderers`. `DiagramNote` mounts the SVG; note list dispatches diagram types to it, others to the sync HTML path. Composer offers `mermaid`/`markmap`. +2 registry unit tests, +1 mermaid e2e (renders `<svg>`). `check` + `test` (84) + `e2e` (5) + `e2e:electron` (2) all green. |
| 2026-06-23 | PDF text-layer anchoring (step ②) | `pdf_selection` anchored by page + quote (`rect` now optional; envelope quote/contextBefore/contextAfter = per-page TextQuoteSelector); `createPdfSelectionAnchor` + `pdf_selection` branch in `POST /api/anchors`. Client: `pdfjs-dist` v6 `PdfReader` (canvas + selectable text layer, worker via Vite `?url`), `pdf` viewer switched to kind `pdfjs`, select → page+quote → anchor, stored anchors highlighted in the text layer. +2 API tests; loop e2e rewritten to a real text PDF (`e2e/fixtures/pdf.ts` builder) driving PDF.js text layer → select → anchor → note → highlight. `check` + `test` (82) + `e2e` (4) + `e2e:electron` (2) all green. |
| 2026-06-23 | Webview annotation — backbone + Electron embed (slices 2–3) | Server/core: `web_live` source type + `POST /api/sources/web-live` (URL kept live, not snapshotted; `ingestWebLiveSource`), `web_text_quote` branch in `POST /api/anchors` (`createWebTextQuoteAnchor`). Electron: `webviewTag` on (sandbox off, contextIsolation on), guest preload `electron/webview-preload.ts` (selection→`sendToHost`, anchors→`<mark>` highlight, reuses tested `textQuote`) bundled to `dist-electron/webview-preload.cjs`, path exposed via `studyVault.webviewPreloadUrl`. Client: `web_live` viewer registered, `WebviewReader` creates the `<webview>` imperatively + IPC wiring, "Open Live" box, web-selection → web anchor. +2 API tests, +1 electron e2e (Open Live → `<webview>` loads fixture URL w/ guest preload). `check` + `test` (80) + `e2e` (4) + `e2e:electron` (2) all green. **Guest-DOM select→highlight round-trip is the only manual (display) check — Playwright can't reliably drive `<webview>` guest content.** |

## In Progress

| Task ID | Work | Owner | Expected Output |
| --- | --- | --- | --- |
| None | None | None | None |

## Blocked

| Task ID | Blocker | Needed To Unblock |
| --- | --- | --- |
| None | None | None |

## Next Action

Current UI task: ANNOT-FOCUS-001 is complete; next action is user visual review in the restarted desktop client.

## 2026-06-30 - Library Open Folder + Recent Read

| Task ID | Status | Owner | Last Update | Next Step |
| --- | --- | --- | --- | --- |
| LIB-001 | Complete | Codex | Library now shows Open Folder above Recent Read, supports multiple folder roots, dedupes repeated picks, and closes each folder independently. | User visual review in the restarted desktop client. |

Ordered read+annotate build ①–④ + Electron shell all DONE (each with unit + click-E2E or build self-tests). To run the desktop app: `npm run electron` (builds client + bundles main/preload + launches the window). Remaining follow-ups: (a) launch the Electron window on a display machine to confirm the GUI (headless env here can't); (b) PDF anchoring/notes-on-PDF (needs a PDF.js text layer; current PDF reader is display-only); (c) real diagram libs (mermaid/markmap) + tier-C sandboxed artifact notes; (d) webview-based live web-page annotation (the Electron-specific superpower); (e) wire/verify the real `claude-cli` provider against an authenticated CLI; (f) packaging (electron-builder).

Known limitation of webpage snapshot: server-side fetch captures pre-JS HTML and links external assets (not offline-inlined); the Electron webview snapshot will later capture the rendered + authenticated DOM with higher fidelity.

## Task Status Template

| Task ID | Status | Owner | Last Update | Next Step |
| --- | --- | --- | --- | --- |
| TBD | Not started | TBD | TBD | TBD |

## 2026-06-24 — Desktop build fix + AI terminal cwd & placement

- **node-pty native build for Electron now works on this machine.** Two toolchain blockers fixed: (1) `NoDefaultCurrentDirectoryInExePath=1` (User scope) made cmd refuse winpty's `GetCommitHash.bat` — removed for the build process; (2) MSB8040 (Spectre-mitigated libs not installed) — flipped node-pty's hardcoded `'SpectreMitigation': 'Spectre'` → `'false'` in `node_modules/node-pty/binding.gyp` + `deps/winpty/src/winpty.gyp` (×2). `electron:rebuild` → ✔. NOTE: these gyp edits live in node_modules and are lost on reinstall — persist via patch-package or install the VS "Spectre-mitigated libs" component for the proper fix.
- **AI terminal moved below AI Chat** in the study panel (was a reader-area swap from a library-panel toggle) and made closable via a Show/Hide control (fixes "can't close once opened").
- **AI terminal working directory is now selectable** and defaults to the folder of the file being read. `pty:start` carries `cwd`; `electron/ptyCwd.ts:resolveCwd` validates it (falls back to `process.cwd()` if missing/not a dir). Native folder picker via `dialog:pickDirectory`. PDF import now captures the file's disk path (`webUtils.getPathForFile`) and persists it as `source.metadata.originalPath`; the client derives the default cwd with `parentDir`.

## Next Action (updated)

In-app multi-tab web reading (B): all link clicks open a new tab; each tab is its own annotatable page. Design confirmed with user (in-app tabs, all-links-open-new-tab). Not yet started.

## 2026-06-24 — Real AI chat (persistent session) + annotation-renderer seam

- **AI chat is now real, not mock.** Root cause: `createModelProvider` defaults to `mock`; electron was launched without `STUDY_VAULT_AI_PROVIDER`. Launch the desktop app with `STUDY_VAULT_AI_PROVIDER=claude-cli` (e2e stays on mock for determinism — default unchanged).
- **Chat uses `claude -p` with a persistent conversation** (user chose this over interactive-TUI scraping). `ClaudeCliProvider`: first turn opens `claude --print --session-id <uuid>` (sends only the new user message + source title + passage); later turns `--resume <uuid>` (only the new message + current passage). Server-side context reuse → prompt-cache hits → cheaper multi-turn. Explicit uuid isolates chat from the visible terminal's claude and from other sources; switching source clears client history → next turn = fresh session id. Windows: spawn through the shell (`claude` is a .cmd) and feed the prompt on stdin (no arg-quoting). Verified at the CLI: `--session-id` create then `--resume` recalled the planted fact.
- **Decided division of labor:** Chat panel = `claude -p --resume` (clean, cheap, has memory, no slash commands). Visible AI Terminal (node-pty) = full interactive claude (slash commands, tool-permission approvals, agents). PTY's value is interactivity, NOT token cost.
- **AnnotationRenderer registry** (`src/client/annotations.ts`): `decorateNotes` refactored into a pluggable seam (mirrors the viewers/noteRenderers registries). Driver injects each renderer's CSS once, clears, groups notes under their anchor, and hands each renderer only the anchor kinds it claims. Built-in `html-highlight` renderer (study-id highlight + title tooltip) preserves prior behavior. `registerAnnotationRenderer` lets sources/extensions add their own painting.
- node-pty native build for Electron fixed earlier this day (see prior entry); the visible terminal now uses a real PTY.

## Deferred (recorded, not building)

- **GrowHTML MCP server** — expose vault ops + current reading context as MCP tools so the in-app AI can operate the vault directly. User said record-only on 2026-06-24. Honor existing invariants (AI source edits via reviewable Patch; subscription env strip).

## 2026-06-24 — Decoupled annotation layer (all viewers) + richer chat context

- **Annotation presentation decoupled from viewers** (`src/client/annotationLayer.ts`): a framework-free shared layer that paints the highlight + the floating note card (hover to show, click to pin), reused by the HTML reader, the webview guest preload, and the PDF reader. Each viewer only resolves an anchor → element (irreducibly surface-specific: `[data-study-id]` / text-quote walk / PDF text-layer span) then calls `applyHighlight`. Adding a new viewer never re-implements the card UI. The `annotations.ts` registry's html renderer now delegates to this layer. Card uses `position: fixed` + viewport rect so it positions correctly whether the surface scrolls the window (iframe/guest) or an inner container (PDF).
- Note text is threaded to the webview/PDF anchor marks (`noteTextByAnchorId`) so the card has content on those surfaces too.
- **Chat context enriched**: every chat turn now sends source title + type + location (URL / file path / page) + the selected quote **with surrounding context** (contextBefore/After), so the assistant knows exactly which source+passage is meant. `chatContextSchema` extended; `claudeCliProvider` builds a Source/Location/Passage block; mock echoes location.
- **Save part of a reply as a note**: assistant replies now have "Save selection as note" (saves the highlighted substring, or the whole reply if nothing is selected) alongside "Save full reply".

## 2026-06-24 — Note card preview/window + in-app web tabs (B)

- **Floating note card upgraded** (`annotationLayer.ts`): renders the note as **markdown preview** (was raw text), and is a **draggable / resizable / pinnable** mini-window (title-bar drag, corner resize via CSS `resize`, click highlight to pin, × to close). Shared across HTML/webview/PDF surfaces. Note text joined as markdown (dropped the 📝 prefix so headings/lists render).
- **In-app web tabs (B)**: `WebviewReader` rewritten to manage multiple persistent `<webview>` tabs (one per tab, hidden when inactive) with a tab strip (close buttons) + a nav bar that drives the active tab. The guest preload intercepts cross-document http(s) link clicks (capture phase) and reports `sv:open-tab`, so **every link opens a new tab** instead of navigating the page away (the original complaint). Anchors are pushed to all tabs; content-based text-quote highlighting scopes them per page naturally. Selections now carry the tab's URL so the web anchor records the right page (`SelectionDraft.url`). Guest-internal click→new-tab is verified manually (the e2e asserts the tab strip + single tab on load).

## 2026-06-24 — Remove manual anchor; selection auto-fills AI Chat source

- **Manual "Create Anchor" step removed.** The standalone Selection section + button are gone. Anchors are now created **lazily** via `ensureAnchor()` the first time one is needed (Save Note / Create Patch / Save AI reply), so there's no per-mouseup anchor spam.
- **Selection auto-fills the AI Chat "source".** Selecting text in any reader shows a `.chat-source` chip at the top of the AI Chat panel — a short description (truncated quote) of the passage the question is about, with × to clear; a dashed placeholder prompts to select text when none. This is the "paste selection into the chat source" behavior.
- Note/Patch buttons now enable on a selection (not just an existing anchor); `saveAiNote` anchors the saved reply to the current selection when there is one.
- Study-panel sections renumbered (Selection removed): Note = section 0, Patch = section 1, Chat = section 2. e2e updated accordingly; all anchor-flow tests rewritten to select → Save (auto-anchor), asserting the `.chat-source` chip instead of the old `.selection-card`/`.anchor-chip`.

## 2026-06-24 — Edit-resilient HTML anchoring (text-quote fallback)

- **HTML notes now survive edits.** The html renderer resolves an anchor by its injected `data-study-id` (fast path); if that id is gone (HTML edited / re-imported), it **falls back to re-finding the passage by its stored quote + context** (W3C TextQuoteSelector) and wraps it in a highlighted `<mark>` — the same `highlightQuote` the live webview guest uses. So all reader types (HTML / webview / PDF) now share the durable text-quote locator; a note orphans only if the text itself is deleted.
- HTML selections now capture surrounding context (prefix/suffix) and store it on the anchor (`contextBefore`/`contextAfter`) to disambiguate repeated text.
- Shared `annotationLayer.highlightQuote` + `clearAnnotations` (now also unwraps `<mark>`s) deduplicate the webview guest's old highlight/clear code.
- Added `jsdom` (devDep) + `src/client/annotationDom.test.ts`: unit-tests `highlightQuote` (match/miss/context-disambiguation), `clearAnnotations` (unwrap + clear), and `decorateAnnotations` both paths (study-id present → element highlight; study-id gone → text-quote fallback `<mark>`).
