# Verification Log

Record verification evidence here as work proceeds. Include both automated and manual checks.

## Verification Matrix

| Task ID | Verification Type | Command Or Method | Expected Result | Actual Result | Status |
| --- | --- | --- | --- | --- | --- |
| MECH-001 | File review | Confirm `docs/implementation/` files exist | Workflow files are present | Six workflow files are present. | Passed |
| MECH-001 | Git status | `git status --short --branch` | New Markdown files are visible as untracked changes | `?? docs/` is visible on `main...origin/main`. | Passed |
| PLAN-001 | Git branch | `git status --short --branch` | Current branch is `codex/ai-study-vault` | Passed | Passed |
| PLAN-002 | Reference research | Web research against Obsidian public docs/repos | Borrowable public architecture references identified | Passed | Passed |
| PLAN-003 | Codebase inspection | Read shared types, storage, server routes, agent modules, and client app structure | Current GrowHTML migration points identified | Passed | Passed |
| PLAN-004 | Slice planning | Review `00-research-and-plan.md` and `02-verification-log.md` | C1-C8 sequence and verification plan are defined before coding | Passed | Passed |
| C1 | Type check | `npm run check` | TypeScript passes | Passed | Passed |
| C1 | Unit tests | `npm run test` | Schema/id fixture tests pass | 2 files, 8 tests passed | Passed |
| C2 | Type check | `npm run check` | TypeScript passes | Passed | Passed |
| C2 | Unit tests | `npm run test` | JSONL snapshot store tests pass | 3 files, 14 tests passed | Passed |
| C3 | Type check | `npm run check` | TypeScript passes | Passed | Passed |
| C3 | Unit tests | `npm run test` | Vault layout tests pass | 4 files, 16 tests passed | Passed |
| C4 | Type check | `npm run check` | TypeScript passes | Passed | Passed |
| C4 | Unit tests | `npm run test` | Source ingest tests pass | 5 files, 19 tests passed | Passed |
| C5a | Type check | `npm run check` | TypeScript passes after worker integration | Passed | Passed |
| C5a | Unit tests | `npm run test` | HTML core tests pass | 6 files, 27 tests passed | Passed |
| C5b | Type check | `npm run check` | TypeScript passes | Passed | Passed |
| C5b | Unit tests | `npm run test` | Anchor guard tests pass | 7 files, 34 tests passed | Passed |
| C6 | Type check | `npm run check` | TypeScript passes | Passed | Passed |
| C6 | API tests | `npm run test` | Supertest API coverage passes | 8 files, 38 tests passed | Passed |
| C8 | Type check | `npm run check` | TypeScript passes | Passed | Passed |
| C8 | Unit/script tests | `npm run test` and `npm run seed` | Seed creates deterministic source | 9 files, 41 tests passed; default vault seeded | Passed |
| C7 | Type check | `npm run check` | TypeScript passes after client implementation | Passed | Passed |
| C7 | Unit/API regression | `npm run test` | Existing data/API tests still pass | 9 files, 41 tests passed | Passed |
| C7 | Production build | `npm run build` | Vite production build succeeds | Passed: client bundle generated under `dist/` | Passed |
| C7 | Browser QA | In-app browser against `http://127.0.0.1:5173` | Content capture -> anchor -> note -> patch -> apply -> revert -> reload works | Passed. Click fallback on `data-study-id` block created anchor draft; note persisted; patch applied to iframe; revert restored original after reload. | Passed |
| Step① NoteLayer | Unit + E2E | `npm run test` / `npm run e2e` | Saved note paints onto the document (`.sv-annotated` + title tooltip), survives reload | 49 unit; e2e asserts highlight class + title regex on `[data-study-id="e2e-p"]` and after reload | Passed |
| Step② Open PDF | API + E2E | `npm run test` / `npm run e2e` | PDF base64 ingest (magic guard), `/file` serves exact bytes (`application/pdf`), reader switches to native viewer | +2 API tests (byte-equal + non-PDF 400); e2e imports a PDF and re-fetches served bytes | Passed |
| Step③ Rich forms | Unit + E2E | `npm run test` / `npm run e2e` | markdown/mindmap/flashcard render; XSS escaped; bad input → inert text; client renders via registry | +7 renderer unit tests; e2e: markdown→`<p>`, flashcard→`<summary>` flip card | Passed |
| Step④ AI chat | Unit + API + E2E | `npm run test` / `npm run e2e` | Mock provider deterministic; `buildSubprocessEnv` strips API key in subscription mode; `/api/chat` answers; chat→save-as-note | +5 AI unit, +2 chat API (answer + empty 400); e2e: ask→reply→save note | Passed |
| Steps①–④ regression | Full suite | `npm run check` / `npm run test` / `npm run e2e` | All green | `check` clean; 65 unit (12 files); 4 e2e | Passed |
| Single-origin server | API + integration | `npm run test` | `clientDir` serves index.html + SPA fallback, API not shadowed; `startServer` boots real HTTP on a free port | +1 supertest (static + fallback + `/api/health`); +1 `startServer` test fetches `/api/health` over HTTP | Passed |
| Electron shell | Unit + bundle | `npm run test` / `npm run electron:build:main` + `:preload` | Pure dev/url/clientDir helpers correct; main+preload bundle without unresolved imports | +3 shell unit tests; esbuild produced `dist-electron/main.cjs` (52.8kb) + `preload.cjs` (195b) | Passed |
| Electron desktop loop | E2E (Playwright `_electron`) | `npm run e2e:electron` | Launches the REAL Electron app; renderer loads from the in-process server; import → select → anchor → note → on-document overlay → AI chat all work | `e2e-electron/app.spec.ts` 1 passed (550ms). Drives the packaged shell, not the dev web server. | Passed |
| Electron visible window | Manual (display) | `npm run electron` on a machine with a desktop session | A window visibly opens and is interactive | Functional loop already covered by the `_electron` test; visible-window check deferred (this automation session is non-interactive — `electron.exe` launched and exited cleanly with no error/output, i.e. no attachable desktop) | Pending (cosmetic) |
| Note: Electron binary | Install | `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js` | Binary downloaded | GitHub release download stalled in this locale; npmmirror mirror succeeded; `node_modules/electron/dist/electron.exe` present | Passed |
| SourceViewer registry | Unit + regression | `npm run test` / `npm run e2e` / `npm run e2e:electron` | Type→viewer mapping + plugin override; html/pdf flows unchanged after refactor | +3 unit; 4 web e2e + 1 electron e2e still pass | Passed |
| Webview annotation backbone | Unit + API | `npm run test` | `web_text_quote` selector create/resolve (disambiguation); `web_live` ingest; web anchor via API | +5 textQuote unit; +2 API (web-live ingest, web anchor) | Passed |
| Webview Electron embed | E2E (`_electron`) | `npm run e2e:electron` | Open Live a URL → web_live source → `<webview>` loads it with the guest preload attached | `e2e-electron/webview.spec.ts` asserts `webview[src]` + `[preload$=webview-preload.cjs]`; 1 passed | Passed |
| Webview guest round-trip | Manual (display) | Select text on the live page in the desktop app | Selection → web anchor → `<mark>` highlight re-appears | Logic covered by textQuote unit tests; full guest-DOM drive deferred (Playwright can't reliably drive `<webview>` guest content) | Pending (manual) |
| PDF anchor model | API | `npm run test` | `pdf_selection` by page+quote (rect optional); page required | +2 API tests (create + missing-page 400) | Passed |
| PDF.js text layer | E2E (web) | `npm run e2e` | Real PDF renders a selectable text layer; select → anchor → note → highlight | loop e2e uses `makeTextPdf` fixture; asserts text layer, selection card, note, `.pdf-anchor-hit` | Passed |
| Diagram note forms | Unit + E2E | `npm run test` / `npm run e2e` | mermaid/markmap dispatch; mermaid note renders an SVG | +2 registry unit tests; mermaid e2e asserts `.note-diagram-mermaid svg` visible | Passed |
| StorageAdapter seam | Unit + regression | `npm run test` | Whole vault (open/ingest/persist/reopen) runs on `MemoryStorageAdapter`; Node path unchanged | +1 in-memory vault test; all prior store/vault/source tests still pass on the Node default | Passed |
| Pure sha256 | Unit | `npm run test` | Matches FIPS vectors + node:crypto across block boundaries; `computeContentHash` output unchanged | +2 sha256 tests; existing source-hash test still passes | Passed |
| Pure path guard | Unit | `npm run test` | Accepts normal relative paths; rejects `..`/absolute | +2 guard tests | Passed |
| PTY provider (transport) | Unit | `npm run test` | ANSI parser; provider returns cleaned answer + reuses one session; factory selects `claude-pty` w/o loading node-pty | +7 tests (FakePtySession-driven, deterministic) | Passed |
| PTY real CLI + xterm | Manual (display) | desktop with authenticated `claude` + `@electron/rebuild` | Persistent live session answers in chat; visible terminal interacts | node-pty load verified under Node (1.1.0); live CLI + Electron ABI rebuild deferred to a display machine | Pending (manual) |
| AI terminal pipeline | E2E (`_electron`, fake PTY) | `npm run e2e:electron` (STUDY_VAULT_PTY_FAKE) | Toggle terminal → start → output reaches xterm; typed input echoes back | `terminal.spec.ts` asserts banner + echo via `.pty-raw` mirror; deterministic, no native node-pty | Passed |
| AI terminal real CLI | Manual (display) | desktop + `npm run electron:rebuild` + authed `claude`/`codex` | Live CLI runs in xterm | node-pty Electron-ABI build deferred to target machine (winpty source build needs MSVC tools) | Pending (manual) |
| Full regression | Full suite | `npm run check` / `npm run test` / `npm run e2e` / `npm run e2e:electron` | All green | `check` clean (incl. `electron/`); 96 unit (22 files); 5 web e2e; 3 electron e2e | Passed |

## Slice 1 Verification Plan (Vault Data Layer)

Design principle: the data layer (`core/`, `adapters/`) is pure TS over files — no AI, no browser — so it is built **test-first**. Each task's "verification method" *is* its companion test file. ~80% of Slice 1 is fully automatable; only C7 (UI) needs manual QA or one E2E.

### Tooling to add (during C1/C2)

- **Vitest** — unit/integration runner (pairs with Vite, zero-config TS). New script `npm run test`.
- **linkedom** (or jsdom) — server-side HTML parse/serialize used by the HTML Adapter in production *and* in tests (same code under test).
- **supertest** — exercise Express endpoints without binding a port.
- **Playwright** (optional, C7) — single happy-path E2E only.
- Isolation: every data-layer test creates a throwaway vault under `os.tmpdir()`; never touches `data/`.

### Per-task verification

| Task | Verification | Automated | Tool |
| --- | --- | --- | --- |
| C1 schema+ids+fixtures | Types compile; Zod accepts valid / rejects invalid (bad envelope, wrong type, missing time/version); ids unique + `<type>_<ulid>` well-formed; golden fixtures validate | Yes | `tsc --noEmit` (`npm run check`) + Vitest |
| C2 store | upsert→read; **status update** (pending→applied→reverted) overwrites same id; delete semantics; malformed-line tolerance; atomic rename is crash-safe (no torn file) | Yes | Vitest (tmp dir) |
| C3 vault | create empty vault → assert `.study/`, `sources/`, `exports/`, `manifest.json`(version) layout | Yes | Vitest |
| C4 source ingest | ingest HTML → file written + one `sources.jsonl` record + list returns it | Yes | Vitest |
| C5a HTML core | `data-study-id` inject idempotent; applyPatch per action (replace/insert/append/rewrite) mutates content; **revert restores original**; serialize round-trips | Yes (highest-value) | Vitest + linkedom |
| C5b anchor + guard | resolve fallback (studyId→selector→quote) survives edits/reorder; **drifted patch returns conflict, is NOT applied** | Yes (highest-value) | Vitest + linkedom |
| C6 server API | list / get rendered / create anchor / Note·Patch CRUD — status codes + response bodies | Yes | Vitest + supertest |
| C8 seed/migration | after run a deterministic source exists (imported `content.html` or generated demo) | Yes | Vitest / script |
| C7 client | browser walk: select → anchor → manual Note → manual Patch (hand-typed) → apply → revert → **reload still correct** | Manual QA, or 1 E2E | manual / Playwright |

### Test pyramid & commands

- Many unit tests (C1–C5) → few API integration tests (C6) → 0–1 E2E (C7). Do not stack E2E.
- Commands: `npm run check` (types) + `npm run test` (Vitest). Both CI / pre-commit friendly.
- The HTML Adapter's `applyPatch` / anchor resolver run server-side in production, so tests call the real production functions — not stubs.

### Slice 2 (AI) verification — recorded early

- Do **not** assert against the live model (non-deterministic, costs money/time). Mock at the **Provider boundary**.
- Action plugins' `buildPrompt` / `parseResult` tested with fixed fixture outputs → deterministic, automatable.
- The Claude Agent SDK provider gets one manually-triggered smoke test, skipped in CI by default.

## Command Log

| Time | Command | Result | Notes |
| --- | --- | --- | --- |
| 2026-06-23 | `rg --files` | Passed | Reviewed initial project file list. |
| 2026-06-23 | `Get-Content README.md` | Passed | Reviewed project usage and workflow notes. |
| 2026-06-23 | `Get-Content package.json` | Passed | Confirmed available scripts. |
| 2026-06-23 | `rg --files docs\implementation` | Passed | Confirmed workflow files are under the repository. |
| 2026-06-23 | `git status --short --branch` | Passed | Confirmed new `docs/` changes are visible to Git. |
| 2026-06-23 | `git switch -c codex/ai-study-vault` | Passed | Created implementation branch. |
| 2026-06-23 | `Get-Content -Raw -Encoding UTF8 pasted-text.txt` | Passed | Read AI Study Vault v0.3 attachment without mojibake. |
| 2026-06-23 | Web research | Passed | Reviewed Obsidian license, API, sample plugin, Dataview, Metadata Extractor, and Local REST API references. |
| 2026-06-23 | `npm install zod ulid linkedom` | Passed | Added runtime dependencies for schema, IDs, and future HTML core. |
| 2026-06-23 | `npm install -D vitest supertest @types/supertest` | Passed | Added test/API verification tools. |
| 2026-06-23 | `npm run check` | Passed | C1 type check passed. |
| 2026-06-23 | `npm run test` | Passed | C1 tests passed: 2 files, 8 tests. |
| 2026-06-23 | `npm run check` | Passed | C2 type check passed. |
| 2026-06-23 | `npm run test` | Passed | C2 tests passed: 3 files, 14 tests. |
| 2026-06-23 | `npm run check` | Passed | C3 type check passed. |
| 2026-06-23 | `npm run test` | Passed | C3 tests passed: 4 files, 16 tests. |
| 2026-06-23 | `npm run check` | Passed | C4 type check passed. |
| 2026-06-23 | `npm run test` | Passed | C4 tests passed: 5 files, 19 tests. |
| 2026-06-23 | Worker C5a verification | Passed | Worker reported `npm run check` and `npm run test` passing. |
| 2026-06-23 | `npm run test` | Passed | Main integration after C5a: 6 files, 27 tests. |
| 2026-06-23 | `npm run check` | Passed | Main integration after C5a type check passed. |
| 2026-06-23 | `npm run check` | Passed | C5b type check passed. |
| 2026-06-23 | `npm run test` | Passed | C5b tests passed: 7 files, 34 tests. |
| 2026-06-23 | `npm run check` | Passed | C6 type check passed. |
| 2026-06-23 | `npm run test` | Passed | C6 tests passed: 8 files, 38 tests. |
| 2026-06-23 | `npm run check` | Passed | C8 type check passed. |
| 2026-06-23 | `npm run test` | Passed | C8 tests passed: 9 files, 41 tests. |
| 2026-06-23 | `npm run seed` | Passed | Seeded default vault with demo source. |
| 2026-06-23 | `npm run check` | Passed | C7 client type check passed after iframe selection/click capture changes. |
| 2026-06-23 | `npm run test` | Passed | C7 regression tests passed: 9 files, 41 tests. |
| 2026-06-23 | Browser QA | Passed | Opened `http://127.0.0.1:5173`; clicked demo paragraph; created anchor; saved note; created patch; applied; reverted; reloaded and verified persistence. |
| 2026-06-23 | `npm run build` | Passed | Production build succeeded after C7. |

## Manual QA Notes

Use this section for browser checks, visual inspection, screenshots, and behavior that automated commands do not cover.

- No manual UI QA is required for `MECH-001` because this task only adds documentation.
- C7 browser QA passed on 2026-06-23. The in-app browser verified: open default source, click the demo paragraph (`data-study-id="demo-paragraph"`) to create a selection draft, create an Anchor, save a Note, create a pending Patch, apply it and confirm the iframe text changes to `Patched paragraph from C7 browser QA.`, revert it and confirm the original paragraph returns, reload and confirm the Note and reverted Patch persist.
- Native drag text-selection inside the iframe was difficult to drive reliably through browser automation, so the client now supports both selected-text capture (`selectionchange` / `mouseup` / `keyup`) and a deterministic click fallback on `data-study-id` blocks. The verified path used the click fallback; real selected text remains the preferred path when present.
- C7 (minimal client) manual QA chain: open library → open a source → select text → an anchor is created → add a manual Note → it appears in history → create + apply a Patch → rendered content changes → revert → original content restored → **reload the page and confirm source/notes/patches persisted correctly**. Capture a screenshot per step.

## Slice 1 Code Review & Fixes (2026-06-23)

Reviewed all Slice 1 code (core/adapters/server/client/seed). Fixed directly; `npm run check` + `npm run test` green (9 files, 43 tests, +2 regression tests).

| Severity | Issue | Fix |
| --- | --- | --- |
| High | `SnapshotStore` read-modify-write had no serialization → lost updates under concurrent API writes | Per-store async write lock (`withLock`) around `upsert`/`delete`; concurrency regression test added |
| Medium | Path-traversal guard was prefix-only (`startsWith(sourcesDir)`) → sibling-dir bypass | Require exact match or `sourcesDir + path.sep` |
| Medium | API `noteKind`/`action` were loose `z.string()` → generic 400s, could create non-HTML actions | Use `noteKindSchema` / `patchActionSchema` in request DTOs |
| Medium | Patch status transitions unguarded (apply without accept, revert pending, …) | `patchTransitions` state machine → 409 on illegal transition; regression test added |
| Low | Dead code: 8 orphaned old GrowHTML modules (`storage/agents/claudeAgent/codexAgent/documentAgent/proposalPrompt/externalImport` + `shared/types`) | Deleted (no references from new code) |
| Low | `writeJsonlAtomic` temp name (`pid+Date.now()`) could collide | Use `randomUUID()` |
| Low | Duplicate import line in `app.ts` | Merged |

Verified non-issues: `vaultEntitySchema` nested discriminated union is valid on zod 4.4.3 (covered by `schema.test.ts`). Projection/materialize (apply does not rewrite the source file) is intended design. `applyHtmlPatch` strictness (studyId→selector, no quote fallback) is intentional — the server apply path gets quote fallback via `applyHtmlPatchWithGuard`→`resolveHtmlAnchor`; materialize trusts already-guarded patches.

## Click Self-Test (E2E) — per-step self-verification

Every UI-affecting step is self-verified by a Playwright click-test that drives the **real running app**: Playwright boots `dev:server` + `dev:client` on an isolated `STUDY_VAULT_ROOT=.e2e-vault`, then drives Chromium. `e2e/loop.spec.ts` walks the full no-AI loop — import → click selection in the reader iframe → create Anchor → save Note → create Patch → **apply (assert rendered text changes)** → **revert (assert original returns)** → reload → reselect source (**assert Note persisted, Patch reverted**).

- Run: `npm run e2e` (or `npm run e2e:headed` to watch). Result 2026-06-23: **1 passed (~1.1s)**.
- Unit/integration stay on `npm run test` (Vitest, 45 passing); `vitest.config.ts` excludes `e2e/**` so the two never collide. Chromium installed via `npx playwright install chromium`.
- **Standard going forward:** data/logic steps → a Vitest companion test; UI/loop steps → extend `e2e/loop.spec.ts` (or a sibling spec) so each step ships with an automated click-test.

## Web URL → local snapshot (verification)

Verified by automated tests (no network flakiness):
- `src/adapters/web/snapshot.test.ts` — `normalizeUrl` (strip tracking params/hash/trailing slash, lowercase host) and `snapshotWebpage` (remove scripts/inline handlers, absolutize URLs, extract title).
- `src/server/app.test.ts` — `POST /api/sources/url` with a **mocked global `fetch`**: asserts a `webpage` Source is created with `metadata.normalizedUrl`, and the served content is sanitized (script stripped) + absolutized.
- Full suite green 2026-06-23: `npm run check`, `npm run test` (10 files, 49 tests), `npm run e2e` (1 passed). The click E2E was kept network-free (URL ingest covered by the mocked-fetch server test, not the browser loop).

## Residual Risk

- Slice 1 has been exercised end-to-end on a real feature task. Remaining risk: native drag-selection inside the iframe was not directly proven by automation; it is supported by the same handler and should receive a quick human spot check before relying on sub-paragraph selection precision.
- **Deferred (documented, not blocking):** (1) apply-time conflict detection checks a single patch vs original content, ignoring previously-applied patches → order-dependent for interacting patches; (2) `replace_selection`/`rewrite_section` drop `data-study-id` in materialized output (harmless now since materialize recomputes from the id-bearing original; matters only if patched content is persisted as source).
- **C1 amendment — DONE 2026-06-23:** `Note.contentType` (open string `noteContentTypeSchema`, default `markdown`) added; `metadata` promoted into `recordEnvelopeSchema` and deduped from `source.ts`; API note DTO passes optional `contentType`; 2 schema tests added (default markdown + metadata escape hatch; open-string contentType). `npm run check` + `npm run test` green (9 files, 45 tests).

## 2026-06-24 — Terminal cwd + placement (verification)

- `electron/ptyCwd.test.ts` — `resolveCwd` unit tests: empty/whitespace → fallback; existing dir → returned; missing path → fallback; file (not dir) → fallback.
- `e2e-electron/terminal.spec.ts` (rewritten) — drives the real Electron app: terminal hidden until **Show** (under AI Chat), fills the **Working directory** field, Start → fake spawner banner echoes the resolved cwd (proves renderer→IPC→bridge `resolveCwd`→spawner), input echoes, **Hide** closes it (regression for "un-closable terminal").
- Full suite green 2026-06-24: `npm run check`, `npm run test` (23 files, 100 tests), `npm run e2e:electron` (3 passed: app + terminal + webview). node-pty rebuilt against Electron ABI (real PTY now available; e2e still uses the deterministic fake via `STUDY_VAULT_PTY_FAKE=1`).

## 2026-06-24 — Persistent-session chat + annotation seam (verification)

- `src/client/annotations.test.ts` (5 tests, node env, no jsdom): `groupForRenderer` groups notes under their anchor and keeps only claimed anchor kinds / ignores orphan+missing-anchor notes; `decorateAnnotations` injects each renderer's stylesheet once across repaints, clears+paints each renderer with only its claimed anchors (spy renderer), and registers plugins ahead of built-ins. Real HTML painting stays covered by the overlay e2e.
- `claude -p` persistent session verified manually at the CLI: `--session-id <uuid>` (turn 1) then `--resume <uuid>` (turn 2) recalled a planted number; stdin prompt + Windows shell launch confirmed (returned `PONG`). `ClaudeCliProvider.complete` is the thin wrapper around exactly this flow.
- Full suite green 2026-06-24: `npm run check`, `npm run test` (24 files, 105 tests), `npm run e2e` (5 web), `npm run e2e:electron` (3 — app/terminal/webview). The overlay assertions in both e2e suites pass unchanged after routing through the AnnotationRenderer registry, proving behavior parity.

## 2026-06-24 — Shared annotation layer + chat context (verification)

- Decoupled layer verified by both overlay e2e suites unchanged in intent: web `loop.spec` html overlay now asserts hover → `#sv-note-card` visible with the note text; the PDF test asserts the SAME shared card floats over a `.pdf-anchor-hit` span with "PDF note." Proves one presentation layer works across HTML + PDF surfaces. Webview guest reuses the identical `applyHighlight`/`ensureAnnotationLayer` (manually verifiable; text-quote resolution unit-tested separately).
- Chat context: `chatContextSchema` gained sourceType/location/contextBefore/contextAfter (all optional → backward compatible); mock + claude-cli prompt builders updated. Existing AI-chat e2e still green (question + quote echoed); reply-save button renamed → e2e updated to "Save full reply".
- Full suite green 2026-06-24: `npm run check`, `npm run test` (24 files, 105 tests), `npm run e2e` (5 web), `npm run e2e:electron` (3). Electron relaunched with `STUDY_VAULT_AI_PROVIDER=claude-cli`.

## 2026-06-24 — Note card window + web tabs (verification)

- Note card: web `loop.spec` (html + PDF) still assert hover → `#sv-note-card` visible with the note text, now through the markdown-rendering body. Drag/resize/pin/close are interaction-heavy and verified manually.
- Web tabs: `e2e-electron/webview.spec.ts` extended — asserts exactly one `.webview-tab` on Open Live (titled with the host) plus the existing src/preload/plugins/nav/address assertions. The guest-side "click a link → new tab" path needs a click inside the guest webContents (not reachable from the host page in `_electron`), so it's a documented manual check.
- Full suite green 2026-06-24: `npm run check`, `npm run test` (24 files, 105 tests), `npm run e2e` (5), `npm run e2e:electron` (3). Electron relaunched with claude-cli.

## 2026-06-24 — Auto-anchor + chat source chip (verification)

- All 5 web e2e + 3 electron e2e rewritten to the no-manual-anchor flow (select → Save Note/Patch auto-creates the anchor; `.chat-source` chip asserted in place of `.selection-card`/`.anchor-chip`) — green.
- Full suite green 2026-06-24: `npm run check`, `npm run test` (24 files, 105 tests), `npm run e2e` (5), `npm run e2e:electron` (3). Electron relaunched with claude-cli.

## 2026-06-24 — Edit-resilient HTML anchoring (verification)

- `src/client/annotationDom.test.ts` (jsdom, 6 tests) covers the resolution logic that an e2e can't reach deterministically (patch materialize preserves study-ids, so "id lost" can't be simulated via the UI): study-id fast path AND text-quote fallback both produce the right DOM.
- Full suite green 2026-06-24: `npm run check`, `npm run test` (25 files, 111 tests), `npm run e2e` (5), `npm run e2e:electron` (3). Electron relaunched with claude-cli.

