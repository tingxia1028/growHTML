import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { makeTextPdf } from "./fixtures/pdf";

// COMPREHENSIVE per-viewer study-flow self-test for the two HOST-PAGE surfaces that
// Playwright can drive directly in web mode: IMPORTED HTML (the srcDoc DomReader
// iframe) and PDF text-quote (the pdf.js PDFViewer text layer). The two WEBVIEW
// surfaces (live + local HTML) need the real Electron app and are covered by
// e2e-electron/viewer-flows.spec.ts.
//
// For EACH surface we assert the FULL basic study flow, INCLUDING the anchor that
// gets created — not just the source chip:
//   1. select a passage                    → the "Source" chip (.chat-source) fills
//   2. save a Note (composer Note mode)     → it appears in the .note-list
//   3. an anchor was actually created       → GET /api/sources/:id/anchors has the
//                                              expected anchorKind (html_selection /
//                                              pdf_selection) carrying the quote
//   4. the saved note PAINTS as a highlight  → the on-surface highlight is visible
//
// (loop.spec.ts already drives imported-HTML select→note→highlight→patch end to end;
// this file adds the explicit ANCHOR-creation assertion the mission asks for, for both
// host-page text-quote surfaces, so every viewer×step is covered by a real test.)

const SERVER = "http://127.0.0.1:4177";
const READER = 'iframe[title="Source reader"]';

async function seedHtmlSource(request: APIRequestContext, title: string, body: string) {
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content: body } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

async function seedPdf(request: APIRequestContext, title: string) {
  const data = makeTextPdf("Imported PDF passage about render threads.").toString("base64");
  const res = await request.post(`${SERVER}/api/sources/pdf`, { data: { title, dataBase64: data } });
  expect(res.ok(), `seed pdf failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string };
}

async function saveNote(page: Page, text: string) {
  await page.locator(".composer-mode .mode-tab", { hasText: "Note" }).click();
  await page.locator(".composer-input").fill(text);
  await page.getByRole("button", { name: "Save Note" }).click();
  await expect(page.locator(".note-list")).toContainText(text);
}

async function anchorsFor(request: APIRequestContext, sourceId: string) {
  const res = await request.get(`${SERVER}/api/sources/${sourceId}/anchors`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).anchors as Array<{ anchorKind: string; quote?: string; page?: number }>;
}

// IMPORTED HTML (DomReader srcDoc iframe): select → chip → note → html_selection anchor
// → painted highlight.
test("imported HTML viewer: select → chip → note → html_selection anchor → highlight", async ({ page, request }) => {
  const title = `Flow HTML ${Date.now()}`;
  const body = "<article><section><p>Imported paragraph about render threads.</p></section></article>";
  const source = await seedHtmlSource(request, title, body);

  await page.goto("/");
  await page.locator(".source-item-open", { hasText: title }).click();
  await expect(page.locator(".reader-header h2")).toHaveText(title);

  // STEP 1 — selecting in the reader iframe fills the host Source chip.
  const reader = page.frameLocator(READER);
  await reader.getByText("Imported paragraph", { exact: false }).click();
  await expect(page.locator(".chat-source")).toContainText("Imported paragraph");

  // STEP 2 — save a note.
  await saveNote(page, "Imported HTML flow note.");

  // STEP 3 — an html_selection anchor was created carrying the quote.
  const anchors = await anchorsFor(request, source.id);
  const anchor = anchors.find((a) => a.anchorKind === "html_selection");
  expect(anchor, "expected an html_selection anchor").toBeTruthy();
  expect(anchor!.quote).toContain("Imported paragraph");

  // STEP 4 — the note paints as an anchored highlight on the passage.
  const annotated = reader.locator(".sv-annotated").first();
  await expect(annotated).toBeVisible();
  await expect(annotated).toContainText("Imported paragraph");
});

// PDF TEXT-QUOTE (pdf.js text layer): select text → chip → note → pdf_selection anchor
// (with the quote) → painted highlight. (regions.spec.ts covers the PDF REGION mode +
// its rect anchor; this covers the PDF text-QUOTE path's full flow incl. the anchor.)
test("PDF viewer (text quote): select → chip → note → pdf_selection anchor → highlight", async ({ page, request }) => {
  const source = await seedPdf(request, `Flow PDF ${Date.now()}`);

  await page.goto("/");
  await page.locator(".source-item-open").filter({ hasText: source.id }).click();

  // Wait for the text layer to render selectable spans on page 1.
  const textLayer = page.locator('.pdfViewer .page[data-page-number="1"] .textLayer');
  await expect(textLayer).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => textLayer.locator("span").count(), { timeout: 20_000 }).toBeGreaterThan(0);

  // STEP 1 — select the page's text (a real DOM Selection) + fire mouseup so the
  // reader reads it and emits a quote draft → the Source chip fills.
  await textLayer.evaluate((layer) => {
    const sel = window.getSelection();
    sel?.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(layer);
    sel?.addRange(range);
    layer.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  const chip = page.locator(".chat-source .chat-source-quote");
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("render threads", { timeout: 10_000 });

  // STEP 2 — save a note.
  await saveNote(page, "PDF quote flow note.");

  // STEP 3 — a pdf_selection anchor was created carrying the quote (text, not a rect).
  const anchors = await anchorsFor(request, source.id);
  const anchor = anchors.find((a) => a.anchorKind === "pdf_selection" && (a.quote ?? "").includes("render threads"));
  expect(anchor, "expected a pdf_selection text-quote anchor").toBeTruthy();
  expect(anchor!.page).toBe(1);

  // STEP 4 — the note paints as a highlight over the text layer (a .sv-annotated mark
  // is injected into the page's text layer by the PDF reader's paint).
  await expect(page.locator('.pdfViewer .page[data-page-number="1"] .sv-annotated').first()).toBeVisible({
    timeout: 10_000
  });
});
