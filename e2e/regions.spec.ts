import { expect, test, type APIRequestContext, type Locator } from "@playwright/test";
import { makeTextPdf } from "./fixtures/pdf";
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

test("pdf region: rubber-band a figure → pdf_selection anchor with rect + region box", async ({ page, request }) => {
  const source = await seedPdf(request, `Region PDF ${Date.now()}`);
  await page.goto("/");
  await page.locator(".source-item-open").filter({ hasText: source.id }).click();

  // Wait for PDF.js to render a page in the host canvas.
  const pageEl = page.locator(".pdf-page").first();
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
