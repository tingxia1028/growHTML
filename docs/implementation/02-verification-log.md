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
