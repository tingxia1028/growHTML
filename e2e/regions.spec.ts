import { expect, test, type APIRequestContext, type Locator } from "@playwright/test";
import { makeTextPdf, makeMultiPageTextPdf } from "./fixtures/pdf";
import { makeGradientPng } from "./fixtures/image";

// Region (geometric) anchoring against the REAL running app, web mode. Covers the
// two region-capable surfaces that render in the HOST page (so Playwright can drive
// them): PDF (PDF.js) and image (ImageReader). For each: seed a source, rubber-band
// a region, save it as a note (which materializes the anchor), then assert the
// stored anchor carries a rect and a region box paints.

const SERVER = "http://127.0.0.1:4177";

// A 200x150 gradient PNG — large enough to render at a draggable size.
const IMAGE_BASE64 = makeGradientPng(200, 150).toString("base64");

async function seedPdf(request: APIRequestContext, title: string) {
  const data = makeTextPdf("Region figure self-test page content.").toString("base64");
  const res = await request.post(`${SERVER}/api/sources/pdf`, { data: { title, dataBase64: data } });
  expect(res.ok(), `seed pdf failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string };
}

async function seedImage(request: APIRequestContext, title: string) {
  const res = await request.post(`${SERVER}/api/sources/image`, {
    data: { title, dataBase64: IMAGE_BASE64, mimeType: "image/png" }
  });
  expect(res.ok(), `seed image failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string };
}

// Drag a rubber-band rectangle inside `target` from a relative start to end point.
async function dragRegion(page: import("@playwright/test").Page, target: Locator, fromFrac: number, toFrac: number) {
  const box = await target.boundingBox();
  if (!box) throw new Error("target has no bounding box");
  const start = { x: box.x + box.width * fromFrac, y: box.y + box.height * fromFrac };
  const end = { x: box.x + box.width * toFrac, y: box.y + box.height * toFrac };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2);
  await page.mouse.move(end.x, end.y);
  await page.mouse.up();
}

async function saveNote(page: import("@playwright/test").Page, text: string) {
  // Scope to the composer's mode tabs (the PDF reader toolbar has its own tabs).
  await page.locator(".composer-mode .mode-tab", { hasText: "Note" }).click();
  await page.locator(".composer-input").fill(text);
  await page.getByRole("button", { name: "Save Note" }).click();
  await expect(page.locator(".note-list")).toContainText(text);
}

// THE SCROLL REGRESSION. Seed a tall multi-page PDF, scroll the reader's scroll
// container, and assert (a) scrollTop actually moved AND (b) a later page (page 2)
// is present — i.e. the scroll root really scrolls and the content is there. The
// official PDFViewer pre-creates a sized .page placeholder for every page (canvas +
// text render lazily), so page 2's box exists from the start.
test("pdf scroll: the scroll container scrolls and later pages are present", async ({ page, request }) => {
  // Many pages → the scroll container is taller than the viewport, so it must scroll.
  const texts = Array.from({ length: 8 }, (_, i) => `Scroll regression page ${i + 1} content line.`);
  const data = makeMultiPageTextPdf(texts).toString("base64");
  const res = await request.post(`${SERVER}/api/sources/pdf`, {
    data: { title: `Scroll PDF ${Date.now()}`, dataBase64: data }
  });
  expect(res.ok(), `seed pdf failed: ${res.status()}`).toBeTruthy();
  const source = (await res.json()).source as { id: string };

  await page.goto("/");
  await page.locator(".source-item-open").filter({ hasText: source.id }).click();

  // Page 1 renders first.
  const scroller = page.locator(".pdf-reader-canvas");
  await expect(page.locator('.page[data-page-number="1"]')).toBeVisible({ timeout: 20_000 });

  // The scroll container is overflowing (content taller than the box).
  const overflow = await scroller.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(overflow, "PDF content should overflow the scroll container").toBeGreaterThan(50);

  // Scroll the container down and assert scrollTop actually advanced.
  const before = await scroller.evaluate((el) => el.scrollTop);
  await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect.poll(async () => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);

  // Page 2's placeholder box is present further down the scroll column.
  await expect(page.locator('.page[data-page-number="2"]')).toBeVisible({ timeout: 20_000 });
});

// PDF TEXT selection → quote draft (read direction), against the text layer.
// Selecting text in page 1's .textLayer must surface a text quote in the chip.
test("pdf quote: selecting text in the text layer → quote source chip", async ({ page, request }) => {
  const source = await seedPdf(request, `Quote PDF ${Date.now()}`);
  await page.goto("/");
  await page.locator(".source-item-open").filter({ hasText: source.id }).click();

  // Wait for the text layer to render some selectable spans on page 1.
  const textLayer = page.locator('.page[data-page-number="1"] .textLayer');
  await expect(textLayer).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => textLayer.locator("span").count(), { timeout: 20_000 }).toBeGreaterThan(0);

  // REAL-selection guard: the official viewer's spans must have a non-zero font-size
  // (driven by --total-scale-factor). A bare custom page misses that var and collapses
  // spans to 0px — invisible + unselectable by mouse — even though the programmatic
  // Selection below still works. This locks that regression.
  const fontSize = await textLayer.locator("span").first().evaluate((el) => getComputedStyle(el).fontSize);
  expect(fontSize, "text-layer spans must be sized (mouse-selectable)").not.toBe("0px");

  // Select all the text in the page's text layer (a real DOM Selection), then fire
  // mouseup so the reader reads the selection and emits a quote draft.
  await textLayer.evaluate((layer) => {
    const sel = window.getSelection();
    sel?.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(layer);
    sel?.addRange(range);
    layer.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });

  // The source chip shows the selected quote text (not "Region selected").
  const chip = page.locator(".chat-source .chat-source-quote");
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("Region figure self-test", { timeout: 10_000 });
});

