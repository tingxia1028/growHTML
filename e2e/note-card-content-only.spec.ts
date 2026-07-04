import { expect, test, type APIRequestContext } from "@playwright/test";

// Regression guard for the in-reader note presentation (the "content-only card" +
// view-layer marker overlay work). The floating note card that pops on hovering an
// annotated passage must render ONLY the note body — no title bar / grip / close /
// type-label / footer chrome (regressions here show up as the old "≡ note ›" header
// coming back). Also asserts the anchor+type MARKER chip paints in the view-layer
// overlay for the HTML reader (a sibling of the iframe body, not injected into content).
//
// Run: npm run e2e  (Playwright boots its own server+client on dedicated e2e ports — e2e/harness.ts.)

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

test("HTML note card is content-only (no chrome) and paints a view-layer marker", async ({ page, request }) => {
  const title = `E2E ContentCard ${Date.now()}`;
  const passage = "This sentence is the anchored passage for the study note.";
  const body = `<article><h1>Real-Time Denoising</h1><p>A spatiotemporal denoiser reconstructs a clean image by blurring along surfaces.</p><p>${passage}</p></article>`;
  const noteText = "# ReLAX vs SVGF\n\nReLAX keeps the raw hit distance for the specular signal.";

  const source = await seedHtmlSource(request, title, body);
  await seedAnchoredNote(request, source.id, passage, noteText);

  await page.goto("/");
  await page.locator(".source-item-open", { hasText: title }).first().click();
  await expect(page.locator(".reader-tab-title")).toHaveText(title);

  const reader = page.frameLocator(READER);

  // Old→new: the floating ("Document") mode is gone — the TopBar tab was removed and
  // annotationMode is pinned to "margin" (the overlay IS the document, 2026-07-04).
  // The in-reader presentation under test is therefore the persistent GUTTER card,
  // which renders the same sanctioned content-only note body the hover card did.

  // The seeded note paints as a highlight on the passage.
  const annotated = reader.locator(".sv-annotated", { hasText: "anchored passage" }).first();
  await expect(annotated).toBeVisible();

  // View-layer MARKER: the anchor+type chip lives in the overlay (a sibling layer),
  // NOT injected into the annotated content. It must exist for the HTML reader.
  await expect(reader.locator(".sv-marker-overlay")).toHaveCount(1);
  await expect(reader.locator(".sv-marker-overlay .sv-anchor-markers").first()).toBeAttached();

  // The margin (gutter) card for the seeded note is laid out by default.
  const card = reader.locator("#sv-margin-layer .sv-margin-note").first();
  await expect(card).toBeVisible();

  // CONTENT-ONLY: the sanctioned note body renders (the note text is present)...
  await expect(card).toContainText("ReLAX keeps the raw hit distance");
  await expect(card.locator(".sv-note-content")).toHaveCount(1);

  // ...and NONE of the old chrome (title bar / grip / close / type badge / footer) is present.
  await expect(
    card.locator(
      ".sv-note-card-bar, .sv-note-card-grip, .sv-note-card-close, .sv-card-type, .sv-card-more, .sv-card-footer"
    )
  ).toHaveCount(0);

  // Cleanup so the dev/e2e vault doesn't accumulate the fixture.
  await request.delete(`${SERVER}/api/sources/${source.id}`);
});
