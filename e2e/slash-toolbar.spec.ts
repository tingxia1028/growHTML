import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// SC-2 — the `/类型` slash palette mounted on the TOOLBAR surfaces
// (docs/design/slash-composer.md §5 "toolbar surfaces"). Driving the REAL app (web mode,
// deterministic mock provider): a live reader selection floats the selection toolbar; its
// `/` button opens the SHIPPED SC-0 palette (enumerated from the live note-type registry,
// markdown/quiz present, hidden types like bookmark absent); a BARE `/type` pick opens the
// D5 FloatingNoteEditor in MANUAL mode on a NEW anchor at the passage — the same
// createDefault seed + Save loop the chat composer uses, now reachable straight from a
// selection with NO chat and NO typed instruction.
//
// The whole risk this proves handled is SELECTION-BLUR: opening + navigating the palette
// (keydown-driven, mousedown-preventDefault'd) never collapses the reader range, so the
// pick's openManualEditor still materializes the focused passage.

import { SERVER } from "./harness";
const READER = 'iframe[title="Source reader"]';

async function seedHtmlSource(request: APIRequestContext, title: string, body: string) {
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content: body } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

async function openSource(page: Page, source: { id: string; title: string }) {
  await page.goto("/");
  await page.locator(".source-item-open").filter({ hasText: source.title }).first().click();
  await expect(page.locator(".reader-tab-title")).toHaveText(source.title);
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

test("slash toolbar: select reader text → floating toolbar → `/` palette → bare noteType → manual editor on a new anchor", async ({
  page,
  request
}) => {
  const stamp = uid();
  const title = `Slash Toolbar ${stamp}`;
  const passage = `Osmosis moves water across a membrane ${stamp}`;
  const body = `<article><section><p>${passage}</p></section></article>`;
  const source = await seedHtmlSource(request, title, body);

  await page.setViewportSize({ width: 1400, height: 900 });
  await openSource(page, source);

  // —— (1) Select the passage inside the reader iframe + fire mouseup so DomReader
  //         publishes the selection rect → the floating selection toolbar appears ——
  const paragraph = page.frameLocator(READER).locator("p", { hasText: "Osmosis moves water" });
  await expect(paragraph).toBeVisible();
  await paragraph.evaluate((p) => {
    const doc = p.ownerDocument;
    const sel = doc.getSelection();
    sel?.removeAllRanges();
    const range = doc.createRange();
    range.selectNodeContents(p);
    sel?.addRange(range);
    // DomReader listens on the iframe doc's mouseup/selectionchange and publishes the
    // (iframe-offset) rect into the shared store the floating toolbar subscribes to.
    p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    doc.dispatchEvent(new Event("selectionchange"));
  });

  const toolbar = page.locator(".selection-floating-toolbar");
  await expect(toolbar).toBeVisible();

  // —— (2) The `/` button opens the palette; rows enumerate from the live registry ——
  const slashBtn = toolbar.locator(".toolbar-slash-btn");
  await expect(slashBtn).toBeVisible();
  await slashBtn.click();
  const palette = toolbar.locator(".toolbar-slash-popover .slash-palette");
  await expect(palette).toBeVisible();
  await expect(toolbar.locator('.slash-palette-row[data-entry-id="markdown"]')).toHaveCount(1);
  await expect(toolbar.locator('.slash-palette-row[data-entry-id="quiz"]')).toHaveCount(1);
  // Hidden types (bookmark) are never authored from the generic slash entry.
  await expect(toolbar.locator('.slash-palette-row[data-entry-id="bookmark"]')).toHaveCount(0);

  // —— (3) A BARE noteType pick (mousedown, so the selection survives) opens the D5
  //         floating editor in MANUAL mode — seeded via createDefault, no instruction ——
  const notesBefore = (await (await request.get(`${SERVER}/api/notes`)).json()).notes?.length ?? 0;
  const markdownRow = toolbar.locator('.slash-palette-row[data-entry-id="markdown"]');
  // mousedown fires the pick (SlashPalette rows dispatch onMouseDown) WITHOUT collapsing
  // the selection (preventDefault), so openManualEditor materializes the passage anchor.
  await markdownRow.dispatchEvent("mousedown");

  const editor = page.locator(".floating-note-editor");
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAttribute("data-content-type", "markdown");
  await expect(editor).toHaveAttribute("data-manual", "1");

  // —— (4) Save persists a real note on a NEW anchor at the passage (the manual seed
  //         went through the normal note path, never a bespoke render) ——
  await editor.locator(".gen-preview-save").click();
  await expect(editor).toHaveCount(0);
  await expect
    .poll(async () => (await (await request.get(`${SERVER}/api/notes`)).json()).notes?.length ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(notesBefore);

  // The saved note is anchored at the selected passage (the excerpt quote matches).
  await expect(page.locator(".anchor-excerpt-quote")).toContainText("Osmosis moves water");
});
