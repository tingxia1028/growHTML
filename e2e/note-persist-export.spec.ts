import { expect, test, type APIRequestContext } from "@playwright/test";

// N5 (note-presentation-unified.md §10) — the D11 per-source hide-all toggle and the
// D10 notes/anchors export, in the reader toolbar. Hide-all masks the CARDS/notes for
// the source (the gutter card + the note-slot chip) while KEEPING the anchor glyph
// chip (passages stay findable — the inverse of the N1a 显示锚点标记 switch); export
// downloads a portable markdown + JSON bundle of the source's notes/anchors.
//
// Run: npm run e2e  (Playwright boots its own server+client on dedicated e2e ports.)

import { SERVER } from "./harness";
const READER = 'iframe[title="Source reader"]';

async function seedHtmlSource(request: APIRequestContext, title: string, body: string) {
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content: body } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

async function seedAnchoredNote(request: APIRequestContext, sourceId: string, quote: string, content: string) {
  const aRes = await request.post(`${SERVER}/api/anchors`, {
    data: { sourceId, anchorKind: "html_selection", studyId: `seed-${Date.now()}`, quote, contextBefore: "", contextAfter: "" }
  });
  expect(aRes.ok(), `seed anchor failed: ${aRes.status()}`).toBeTruthy();
  const anchor = (await aRes.json()).anchor as { id: string };
  const nRes = await request.post(`${SERVER}/api/notes`, {
    data: { sourceId, anchorIds: [anchor.id], contentType: "markdown", content }
  });
  expect(nRes.ok(), `seed note failed: ${nRes.status()}`).toBeTruthy();
}

test("hide-all masks the source's note cards + note chips while anchor glyphs stay; export downloads a bundle", async ({
  page,
  request
}) => {
  const title = `E2E PersistExport ${Date.now()}`;
  const passage = "This sentence is the anchored passage for the persist and export test.";
  const body = `<article><h1>Persist + Export</h1><p>${passage}</p></article>`;
  const noteText = "# Study note\n\nThe remembered layout travels with the export.";

  const source = await seedHtmlSource(request, title, body);
  await seedAnchoredNote(request, source.id, passage, noteText);

  await page.goto("/");
  await page.locator(".source-item-open", { hasText: title }).first().click();
  await expect(page.locator(".reader-tab-title")).toHaveText(title);

  const reader = page.frameLocator(READER);

  // Baseline: the seeded note paints (highlight), the note-slot chip and the gutter
  // card exist, and the D11 toggle is present in the reader toolbar.
  await expect(reader.locator(".sv-annotated", { hasText: "anchored passage" }).first()).toBeVisible();
  const anchorChip = reader.locator('.sv-anchor-markers[data-sv-slot="anchor"]').first();
  const noteChip = reader.locator('.sv-anchor-markers[data-sv-slot="note"]').first();
  const marginCard = reader.locator("#sv-margin-layer .sv-margin-note").first();
  await expect(anchorChip).toBeAttached();
  await expect(marginCard).toBeVisible();

  const hideAll = page.locator(".hide-all-notes-toggle").first();
  await expect(hideAll).toBeVisible();
  await expect(hideAll).toHaveAttribute("aria-pressed", "false");

  // Flip hide-all ON: the gutter card is gone and the note-slot chip is hidden, but
  // the anchor glyph chip stays (the CARDS/notes are masked, the glyph is not).
  await hideAll.click();
  await expect(hideAll).toHaveAttribute("aria-pressed", "true");
  await expect(reader.locator("#sv-margin-layer .sv-margin-note")).toHaveCount(0);
  await expect(noteChip).toBeHidden();
  await expect(anchorChip).toBeVisible();

  // Flip OFF: the card + note chip return.
  await hideAll.click();
  await expect(hideAll).toHaveAttribute("aria-pressed", "false");
  await expect(reader.locator("#sv-margin-layer .sv-margin-note").first()).toBeVisible();

  // D10 export: clicking the export button triggers downloads (the JSON round-trip
  // truth first). We assert at least one download fires with the expected name.
  const exportBtn = page.locator('button[aria-label="Export notes"], button[aria-label="导出笔记"]').first();
  await expect(exportBtn).toBeVisible();
  const download = await Promise.all([page.waitForEvent("download"), exportBtn.click()]).then(([d]) => d);
  expect(download.suggestedFilename()).toMatch(/\.(json|md)$/);

  // Cleanup so the dev/e2e vault doesn't accumulate the fixture.
  await request.delete(`${SERVER}/api/sources/${source.id}`);
});
