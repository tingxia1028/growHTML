# Lens→Kit migration (bookmark.list + mistake.book → register-only KIT lenses) — BUILD SPEC

Status: Plan (verify-foundation-first) → mechanical register-only RELOCATION. Product-owner decision:
browse lenses + the review drill are kits, not core; `bookmark`/`mistake` contentTypes + the SRS
ENGINE + `concept.*` STAY core. Scope: bookmark + mistake + **review.panel** (owner said "复习面板拔掉吧").
review is the MORE-WIRED one — ONLY the `ReviewPanel.tsx` drill VIEW moves; the engine/queue/scope/io/
push stay core; review KEEPS its rail entry (复习 = a primary daily surface).

## VERIFIED foundation (the load-bearing seam — do NOT rebuild; cite)
- **Kit views register IDENTICALLY to core views**: `registerView({kind})` at MODULE scope (`viewRegistry.tsx:29` = a plain global `Map`, no kit scoping) + a shell side-effect `import` in `WorkspaceShell.tsx`. `report.list` proves it: `ReportListView.tsx:171` self-registers, `WorkspaceShell.tsx:70` `import "../../kits/study-report/ReportListView"`. The `KitInstallContext.views` sink (`clientContext.tsx:193`) is DEAD (`kitViews` pushed, never read). **So moving a view file into `src/kits/` changes NOTHING about registration except the one shell import line.**
- **Kit-lens launch = a CORE `commandEntries.ts` NAV entry** (NOT a kit command): `GlobalSearch.tsx:413` enumerates only `NAV_COMMANDS` (`searchCommandEntries()`), never `kitCommands`. `report.list`'s Cmd+K row comes from `commandEntries.ts:47` (a CORE entry). The kit `study-report.open` command (`commands.ts:112`) is registered but INVISIBLE to the palette (dead/redundant). **=> DO NOT add kit `open` commands for bookmark/mistake — they'd be dead code. The CORE NAV entry is the real launch. 40afa3f's mistake.book core NAV entry was already correct.**
- `bookmark`/`mistake` contentTypes are CORE (`core/notes/contentTypes.ts`) — UNCHANGED. `useBookmarks.ts` is a SHARED core hook (also feeds the reader's BookmarkIndex) — STAYS in `src/client/workspace/`.

## Commit sequence (each compiles [tsc 0 catches import-depth misses] + full vitest green; baseline 269f/2737t incl. 40afa3f)
**Commit 1 — fold mistake.book into the mistake-photo kit.**
- MOVE `src/client/workspace/mistakeBookView.tsx` → `src/kits/mistake-photo/MistakeBookView.tsx`; `mistakeBook.css` → `src/kits/mistake-photo/mistakeBook.css` (co-locate, the study-report/studyReport.css precedent). Fix the ~6 relative import depths (client/workspace → kits/mistake-photo is same-2-up for `core/`, but `../notes/noteTypeRegistry`→`../../client/notes/noteTypeRegistry`, `./viewRegistry`→`../../client/workspace/viewRegistry`, `./shellNav`→`../../client/workspace/shellNav`, `../review/reviewScope`→`../../client/review/reviewScope`, `../data/entityClient`→`../../client/data/entityClient`; `./mistakeBook.css` stays). `registerView({kind:"mistake.book"})` UNCHANGED (same kind → all consumers resolve).
- REPOINT `WorkspaceShell.tsx` `import "./mistakeBookView"` → `import "../../kits/mistake-photo/MistakeBookView"` (+ comment).
- MOVE `mistakeBookView.test.tsx` → `src/kits/mistake-photo/MistakeBookView.test.tsx` (fix paths + `./mistakeBookView`→`./MistakeBookView`); assertions UNCHANGED (kind-keyed).
- KEEP the 40afa3f CORE `commandEntries.ts` mistake.book NAV entry + `searchMessages.cmdMistakeBook` (this IS the launch). `commandEntries.test.ts` UNCHANGED.
- Tests: the moved view test (lists/filters/delete/复习错题) + a regression pin `getView("mistake.book")` resolves after imports + `mistake-photo/register.test.tsx` pins `mistake` contentType stays CORE.

**Commit 2 — new bookmarks kit; move bookmark.list into it.**
- NEW `src/kits/bookmarks/index.tsx` (`bookmarksKit`, mirroring `studyReportKit`: no contentSpecs, no prompts, `install(){}`); add `bookmarksKit` to `productKits` (`clientKits.tsx:28`) + import.
- MOVE `src/client/workspace/bookmarkViews.tsx` → `src/kits/bookmarks/BookmarkListView.tsx`; fix import depths (`./useBookmarks`→`../../client/workspace/useBookmarks` — LEAVE useBookmarks.ts in core; `./viewRegistry`→`../../client/workspace/viewRegistry`, `../notes/noteTypeRegistry`→`../../client/notes/noteTypeRegistry`). `registerView({kind:"bookmark.list"})` UNCHANGED.
- REPOINT `WorkspaceShell.tsx` `import "./bookmarkViews"` → `import "../../kits/bookmarks/BookmarkListView"`.
- MOVE `bookmarkViews.test.tsx` → `src/kits/bookmarks/BookmarkListView.test.tsx` (fix paths + import). Assertions UNCHANGED.
- KEEP: the CORE `commandEntries.ts:51` `open:bookmark.list` NAV entry; the dock presets (`presets.ts:66`, `dock.ts:95/122` — kind-keyed, view-location-agnostic). Bookmark.list has no rail entry. ZERO launch change.
- Tests: moved view test (list/chip/jump/empty) + a tiny bookmarks-kit register test (`getView("bookmark.list")` resolves + `getNoteContentSpec("bookmark")` stays CORE) + regression `views.test.tsx:25` (bookmark filtered out of main note list) UNCHANGED.

**Commit 3 — fix the e2e 40afa3f broke + comment cleanup.**
- `e2e/mistake-photo.spec.ts:92` `openRailPane(page,"错题本",...)` is ALREADY BROKEN by 40afa3f (错题本 left the rail). FIX it: open 错题本 via Cmd+K (the global-search "错题本"/open:mistake.book path — mirror how `e2e/study-report.spec.ts` opens report.list via global search) instead of a rail click. Verify the e2e passes.
- Comment-only: correct the misleading 40afa3f "KIT Command" framing in the kit index/shell comments — the browse-lens launch is the CORE `commandEntries.ts` NAV entry. No test impact. Do NOT add dead kit `open` commands.

**Commit 4 — review.panel → a new `review` kit (the drill VIEW ONLY; the engine stays core).**
- STEP-0 DEP CHECK FIRST (review is more-wired): (a) list `src/client/review/ReviewPanel.tsx`'s imports; (b) grep who imports the review SUPPORT modules (`queue.ts`, `reviewScope.ts`, `reviewIo.ts`, `reviewPush.ts`) AND who imports the `ReviewPanel` COMPONENT directly (not via `getView("review.panel")`). If ReviewPanel is imported as a component by non-shell files, or the support can't cleanly stay core, STOP after commits 1-3 and REPORT for a separate pass (do NOT force it).
- MOVE ONLY `ReviewPanel.tsx` (+ `ReviewPanel.test.tsx`) → `src/kits/review/ReviewPanel.tsx`; fix import depths (it imports queue/scope/io from `../` → `../../client/review/`; the core schedule from `../../core/review/`). `registerView({kind:"review.panel"})` UNCHANGED.
- KEEP CORE (do NOT move): `src/core/review/*` (schedule engine), `src/client/review/queue.ts` (SHARED — the REPORT-1 assembler uses `weakReviewBuckets`), `reviewScope.ts` (SHARED — mistakeBookView's 复习错题 uses it), `reviewIo.ts`, `reviewPush.ts` (PRO-1 trigger nav). `recordReviewGrade` (server) stays. The `mistake` review-capability + queue selection stay core.
- NEW `src/kits/review/index.tsx` (`reviewKit`, minimal like `bookmarksKit`); add to `productKits`.
- REPOINT `WorkspaceShell.tsx` the ReviewPanel side-effect import → `../../kits/review/ReviewPanel`.
- KEEP the rail entry `IconRail.tsx:39` `{kind:"review.panel"}` (复习 = a primary daily surface — rail STAYS 4: library/review/concept/profile; kit-ness = view code location, NOT reachability). KEEP any core NAV/onboarding/profile nav to "review.panel" (kind-keyed, survives the move).
- Tests: moved `ReviewPanel.test.tsx` (unchanged assertions) + a `review` kit register pin (`getView("review.panel")` resolves) + regression pins that the queue assembles + grades record + `reviewPush`/onboarding nav still resolves the pane. The `mistakeBookView` 复习错题 scoped-launch test stays green (reviewScope stayed core).

## What could BREAK + fix (all import-path/location only; kind-preserving)
- The 2 shell side-effect imports (WorkspaceShell.tsx:47,64) → repointed (the single load-bearing wiring change).
- Moved views' + tests' relative imports → mechanically re-pointed (tsc catches misses).
- KEEP (no change, kind-keyed): commandEntries NAV entries + commandEntries.test, IconRail rail-set (rail stays 4), dock/presets. No test pins the OLD FILE location.

## Gates: tsc 0 · full vitest green (baseline 269f/2737t, grow/never regress) · `npm run build` ✓ · `e2e/mistake-photo.spec.ts` PASSING (the 40afa3f fix). Commit the sequence, DON'T push (I verify+land), DON'T touch docs (return TEXT). SURGICAL git. Codex files (styles.css, SlashPalette.tsx, workspace/anchorViews.*, workspace/actionIcons.ts, FileTree.tsx) UNTOUCHED — the moved views + mistakeBook.css are NOT codex's; the `.bookmark-panel` rule in styles.css is class-keyed, LEAVE it (moving it would touch codex's file, and it works regardless of the view's dir).

## Register-only / kernel-law: confirmed. Views change directories + self-register into the same global registry; zero core-engine/schema/route/contentType change; bookmark/mistake stay CORE; review.panel + concept stay CORE; no behavior change (same list/filters/launch; bookmark.list stays SOURCE-scoped, mistake.book stays CROSS-source). ~3 commits, ~150-250 lines, mostly moves + path fixes.

## Deferred: concept stays core (owner-confirmed — engine + lens); the kit-command→Cmd+K + kit-rail registration gap (a marketplace seam so a 3rd-party kit-lens can self-register a Cmd+K/rail launch instead of needing a core commandEntries/RAIL_ENTRIES edit — backlog, flagged this session).