// PDF ZOOM. Open a PDF, read the rendered page width, click Zoom in and assert the
// page grows (and the % indicator rises), then click Fit width and assert it returns
// to the responsive page-width size. Deterministic against the real running app.
test("pdf zoom: zoom-in grows the page and Fit width returns it", async ({ page, request }) => {
  const source = await seedPdf(request, `Zoom PDF ${Date.now()}`);
  await page.goto("/");
  await page.locator(".source-item-open").filter({ hasText: source.id }).click();

  const pageEl = page.locator('.page[data-page-number="1"]').first();
  await expect(pageEl).toBeVisible({ timeout: 20_000 });

  // The fit-width scale settles first; capture the fitted width + indicator.
  const indicator = page.locator(".pdf-zoom-indicator");
  await expect(indicator).not.toHaveText("—", { timeout: 20_000 });
  const fitWidth = (await pageEl.boundingBox())!.width;
  const fitPct = await indicator.textContent();

  // Zoom in → the page box grows and the indicator percentage rises.
  await page.locator('.pdf-zoom-button[title="Zoom in"]').click();
  await expect.poll(async () => (await pageEl.boundingBox())!.width, { timeout: 20_000 }).toBeGreaterThan(fitWidth + 1);
  expect(await indicator.textContent()).not.toBe(fitPct);

  // Fit width → back to (approximately) the original responsive fit size.
  await page.locator('.pdf-zoom-button[title="Fit width"]').click();
  await expect
    .poll(async () => Math.abs((await pageEl.boundingBox())!.width - fitWidth), { timeout: 20_000 })
    .toBeLessThan(2);
});

test("pdf region: rubber-band a figure → pdf_selection anchor with rect + region box", async ({ page, request }) => {
  const source = await seedPdf(request, `Region PDF ${Date.now()}`);
  await page.goto("/");
  await page.locator(".source-item-open").filter({ hasText: source.id }).click();

  // Wait for the first page to render in the host canvas.
  const pageEl = page.locator('.page[data-page-number="1"]').first();
  await expect(pageEl).toBeVisible({ timeout: 20_000 });

  // Switch to Region mode and rubber-band a rectangle over the page.
  await page.locator(".pdf-reader-toolbar .mode-tab", { hasText: "Region" }).click();
  await dragRegion(page, pageEl, 0.25, 0.6);

  // The source chip reflects a region selection (no text quote).
  await expect(page.locator(".chat-source")).toContainText("Region selected");

  await saveNote(page, "Figure note.");

  // The stored anchor is a pdf_selection carrying a rect.
  const anchors = (await (await request.get(`${SERVER}/api/sources/${source.id}/anchors`)).json()).anchors as Array<{
    anchorKind: string;
    rect?: number[];
    page: number;
  }>;
  const region = anchors.find((a) => a.anchorKind === "pdf_selection" && Array.isArray(a.rect));
  expect(region, "expected a pdf_selection anchor with a rect").toBeTruthy();
  expect(region!.rect).toHaveLength(4);

  // A region box paints on the page.
  await expect(page.locator(".pdf-region-box").first()).toBeVisible();
});

test("image region: rubber-band an area → image_region anchor + region box", async ({ page, request }) => {
  const source = await seedImage(request, `Region IMG ${Date.now()}`);
  await page.goto("/");
  await page.locator(".source-item-open").filter({ hasText: source.id }).click();

  const stage = page.locator(".image-reader-stage");
  await expect(stage.locator("img")).toBeVisible({ timeout: 10_000 });

  await dragRegion(page, stage, 0.2, 0.7);
  await expect(page.locator(".chat-source")).toContainText("Region selected");

  await saveNote(page, "Image area note.");

  const anchors = (await (await request.get(`${SERVER}/api/sources/${source.id}/anchors`)).json()).anchors as Array<{
    anchorKind: string;
    rect?: number[];
  }>;
  const region = anchors.find((a) => a.anchorKind === "image_region");
  expect(region, "expected an image_region anchor").toBeTruthy();
  expect(region!.rect).toHaveLength(4);

  await expect(page.locator(".image-region-box").first()).toBeVisible();
});

test("image source uses the host ImageReader, not the native (unselectable) iframe", async ({ page, request }) => {
  // There is no web seed for code/word sources (they only arrive via desktop file
  // dialogs), so the native `file` iframe path can't be exercised in web mode. What
  // we CAN assert here is the viewer routing invariant that makes region capture
  // possible: an image renders in the overlay-able ImageReader, never the native
  // iframe (which can't be selected or overlaid — see docs/design/selection-architecture.md).
  const res = await request.post(`${SERVER}/api/sources/image`, {
    data: { title: `Native ${Date.now()}`, dataBase64: IMAGE_BASE64 }
  });
  expect(res.ok()).toBeTruthy();
  const source = (await res.json()).source as { id: string };
  await page.goto("/");
  await page.locator(".source-item-open").filter({ hasText: source.id }).click();
  await expect(page.locator(".image-reader-stage")).toBeVisible();
  await expect(page.locator('iframe[title="PDF reader"]')).toHaveCount(0);
});
