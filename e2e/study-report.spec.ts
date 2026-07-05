import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { SERVER } from "./harness";

// REPORT-1 学习报告 — the flagship "把这段时间的学习总结成一份报告" flow, end to end in web
// mode against the deterministic mock provider. The report is DETERMINISTICALLY assembled
// from MEM-2 digests (the live-digest reconstruct keeps GET /api/memory/digests current) +
// review outcomes; the STRUCTURED mock echoes generateReport.prompt's mockContent, so the
// generate is deterministic; the generate command RE-MERGES the deterministic stats over
// the AI output (delta 3). The report saves SOURCE-LESS and its ONLY home is the report.list
// view — so this spec ASSERTS reachability (the blocker fix): generate → preview → Edit a
// highlight → Save → re-open 学习报告 → the report lists + re-opens with the edit intact.

// Seed graded review events (2 pass / 1 fail) + a mistake note.create, so the assembled
// report has non-zero stats. `ts` is the capture-queue wire time; the events land in
// today's digest window (本周).
async function seedStudyActivity(request: APIRequestContext) {
  const now = Date.now();
  const events = [
    { verb: "note.review", subject: { contentType: "flashcard" }, payload: { result: "pass" }, ts: new Date(now - 3_600_000).toISOString(), sessionId: "report-e2e" },
    { verb: "note.review", subject: { contentType: "flashcard" }, payload: { result: "pass" }, ts: new Date(now - 2_400_000).toISOString(), sessionId: "report-e2e" },
    { verb: "note.review", subject: { contentType: "flashcard" }, payload: { result: "fail" }, ts: new Date(now - 1_200_000).toISOString(), sessionId: "report-e2e" },
    // a mistake was logged (drives stats.mistakesLogged via the contentType==="mistake" cell)
    { verb: "note.create", subject: { contentType: "mistake" }, payload: {}, ts: new Date(now - 600_000).toISOString(), sessionId: "report-e2e" }
  ];
  const res = await request.post(`${SERVER}/api/memory/events`, { data: { events } });
  expect(res.ok(), `seed events failed: ${res.status()}`).toBeTruthy();
}

/** Open the global-search palette (Ctrl+K) and run the 学习报告 command → report.list pane. */
async function openReportsViaSearch(page: Page) {
  await page.locator(".library-panel").click();
  await page.keyboard.press("Control+k");
  await expect(page.locator(".global-search-input")).toBeVisible();
  await page.locator(".global-search-input").fill("学习报告");
  const row = page.locator('.global-search-row[data-row-id="open:report.list"]');
  await expect(row).toBeVisible();
  await row.dispatchEvent("mousedown");
  await expect(page.locator(".study-report-list")).toBeVisible();
}

test("学习报告: generate → preview → edit a highlight → save → re-open lists it (reachability)", async ({
  page,
  request
}) => {
  await seedStudyActivity(request);

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await expect(page.locator(".library-panel")).toBeVisible();

  // Baseline: no study-report notes yet. NOTE: the server's GET /api/notes honors
  // conceptId/anchorId/sourceId only — NOT contentType — so filter to study-report.report
  // CLIENT-SIDE, exactly as the report.list view does (allNotes() + a client filter). This
  // keeps the reachability read robust when the shared e2e vault also holds other specs' notes.
  const reportNotes = async () =>
    (((await (await request.get(`${SERVER}/api/notes`)).json()).notes ?? []) as {
      contentType: string;
      sourceId?: string;
    }[]).filter((n) => n.contentType === "study-report.report");
  const before = (await reportNotes()).length;

  // Launch the report.list pane from the STATIC NAV_COMMANDS entry (no rail icon — the
  // teachback launch precedent).
  await openReportsViaSearch(page);
  await expect(page.locator(".study-report-empty")).toBeVisible();

  // 生成学习报告 → the deterministic report parks in the generation preview (nothing saved).
  await page.locator(".study-report-generate-btn").click();
  const preview = page.locator(".generation-preview");
  await expect(preview).toBeVisible({ timeout: 15_000 });
  await expect(preview.locator(".generation-preview-type")).toHaveText("study-report.report");
  // The preview renders the FULL report card (period header + stats grid). reviewsDone=3
  // (2 pass + 1 fail) is the deterministic, re-merged stat.
  await expect(preview.locator(".sr-report")).toBeVisible();
  await expect(preview.locator('.sr-stat[data-stat="reviewsDone"] .sr-stat-value')).toHaveText("3");

  // Edit → change a highlight to a distinctive marker, then Save.
  const marker = `E2E-HL-${Date.now()}`;
  await preview.locator(".gen-preview-edit").click();
  const highlights = preview.locator(".sr-highlights-edit");
  await expect(highlights).toBeVisible();
  await highlights.fill(marker);
  await preview.locator(".gen-preview-save").click();
  await expect(preview).toHaveCount(0);

  // The source-less report persisted (listed among the vault's notes — the reachability read).
  await expect.poll(async () => (await reportNotes()).length, { timeout: 15_000 }).toBe(before + 1);
  // …with NO sourceId (vault-level) — the delta-1 invariant. Every study-report.report note is
  // source-less (the view only ever creates them via createNote with no sourceId).
  for (const saved of await reportNotes()) {
    expect(saved.sourceId ?? null).toBeNull();
  }

  // The report now LISTS in its home (the view reloaded in-place after Save) with the edited
  // highlight intact. THIS is the blocker fix: a source-less report is reachable after save.
  const item = page.locator(".study-report-item").first();
  await expect(item).toBeVisible({ timeout: 15_000 });
  await expect(item.locator(".sr-report")).toBeVisible();
  await expect(item.locator(".sr-highlights")).toContainText(marker);

  // …and a fresh re-open of 学习报告 (remount) still shows it — reachable across navigations.
  await page.keyboard.press("Control+k");
  await expect(page.locator(".global-search-input")).toBeVisible();
  await page.locator(".global-search-input").fill("学习报告");
  const reopen = page.locator('.global-search-row[data-row-id="open:report.list"]');
  await expect(reopen).toBeVisible();
  await reopen.dispatchEvent("mousedown");
  await expect(page.locator(".study-report-list")).toBeVisible();
  await expect(page.locator(".study-report-item .sr-highlights").first()).toContainText(marker);
});
