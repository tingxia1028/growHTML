# Source Authoring — library "+" (new md/html/…), source editing, 纯编辑模式

Create documents from inside the app (a **+** in the library: blank markdown, blank HTML page,
download-from-URL, live web, local file) and EDIT sources, with a pure-edit mode toggle in the
document header. Grounded 2026-07. The user's conflict question answered honestly in §2.

## 1. Shipped substrate (creation is nearly free; editing was ANTICIPATED but unfinished)
- **Create paths exist server-side:** `POST /api/sources/html` takes raw `{title, content}`;
  `ingestSource` accepts `sourceType: "markdown"|"html"` (`sources.ts:64-91`, the same route W3's
  AI synthesis uses — this feature is its manual twin). Client has `ingestUrl` (download a
  webpage), `ingestWebLive`, `ingestLocalFile` (`entityClient.ts:478-485`). **Missing only:**
  blank-create bindings + the + menu UI.
- **A source-editing PATCH system is fully DESIGNED in core** (`src/core/schema/patch.ts`):
  10 actions (`replace_selection`, `rewrite_section`, `restructure_document`, …), 6-state
  lifecycle (`pending/accepted/rejected/applied/reverted/conflict`), `oldText/newContent`
  provenance, `appliedAt/revertedAt` — anchored to `sourceId+anchorId`. The chat panel already
  authors patch records ("Edit source (patch)", `activePatches`, `changePatchStatus`).
  **But the APPLY engine was never built** — grep confirms no server-side code ever rewrites a
  source from a patch; `applied/reverted/conflict` are aspirational states today.
- **GrapesJS** (`grapesjs` + `grapesjs-preset-webpage`) is in package.json with ZERO src usage —
  a rich HTML editor already paid for in the dependency tree, unwired.
- **Re-anchoring machinery exists:** imported layers re-project anchors with
  `matched/fuzzy/unmatched` states — the exact mechanism source edits need.

## 2. The conflict assessment (the user's question)
**Creation (+): zero conflict.** Everything flows through the existing ingest; new sources are
ordinary sources.
**Editing: three REAL conflicts — all engineerable, none forbidding:**
1. **Anchors.** `html_selection` anchors pin quote+context; editing the anchored passage orphans
   them, and `injectStudyIds` is order-based so ANY edit shifts later studyIds. → On save,
   RE-PROJECT all of the source's anchors against the new content by quote+context (the import
   machinery), never by studyId; non-matching anchors become `unmatched` (state already modeled)
   and surface in a "受影响的锚点" list for manual re-binding.
2. **contentHash / svpack.** Hash is the FIRST key in the layer↔source fingerprint chain and
   svpack's `sourceMatch`. An edit re-hashes → previously published packs no longer match the
   edited copy (recipients degrade to the existing unbound state — safe), and future exports pin
   the new hash. → local layer binding is by `localSourceId` (unaffected); WARN before editing a
   source that has publish-ledger entries or shared layers ("已分享过的文档,编辑会使旧分享包无法
   绑定").
3. **File ownership.** The edit surface + anchor re-projection live next to reader/projection
   files a concurrent session owns → implementation of the edit half is gated like N-track; the
   create half + a standalone editor view are new files.

## 3. Model
- `source.origin: "authored" | "imported"` (additive; existing sources default imported) +
  `revision: number` (bump per save).
- **Authored sources: direct edit.** Reader ⇄ **纯编辑模式** toggle in the document header
  (markdown → text editor; html → source editor first, GrapesJS as the later rich option —
  bundle-weight decision at implementation). Save = update content → re-hash → re-ingest
  (studyIds) → re-project anchors → surface unmatched.
- **Imported sources: read-only body.** Two edit routes: **fork to an authored copy** (new
  source, notes/anchors stay on the original), or **targeted patches** — finally building the
  designed patch APPLY engine: `accepted → applied` verifies `oldText` still matches at the
  anchor (else → `conflict`), rewrites the stored content through the same
  save→re-hash→re-project pipeline, `reverted` restores. Patches double as the edit LOG.
- **+ menu (library):** 新建 Markdown · 新建 HTML 页 · 从 URL 下载 (ingestUrl) · 在线网页
  (web_live) · 本地文件 (local-file) — two new blank-creates + the three existing imports
  consolidated into one affordance.

## 4. Phasing
- **SRC-1 — create half:** blank-create templates + entityClient bindings + the + menu +
  a minimal authored-markdown editor view (new registered viewer, own chrome hosts the toggle —
  avoids reader files). Library UI wiring lives in contended `views.tsx` → component built
  parallel-safe, one-line mount gated. Build the update-source service on the X0a service layer.
- **SRC-2 — the edit pipeline:** save→re-hash→re-project→unmatched surfacing + the shared-source
  edit warning + 纯编辑模式 for authored html. (Projection files = reader-session-gated.)
- **SRC-3 — patch APPLY engine:** finish the designed lifecycle (accepted→applied/conflict,
  revert) + imported-source fork. The chat's existing patch records become real.
- **SRC-4 — rich editing:** GrapesJS decision for html pages; templates.

## 5. Tests
Create: + entries → source appears with origin/revision, guard existing imports unchanged.
Edit pipeline: seeded anchors → edit elsewhere → still matched; edit the anchored passage →
unmatched + listed; hash changed + revision bumped; svpack warning fires only for
published/shared sources. Patch apply: oldText drift → conflict (not applied); revert restores
bytes. e2e: + → 新建 Markdown → type → save → annotate it like any source.
