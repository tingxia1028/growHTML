import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { SERVER } from "./harness";

// PRO-2 教回/费曼 teach-back — the flagship "AI 装不懂" flow against the REAL app (web
// mode, deterministic mock provider). Weak-bucket topics fall out of seeded note.review
// FAILURES (the live-digest reconstruct makes GET /api/memory/digests current between
// consolidation passes), so the panel offers a topic; the STRUCTURED mock echoes each
// prompt's mockContent, so pose→probe→wrapup are deterministic across turns. The wrap-up
// lands a teachback.summary note that renders through the ONE getNoteType contract.

async function seedHtmlSource(request: APIRequestContext, title: string, body: string) {
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content: body } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

// Seed enough note.review FAILURES on ONE contentType bucket to cross the profile 弱项
// thresholds (>=3 attempts, >=50% fail ratio) → a weak bucket → a teach-back topic.
async function seedWeakBucket(request: APIRequestContext, contentType: string) {
  const events = [0, 1, 2].map((i) => ({
    verb: "note.review",
    subject: { contentType },
    payload: { result: "fail", mode: "self" },
    ts: new Date(Date.now() - (3 - i) * 3_600_000).toISOString(),
    sessionId: "teachback-e2e"
  }));
  const res = await request.post(`${SERVER}/api/memory/events`, { data: { events } });
  expect(res.ok(), `seed events failed: ${res.status()}`).toBeTruthy();
}

/** Open the global-search palette (Ctrl+K) and run the teach-back command. */
async function openTeachbackViaSearch(page: Page) {
  await page.locator(".library-panel").click();
  await page.keyboard.press("Control+k");
  await expect(page.locator(".global-search-input")).toBeVisible();
  await page.locator(".global-search-input").fill("教回");
  const row = page.locator('.global-search-row[data-row-id="open:teachback.panel"]');
  await expect(row).toBeVisible();
  await row.dispatchEvent("mousedown");
}

test("teach-back: launch → pick a weak topic → explain across probes → land a summary note", async ({
  page,
  request
}) => {
  const title = `Teach-back ${Date.now()}`;
  await seedHtmlSource(
    request,
    title,
    "<article><section><p>Buoyancy equals the weight of displaced fluid.</p></section></article>"
  );
  await seedWeakBucket(request, "flashcard");

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await expect(page.locator(".library-panel")).toBeVisible();

  // Launch the runner from the global-search command (the STATIC NAV_COMMANDS entry).
  await openTeachbackViaSearch(page);
  await expect(page.locator(".teachback-panel")).toBeVisible();

  // A weak-bucket topic is offered (the flashcard contentType bucket).
  const topic = page.locator(".teachback-topic-btn").first();
  await expect(topic).toBeVisible();
  await topic.click();

  // The AI poses (装不懂), then we teach it across the round cap (3 explanations).
  await expect(page.locator(".teachback-turn-ai").first()).toBeVisible();
  const explain = page.locator(".teachback-explain-input");
  const submit = page.locator(".teachback-submit-btn");
  for (const text of ["浮力等于排开的水重", "阿基米德原理", "压强差推导"]) {
    await expect(explain).toBeVisible();
    await explain.fill(text);
    await submit.click();
  }

  // The cap hit → the wrap-up summary renders through getNoteType("teachback.summary").
  await expect(page.locator(".teachback-summary")).toBeVisible();
  await expect(page.locator(".tb2-summary")).toBeVisible();

  // Save → the summary persists as a teachback.summary note.
  await page.locator(".teachback-save-btn").click();
  await expect(page.locator(".teachback-save-btn")).toBeDisabled();

  // The note landed server-side with the right contentType.
  await expect
    .poll(async () => {
      const res = await request.get(`${SERVER}/api/notes?contentType=teachback.summary`);
      if (!res.ok()) return 0;
      const body = (await res.json()) as { notes?: { contentType: string }[] };
      return (body.notes ?? []).filter((n) => n.contentType === "teachback.summary").length;
    })
    .toBeGreaterThanOrEqual(1);
});