## 2026-06-25 — Unified Web viewer (snapshot + live) (verification)

- `src/client/viewers.test.ts` — extended: `webpage` now maps to the new `web` viewer kind/id while keeping `htmlPipeline: true`; `html`/`markdown` stay kind `html`; the plugin-priority test is unchanged.
- `e2e/web-snapshot.spec.ts` (NEW, web/chromium) — seeds a `webpage` snapshot from a local fixture HTTP server (`POST /api/sources/url`, offline) and asserts the UNIFIED shell renders in snapshot sub-mode (tab strip + "Snapshot" tab + address bar reflecting the source URL + nav-bar "Open Live") AND the full snapshot study flow still works: select in the snapshot iframe → `.chat-source` chip → Save Note → an **`html_selection`** anchor (not `web_text_quote`) carrying the quote → `.sv-annotated` highlight paints. Proves the study-id path is unchanged by the merge.
- `e2e-electron/web-snapshot.spec.ts` (NEW, Electron) — opens a `webpage` snapshot in the real app: asserts the snapshot tab renders via a `DomReader` iframe with **no** `<webview>` yet, then nav-bar **Open Live** spawns a SECOND tab backed by a real Electron `<webview>` (correct `src` + `webview-preload.cjs` + settled address bar). Covers the cross-mode snapshot→live behavior the host page can't.
- Existing `web_live` coverage unchanged + green: `e2e-electron/webview.spec.ts` (Open Live → `<webview>`) and `e2e-electron/viewer-flows.spec.ts` (live HTML select→chip→note→`web_text_quote` anchor→highlight→hover card).
- Full suite green 2026-06-25: `npm run check` (clean), `npm run test` (38 files, 247 tests), `npm run e2e` (14 web), `npm run e2e:electron` (9). DomReader gained an optional `onOpenUrl` (link interception) used only by the snapshot tab; omitting it preserves the imported-HTML reader's prior behavior (its e2e stays green).

