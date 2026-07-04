import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// REV-3 — SRS scheduling over the review loop, against the real app (web mode,
// mock provider). Deterministic clock control WITHOUT faking the browser clock:
// POST /api/review/grade accepts an `at` override (the memory-events `ts` idiom),
// so "reviewed 8 days ago" is seeded as data and the due/overdue split falls out
// of the real wall clock:
//   • a card passed TODAY is scheduled ahead → out of the queue, counted 已排期;
//   • a card passed 8 DAYS AGO (1d interval) is overdue → recurs as 待复习;
//   • grading advances the ladder (1d → 明天; second pass → 6 天后) and drops the
//     due count; the schedule persists server-side (review-schedule.json);
//   • all-scheduled ⇒ the 提前复习 empty state; the button reopens the
//     schedule-free queue.

import { SERVER } from "./harness";

const DAY_MS = 86_400_000;

async function seedHtmlSource(request: APIRequestContext, title: string, body: string) {
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content: body } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

async function seedFlashcard(request: APIRequestContext, sourceId: string, front: string, back: string) {
  const res = await request.post(`${SERVER}/api/notes`, {
    data: { sourceId, contentType: "flashcard", content: { front, back } }
  });
  expect(res.ok(), `seed flashcard failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).note as { id: string };
}

async function gradeViaApi(request: APIRequestContext, noteId: string, result: string, at: string) {
  const res = await request.post(`${SERVER}/api/review/grade`, { data: { noteId, result, at } });
  expect(res.ok(), `grade failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).schedule as { due: string; intervalDays: number };
}

async function openSource(page: Page, source: { title: string }) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await page.locator(".source-item-open").filter({ hasText: source.title }).first().click();
  await expect(page.locator(".reader-tab-title")).toHaveText(source.title);
}

test("review SRS: due/scheduled split, grading advances the ladder, 提前复习 reopens the queue", async ({
  page,
  request
}) => {
  const title = `Review SRS ${Date.now()}`;
  const source = await seedHtmlSource(
    request,
    title,
    "<article><section><p>Buoyancy equals the weight of displaced fluid.</p></section></article>"
  );
  const cardA = await seedFlashcard(request, source.id, "A面 阿基米德原理?", "A背 排开液体的重力");
  const cardB = await seedFlashcard(request, source.id, "B面 密度公式?", "B背 ρ = m / V");
  const cardC = await seedFlashcard(request, source.id, "C面 浮沉条件?", "C背 比较浮力与重力");

  // Pre-schedule via the API clock override: A passed just now (due tomorrow →
  // scheduled ahead); C passed 8 days ago (1d interval → due 7 days ago → overdue).
  const now = Date.now();
  const rowA = await gradeViaApi(request, cardA.id, "pass", new Date(now).toISOString());
  expect(rowA.intervalDays).toBe(1);
  await gradeViaApi(request, cardC.id, "pass", new Date(now - 8 * DAY_MS).toISOString());

  await openSource(page, source);
  await page.locator('.icon-rail-btn[aria-label="复习"]').click();

  // Header: B (never graded) + C (overdue) are due; A is scheduled ahead.
  const count = page.locator(".review-count");
  await expect(count).toContainText("2 项待复习");
  await expect(count).toContainText("1 项已排期");

  // Order: never-graded first, then overdue. Grade B → the 1d ladder step (明天).
  const item = page.locator(".review-item");
  await expect(item).toHaveAttribute("data-note-id", cardB.id);
  await page.locator(".review-reveal-btn").click();
  await page.locator(".review-pass-btn").click();
  await expect(page.locator(".review-next-due")).toHaveText("下次复习:明天");
  await expect(count).toContainText("2 项已排期"); // the due count dropped, live

  // Advance → the overdue card recurs as 待复习; second pass → the 6d ladder step.
  await page.locator(".review-next-btn").click();
  await expect(item).toHaveAttribute("data-note-id", cardC.id);
  await expect(item).toHaveAttribute("data-reason", "due");
  await page.locator(".review-reveal-btn").click();
  await page.locator(".review-pass-btn").click();
  await expect(page.locator(".review-next-due")).toHaveText("下次复习:6 天后");
  await page.locator(".review-next-btn").click();

  // Round done. The schedule PERSISTED server-side (all three notes carry rows).
  await expect(page.locator(".review-summary-line")).toContainText("2 对");
  const persisted = (await (await request.get(`${SERVER}/api/review/schedule`)).json()).schedule as Record<
    string,
    { intervalDays: number }
  >;
  expect(Object.keys(persisted).sort()).toEqual([cardA.id, cardB.id, cardC.id].sort());
  expect(persisted[cardC.id].intervalDays).toBe(6);

  // 再复习一轮 rebuilds → everything scheduled ahead → the 提前复习 empty state;
  // the button reopens the schedule-free (legacy) queue with all three cards.
  await page.locator(".review-restart-btn").click();
  await expect(page.locator(".review-empty-scheduled")).toContainText("3 项已排期");
  await page.locator(".review-ahead-btn").click();
  await expect(count).toContainText("3 项待复习");
  await expect(count).toContainText("提前复习中");
  await expect(item).toBeVisible();
});
