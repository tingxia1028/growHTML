import { expect, test, type APIRequestContext, type Locator } from "@playwright/test";
import { makeTextPdf, makeMultiPageTextPdf } from "./fixtures/pdf";
import { makeGradientPng } from "./fixtures/image";

// Region (geometric) anchoring against the REAL running app, web mode. Covers the
// two region-capable surfaces that render in the HOST page (so Playwright can drive
// them): PDF (PDF.js) and image (ImageReader). N2 D4a made region selection MODELESS
// (the Text|Region mode-tab is gone): Alt+drag (or a drag off the text layer) marks a
// region; a text selection can also be CONVERTED via 转为区域. Each region is then saved
// through the CURRENT save UX — a manual `/type` draft in the D5 floating editor
// (`.floating-note-editor` → "Save this draft as a note") which materializes the focused
// region draft — so the stored anchor carries a 4-tuple rect and a region box paints. D3a
// per-layer paint is covered by setting a layer's paint color and asserting the painted
// element re-tints (--sv-anchor-color).

import { SERVER } from "./harness";

// A 200x150 gradient PNG — large enough to render at a draggable size.
const IMAGE_BASE64 = makeGradientPng(200, 150).toString("base64");

async function seedPdf(request: APIRequestContext, title: string) {
  const data = makeTextPdf("Region figure self-test page content.").toString("base64");
  const res = await request.post(`${SERVER}/api/sources/pdf`, { data: { title, dataBase64: data } });
  expect(res.ok(), `seed pdf failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

async function seedImage(request: APIRequestContext, title: string) {
  const res = await request.post(`${SERVER}/api/sources/image`, {
    data: { title, dataBase64: IMAGE_BASE64, mimeType: "image/png" }
  });
  expect(res.ok(), `seed image failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

// Open a seeded source from the Library by its (per-run unique) TITLE — the LIB row's
// visible text is the title only; the source id rides the row's tooltip, so an id-based
// hasText filter no longer matches anything.
async function openSourceRow(page: import("@playwright/test").Page, title: string) {
  await page.locator(".source-item-open").filter({ hasText: title }).first().click();
}

// Drag a rubber-band rectangle inside `target` from a relative start to end point,
// optionally holding Alt (the D4a explicit region trigger).
async function dragRegion(
  page: import("@playwright/test").Page,
  target: Locator,
  fromFrac: number,
  toFrac: number,
  opts: { alt?: boolean } = {}
) {
  const box = await target.boundingBox();
  if (!box) throw new Error("target has no bounding box");
  const start = { x: box.x + box.width * fromFrac, y: box.y + box.height * fromFrac };
  const end = { x: box.x + box.width * toFrac, y: box.y + box.height * toFrac };
  if (opts.alt) await page.keyboard.down("Alt");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2);
  await page.mouse.move(end.x, end.y);
  await page.mouse.up();
  if (opts.alt) await page.keyboard.up("Alt");
}

// The CURRENT save UX (the composer/"Save Note" path is gone): open the D5 floating
// editor via a bare `/type` slash pick in the AI-Chat composer, then Save. A manual draft
// omits explicit anchorIds, so anchor.add-note materializes the FOCUSED passage — here the
// region draft the gesture just parked — into a stored anchor.
async function saveRegionAsNote(page: import("@playwright/test").Page) {
  const composer = page.locator(".chat-composer-input");
  await expect(composer).toBeVisible();
  await composer.fill("/markdown");
  await expect(page.locator('.chat-slash-palette .slash-palette-row[data-entry-id="markdown"]')).toBeVisible();
  await composer.press("Enter");
  const editor = page.locator(".floating-note-editor");
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAttribute("data-manual", "1");
  await editor.locator(".gen-preview-save").click();
  await expect(editor).toHaveCount(0);
}

type RegionAnchor = { id: string; anchorKind: string; rect?: number[]; page?: number };

async function anchorsFor(request: APIRequestContext, sourceId: string): Promise<RegionAnchor[]> {
  return (await (await request.get(`${SERVER}/api/sources/${sourceId}/anchors`)).json()).anchors as RegionAnchor[];
}

// Wait for the stored region anchor. Save clears the floating editor SYNCHRONOUSLY (before
// the async anchor.add-note materializes the region draft + creates the note), so the
// anchor lands a beat later. Poll the API (the durable proof) with generous settle steps —
// a fresh GET each iteration, yielding through page.waitForTimeout between reads so the
// async note→anchor commit + the app's repaint have time to land.
async function waitForRegionAnchor(
  page: import("@playwright/test").Page,
  request: APIRequestContext,
  sourceId: string,
  kind: "pdf_selection" | "image_region"
): Promise<RegionAnchor> {
  const deadline = Date.now() + 15_000;
  let seen: string[] = [];
  for (;;) {
    await page.waitForTimeout(400);
    const res = await request.get(`${SERVER}/api/sources/${sourceId}/anchors`);
    const anchors = ((await res.json()).anchors ?? []) as RegionAnchor[];
    seen = anchors.map((a) => a.anchorKind);
    const found = anchors.find((a) => a.anchorKind === kind && Array.isArray(a.rect) && a.rect.length === 4);
    if (found) return found;
    if (Date.now() > deadline)
      throw new Error(`no ${kind} region anchor with a rect appeared for ${sourceId}; saw: ${JSON.stringify(seen)}`);
  }
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
  const title = `Scroll PDF ${Date.now()}`;
  const res = await request.post(`${SERVER}/api/sources/pdf`, {
    data: { title, dataBase64: data }
  });
  expect(res.ok(), `seed pdf failed: ${res.status()}`).toBeTruthy();

  await page.goto("/");
  await openSourceRow(page, title);

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

// PDF ZOOM. Open a PDF, read the rendered page width, click Zoom in and assert the
// page grows (and the % indicator rises), then click Fit width and assert it returns
// to the responsive page-width size. Deterministic against the real running app.
test("pdf zoom: zoom-in grows the page and Fit width returns it", async ({ page, request }) => {
  const source = await seedPdf(request, `Zoom PDF ${Date.now()}`);
  await page.goto("/");
  await openSourceRow(page, source.title);

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

// D4a — MODELESS PDF region: Alt+drag a rectangle over the page (no mode tab), save the
// resulting region draft via a manual `/markdown` floating-editor Save, then assert the
// stored anchor is a pdf_selection carrying a 4-tuple rect and a region box paints.
test("pdf region (D4a): Alt+drag → pdf_selection anchor with rect + region box", async ({ page, request }) => {
  const source = await seedPdf(request, `Region PDF ${Date.now()}`);
  await page.goto("/");
  await openSourceRow(page, source.title);

  // Wait for the first page to render in the host canvas. No mode tab exists anymore.
  const pageEl = page.locator('.page[data-page-number="1"]').first();
  await expect(pageEl).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".pdf-reader-toolbar .mode-tab")).toHaveCount(0);

  // Alt+drag marks a region (the explicit trigger), no mode switch needed.
  await dragRegion(page, pageEl, 0.25, 0.6, { alt: true });

  // Save the region draft through the current UX (manual /type floating editor).
  await saveRegionAsNote(page);

  // The stored anchor is a pdf_selection carrying a 4-tuple rect on page 1.
  const region = await waitForRegionAnchor(page, request, source.id, "pdf_selection");
  expect(region.rect).toHaveLength(4);
  expect(region.page).toBe(1);

  // A region box paints on the page.
  await expect(page.locator(".pdf-region-box").first()).toBeVisible();
});

// D4a — 转为区域: select PDF text (the modeless quote path), then convert the selection to
// a region via the floating toolbar's 转为区域 action, and save it — the stored anchor is a
// pdf_selection with a rect (not a plain text quote).
test("pdf 转为区域 (D4a): text selection → Convert to Region → rect anchor", async ({ page, request }) => {
  const source = await seedPdf(request, `Convert PDF ${Date.now()}`);
  await page.goto("/");
  await openSourceRow(page, source.title);

  const textLayer = page.locator('.page[data-page-number="1"] .textLayer');
  await expect(textLayer).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => textLayer.locator("span").count(), { timeout: 20_000 }).toBeGreaterThan(0);

  // Select the page's text (a real DOM Selection) + fire mouseup so the reader emits a
  // pdf quote draft; selectionchange floats the selection toolbar.
  await textLayer.evaluate((layer) => {
    const sel = window.getSelection();
    sel?.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(layer);
    sel?.addRange(range);
    layer.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    document.dispatchEvent(new Event("selectionchange"));
  });

  // The floating toolbar offers 转为区域 (append-only selection action). Click it.
  const convert = page.locator('.selection-floating-toolbar [data-action-id="region.convert-selection"]');
  await expect(convert).toBeVisible({ timeout: 10_000 });
  await convert.click();

  // The selection is now a region draft — save it through the manual /type editor.
  await saveRegionAsNote(page);

  const region = await waitForRegionAnchor(page, request, source.id, "pdf_selection");
  expect(region.rect).toHaveLength(4);
  await expect(page.locator(".pdf-region-box").first()).toBeVisible();
});

// D4a — image region (already modeless): drag an area over the image, save it via the
// manual floating editor, and assert the stored image_region anchor + a region box.
test("image region (D4a): drag an area → image_region anchor + region box", async ({ page, request }) => {
  const source = await seedImage(request, `Region IMG ${Date.now()}`);
  await page.goto("/");
  await openSourceRow(page, source.title);

  const stage = page.locator(".image-reader-stage");
  await expect(stage.locator("img")).toBeVisible({ timeout: 10_000 });

  await dragRegion(page, stage, 0.2, 0.7);
  await saveRegionAsNote(page);

  const region = await waitForRegionAnchor(page, request, source.id, "image_region");
  expect(region.rect).toHaveLength(4);

  await expect(page.locator(".image-region-box").first()).toBeVisible();
});

// D3a — per-layer paint color: a region note's layer paint color re-tints the painted
// region box (--sv-anchor-color). The Lens management surface writes the SAME
// patchLayer({style}) this drives via API, so setting the owned layer's paint color and
// reloading proves the resolution (schema round-trip → resolveAnchorPaintStyle → the
// reader's applyPaintStyle) end-to-end.
test("region paint (D3a): a layer paint color re-tints the region box", async ({ page, request }) => {
  const source = await seedImage(request, `Paint IMG ${Date.now()}`);

  // Seed a region anchor + a note on it (defaults to the source's owned layer).
  const aRes = await request.post(`${SERVER}/api/anchors`, {
    data: { sourceId: source.id, anchorKind: "image_region", rect: [0.2, 0.2, 0.4, 0.4], quote: "" }
  });
  expect(aRes.ok(), `seed anchor failed: ${aRes.status()}`).toBeTruthy();
  const anchor = (await aRes.json()).anchor as { id: string };
  const nRes = await request.post(`${SERVER}/api/notes`, {
    data: { sourceId: source.id, anchorIds: [anchor.id], contentType: "markdown", content: "region note" }
  });
  expect(nRes.ok(), `seed note failed: ${nRes.status()}`).toBeTruthy();

  // Find the source's owned layer and give it a distinctive paint color.
  const layers = (await (await request.get(`${SERVER}/api/sources/${source.id}/layers`)).json()).layers as Array<{
    id: string;
    importMode: string;
    role?: string;
  }>;
  const owned = layers.find((l) => l.importMode === "owned" && l.role === undefined);
  expect(owned, "expected an owned layer").toBeTruthy();
  const PAINT = "#e91e63";
  const patch = await request.patch(`${SERVER}/api/layers/${owned!.id}`, {
    data: { style: { color: PAINT, decoration: "both" } }
  });
  expect(patch.ok(), `patch layer style failed: ${patch.status()}`).toBeTruthy();

  await page.goto("/");
  await openSourceRow(page, source.title);

  // The painted region box carries the layer's paint color as --sv-anchor-color.
  const box = page.locator(".image-region-box").first();
  await expect(box).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(async () => box.evaluate((el) => (el as HTMLElement).style.getPropertyValue("--sv-anchor-color")), {
      timeout: 10_000
    })
    .toBe(PAINT);
});

test("image source uses the host ImageReader, not the native (unselectable) iframe", async ({ page, request }) => {
  // There is no web seed for code/word sources (they only arrive via desktop file
  // dialogs), so the native `file` iframe path can't be exercised in web mode. What
  // we CAN assert here is the viewer routing invariant that makes region capture
  // possible: an image renders in the overlay-able ImageReader, never the native
  // iframe (which can't be selected or overlaid — see docs/design/selection-architecture.md).
  const title = `Native ${Date.now()}`;
  const res = await request.post(`${SERVER}/api/sources/image`, {
    data: { title, dataBase64: IMAGE_BASE64 }
  });
  expect(res.ok()).toBeTruthy();
  await page.goto("/");
  await openSourceRow(page, title);
  await expect(page.locator(".image-reader-stage")).toBeVisible();
  await expect(page.locator('iframe[title="PDF reader"]')).toHaveCount(0);
});