## 2026-06-25 — Study Layer V1 foundation (verification)

- Scope: schema (`SourceFingerprint`/`StudyLayer`/`layerId`/`matchStatus`/`note.origin`) + `layer` id kind + `layers` store; pure rematch resolver; owned-layer + boot migration; export/preview/commit APIs + anchors-filtered-by-enabled-layer. Core + server only — no client/PDF/viewer files touched.
- `src/core/study-layer/rematch.test.ts` — the resolver's three tiers and kind dispatch: exact prefix+quote+suffix → matched; single occurrence → matched; multiple occurrences disambiguated by context → matched (right one); ambiguous → fuzzy; whitespace/case drift → fuzzy; absent/empty → unmatched; pdf page-text quote, pdf/image rect by `sameBinary` (matched vs fuzzy), code_range symbol fallback.
- `src/core/study-layer/layers.test.ts` — `ensureOwnedLayer` creates exactly one owned layer per source and reuses it (fingerprint carries the source contentHash); `migrateStudyLayers` backfills `layerId` onto pre-layer anchors+notes and is idempotent (second run touches nothing). Confirms **backward compat**: a legacy anchor/note written with no `layerId` loads fine (optional field) before the migration assigns one.
- `src/server/studyLayer.test.ts` — new anchors/notes get stamped with the source's owned layer + listed; export produces a portable pack with `studyId`/`selector`/`sourceId` stripped and a `contentHash` fingerprint; preview matches the local source by `contentHash` (stats matched:1); commit re-realizes the html anchor against the importer's OWN injected study-id (not the author's) with `matchStatus:"matched"` + creates the imported note; disabling a layer hides its anchors from `GET /sources/:id/anchors` while enabled layers stay.
- Backward-compat guarantee: `layerId` (anchor+note) is `.optional()`, so `readJsonl`/snapshot-store loading of existing `.study-vault`/`.vault-dev` rows does not fail validation (a required field would have dropped them); `migrateStudyLayers` runs on server boot (`start.ts`) to backfill. Verified by the idempotent migration test and by the full existing suite staying green.
- Suite green 2026-06-25: `npm run check` (clean), `npm run test` (41 files, 265 tests), `npm run e2e` (14 web — existing viewer/PDF/region/concept/note flows unaffected by the anchor-layer filter). `npm run e2e:electron` NOT run by this task (no Electron-specific surface changed; the layer changes are server/core, covered by unit + web e2e) — flagged, not claimed.

## 2026-06-25 — Study Layer V2 (local .studypack UX) (verification)

- Scope: client UI for the V1 server. New `layer.switcher` view (`src/client/workspace/layerViews.tsx`) — lists a source's layers (owned + imported) with an `enabled` toggle, per-layer Export (downloads `.studypack`), and an Import flow (file pick → `import/preview` three-state summary → confirm → `import/commit`). EntityClient gained `layers/patchLayer/exportLayer/importPreview/importCommit`; a `layer.toggle` command + `onLayersChanged` action; context `refreshLayers()`/`layersVersion`. Added as an additive 5th pane in `studyVaultLayout` (existing pane DOM untouched); `body min-width` 1460→1740px so the flexible reader doesn't collapse.
- `src/client/commands/registry.test.ts` — `layer.toggle` patches `enabled` + fires `onLayersChanged`; unavailable without a `layerId`/boolean `enabled`. (Existing command tests' client mock gained `patchLayer`.)
- `e2e/study-layer.spec.ts` (NEW, web/chromium) — seeds an HTML source, then drives the REAL Layers-pane UI: pick a `.studypack` (3 anchors built to hit each state, matched by fingerprint title) → preview shows **matched 1 / fuzzy 1 / unmatched 1** → Import → an `imported` layer appears AND the matched passage paints (`.sv-annotated`) → toggling the layer off hides the highlight, on restores it → server lists the imported layer under the source.
- Smoke case: `scripts/smoke-study-layer.ts` (`STUDY_VAULT_ROOT=.vault-dev npx tsx scripts/smoke-study-layer.ts`) seeds source "Study Layer Smoke — Rendering Notes" into the dev vault and writes `docs/samples/sample.studypack` (anchors → matched/fuzzy/unmatched). Verified it runs and emits the pack + the source id; manual steps printed (open source → Import Layer → preview 1/1/1 → Import → toggle).
- Deferred (flagged, not done): `copy-note-to-mine`, `anchor.rematch` + match-inspector view, `layer` FocusTarget / note-list-by-layer filter.
- Suite green 2026-06-25: `npm run check` (clean), `npm run test` (41 files, 267 tests; +2 layer.toggle), `npm run e2e` (15 web — all prior flows + the new study-layer flow). `npm run e2e:electron` NOT run by this task (no webview/Electron-specific path changed; V2 is server/core + a host-page pane) — flagged, not claimed.

## 2026-06-25 — Product Kit foundation + Textbook Kit phase 1 (verification)

- Scope: register-only Product Kit infra (`src/kits/{types,language,clientContext,clientKits,index,server}.ts(x)`) + Textbook Learning Kit phase 1 (`src/kits/textbook-learning/{contentTypes,noteTypes,language,index}`): 3 Study Block note types (Explanation/Practice/Mistake) registered into the EXISTING NoteTypeRegistry + core NoteContentSpec registry. No core schema change; core never imports a kit (server `createApp`→`installServerKits`; client `views.tsx`→side-effect `clientKits`).
- `src/kits/textbook-learning/contentTypes.test.ts` — all 3 specs register into the core registry; each `createDefault` round-trips its schema; API-path `parseNoteContent` accepts valid content + rejects bad enums; `.default([])`/`.default(...)` fields fill on parse; `toSearchText` reduces to clean text. Proves the server validates `textbook.*` content with zero core changes.
- `src/kits/textbook-learning/noteTypes.test.tsx` (jsdom) — installing the client kit registers a plugin for each type + exposes domain labels via `kitContentTypeLabel` (Explanation/Practice/Mistake); each render emits its card (prose as sanitized markdown, options, mastery/difficulty badges); renders NEVER throw on foreign/mis-shaped content; the explanation editor's onChange emits schema-valid content.
- `e2e/textbook-kit.spec.ts` (NEW, web/chromium) — drives the REAL composer: the picker offers "Explanation" (`option[value="textbook.explanation"]`), authoring via the kit's structured editor + Save renders the kit's Explanation card in the note list (kind label, level badge, markdown-bold prose, key-points list). Proves register-only end to end (no App/Workspace/Shell edits).
- Suite green 2026-06-25: `npm run check` (clean), `npm run test` (43 files, 279 tests; +12), `npm run e2e` (16 web — all prior flows + the new textbook-kit flow). `npm run e2e:electron` NOT run by this task (phase 1 adds no webview/Electron-specific path; it is composer/note-list, covered by unit + web e2e) — flagged, not claimed.
- Phase-2 research (for the next task): the `ModelProvider` does free-text markdown only (no structured/JSON output) — phase 2 must add a structured-generation path + deterministic mock JSON; and there is no selection-toolbar surface yet (selection fills the chat chip) — the `surfaces.contribute('selection-toolbar', …)` collector is in place as the seam.

## 2026-06-25 — Textbook Kit phase 2: AI commands + structured generation + selection toolbar (verification)

- Scope: register-only Product Kit phase 2. Structured generation core (`src/ai/provider.ts` optional `completeStructured`; `src/ai/mockProvider.ts` echoes the host `sample`; `src/kits/structured.ts` `generateStructuredContent`/`extractJson`/`StructuredGenerationError`; `src/kits/prompts.ts` registry), server endpoint `POST /api/kits/generate` (`src/server/app.ts`, `installServerKits` now registers prompts too), client `entityClient.generateStructured` + `CommandContext.client` Pick. Textbook kit: `prompts/{explainConcept,generatePractice,markAsMistake}.prompt.ts`, `commands.ts` (3 host Commands), `surfaces.ts` (selection-toolbar items), `index.tsx` registers commands+prompts+surfaces. Host UI: `SelectionToolbar.tsx` + mount in `views.tsx`; `kits/clientContext.tsx` now registers kit commands into the CommandRegistry + exposes `kitSurfaceItems`. No core schema change; `src/ai` never imports a kit.
- `src/kits/structured.test.ts` — `extractJson` parses bare/fenced/embedded JSON + throws on none; `generateStructuredContent` returns the prompt's deterministic mock content via the mock; a text-only flaky provider that emits invalid-then-valid output is RETRIED and validated; persistently invalid output → `StructuredGenerationError`; unknown promptId/contentType/mismatched outputType all rejected.
- `src/kits/textbook-learning/prompts.test.ts` — each prompt `build()` embeds the passage + asks for JSON; each `mockContent()` PARSES against its matching `NoteContentSpec` schema (the e2e-determinism guarantee); practice answer is one of its options; every prompt `outputType` equals its spec contentType.
- `src/kits/textbook-learning/commands.test.ts` — explain/practice/mistake `isAvailable` gate on a focused passage; `run` calls `materializeAnchor` → `generateStructured({promptId, contentType, input.anchorText})` → `createNote({contentType, anchorIds})` → `onNoteCreated`; each targets its own contentType; unavailable with no focus.
- `e2e/textbook-kit-ai.spec.ts` (NEW, web/chromium, mock provider) — select a passage → the kit selection toolbar (Explain/Practice) appears → Explain generates a structured Explanation Study Block that renders as the kit card → Practice generates an Exercise card on the same passage. Proves structured generation + kit commands + selection-toolbar contribution end to end, register-only.
- Suite green 2026-06-25: `npm run check` (clean), `npm run test` (46 files, 292 tests; +13), `npm run e2e` (17 web — all prior flows + the new textbook-kit-ai flow). `npm run e2e:electron` NOT run by this task (no webview/Electron-specific path changed; the surface is the host study panel, covered by unit + web e2e) — flagged, not claimed.
- Manual check with the real provider (claude-cli/-pty): the desktop providers have no `completeStructured`, so they take the text→JSON fallback — verify Explain/Practice in the client by selecting a passage and clicking the toolbar action; the JSON-only prompt + retry should yield a valid card (tune the prompt against the live CLI if a model adds prose).

## 2026-06-25 — Textbook Kit phase 3: Review Pack + propagation policy + student layout (verification)

- Scope: register-only Product Kit phase 3, closing the spec §16 MVP loop. Adds the 4th Study Block `textbook.review-pack` (core spec in `textbook-learning/contentTypes.ts` + render/edit in `noteTypes.tsx`), the source-level `textbook.generate-review-pack` command (`commands.ts`, gathers the source's explanation+mistake notes via `client.notes`), a new `source-actions` surface slot + host `SourceActionsToolbar.tsx` (mounted top of the study panel), a React-free layer-policy registry (`src/kits/policy.ts` + `textbook-learning/policy.ts`) consumed by the export filter in `src/server/studyLayer.ts` (`buildStudyPack` drops private-by-default notes + orphan anchors), and a `textbook.student-learning` column layout preset (`textbook-learning/layout.ts`). No core schema change; core never imports a kit.
- `src/kits/textbook-learning/contentTypes.test.ts` — now asserts all 4 Study Block types register + round-trip; review-pack requires `scope.sourceId`.
- `src/kits/textbook-learning/prompts.test.ts` — the review-pack prompt builds scoped to the source + its `mockContent` parses against the review-pack schema (keyPoints from explanations, weakPoints from mistakes); every prompt `outputType` matches its spec.
- `src/kits/textbook-learning/commands.test.ts` — `generate-review-pack` `isAvailable` gates on an active source; `run` calls `client.notes(sourceId)`, passes the gathered explanation+mistake content into `generateStructured`, and saves an unanchored `textbook.review-pack` note.
- `src/kits/policy.test.ts` (NEW) — `textbook.mistake` is private-by-default (NOT exportable); explanation/exercise/review-pack + generic `markdown` stay exportable; re-registering a kit policy is idempotent.
- `e2e/textbook-kit-review.spec.ts` (NEW, web/chromium, mock provider) — (1) the source-level "Review Pack" action (a `source-actions` contribution) generates a structured review-pack Study Block that renders as a kit card; (2) creating a Mistake + an Explanation then exporting the source's owned layer yields a pack containing `textbook.explanation` but NOT `textbook.mistake` (propagation policy, end to end through the real export endpoint).
- Smoke: `scripts/smoke-textbook-kit.ts` (`STUDY_VAULT_ROOT=.vault-dev npx tsx scripts/smoke-textbook-kit.ts`) seeds source "Textbook Smoke — Cell Biology", fills its owned layer with all four block types, exports to `docs/samples/teacher-layer.studypack`, and asserts the export excludes `textbook.mistake`. Verified: exported note types = explanation, exercise, review-pack (mistake stripped); §16 manual steps printed.
- Suite green 2026-06-25: `npm run check` (clean), `npm run test` (47 files, 298 tests; +6), `npm run e2e` (19 web — all prior flows + the two new textbook-kit-review tests). `npm run e2e:electron` NOT run by this task (no webview/Electron-specific path changed; phase 3 is host-page study panel + server/core, covered by unit + web e2e) — flagged, not claimed.
- Deferred (flagged): full §8 dock layout + a layout-switcher UI to activate the student preset (base shell renders columns only); `copy-note-to-mine`; `anchor.rematch` UI.

## 2026-06-25 — Per-source Product Kit activation (verification)

- Scope: a source picks its active kit(s). Data array `source.metadata.activeKitIds` (core metadata escape hatch — no schema change); single-select reader-header dropdown. Gates creation entry-points only (selection toolbar, source-actions, composer type picker, kit commands, language); note-type render + content specs stay global. New files: `src/kits/activation.ts` (pure `effectiveKitIds` + localStorage default + `activeKitIdsForSource`), `src/kits/activation.test.ts`, `e2e/kit-activation.spec.ts`. Edited: `src/kits/clientContext.tsx` (tag registrations with `kitId`: `kitSurfaceContributions`/`kitNoteTypeOwners`/`kitCommands`; `kitSurfaceItems(slot, kitIds?)`, `noteTypeOwnerKit`, `installedKits`), `src/kits/language.ts` (kitId-tagged, gate-aware accessors), `SelectionToolbar.tsx`/`SourceActionsToolbar.tsx` (`kitIds` prop), `workspace/views.tsx` (Kit dropdown + `noteTypeOptions(activeKitIds)` + toolbars threaded), `WorkspaceContext.tsx` (`activeKitIds`/`installedKits`/`setActiveKit`), `data/entityClient.ts` (`updateSourceMetadata`), `server/app.ts` (`PATCH /api/sources/:sourceId` metadata merge), `styles.css` (`.kit-select`).
- `src/kits/activation.test.ts` (NEW) — `effectiveKitIds`: metadata array authoritative (empty = Core), absent → workspace default, core sentinel/non-strings filtered, default `core`/null → []. Plus the gate: `kitSurfaceItems` returns a kit's items only when its id is in the active set (`[]` and a foreign id exclude; omitted = all); `noteTypeOwnerKit` tags kit types and returns undefined for built-ins.
- `e2e/kit-activation.spec.ts` (NEW, web/chromium, mock provider) — default source has the textbook kit active (dropdown = `textbook-learning`): selection toolbar Explain visible, generate a Study Block, composer offers `textbook.explanation`. Switch the dropdown to **Core**: toolbar gone + composer no longer offers the kit type, **but the already-created Study Block still renders** (render not gated). Switch back to textbook: toolbar returns (per-source override).
- PATCH endpoint: NEW minimal `PATCH /api/sources/:sourceId` (merges `metadata` only, re-parses with `sourceSchema`, upserts) — no existing source-update route existed.
- Suite green 2026-06-25: `npm run check` (clean), `npm run test` (48 files, **314** tests; +6), `npm run e2e` (**21** web — all prior flows + the new kit-activation test). `npm run e2e:electron` NOT run (no webview/Electron-specific path changed; host study panel + a server metadata PATCH, covered by unit + web e2e) — flagged, not claimed.
- Deferred (flagged): workspace-default-kit settings UI (default hardcoded `textbook-learning`); multi-kit activation UI (data already an array); `kitTerm` term substitution across the wider shell (accessor is gate-aware but not yet consumed).
