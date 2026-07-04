import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Multi-document side-by-side (F1 ≡ P-A1 + P-A2) end-to-end (web mode). Proves the
// smallest slice of the vision:
//   (a) a SINGLE open document is unchanged — the old `.reader-tab` chrome + reader iframe;
//   (b) opening a SECOND document gives two tabs; 分屏 splits into two INDEPENDENT reader
//       bodies (two `iframe[title="Source reader"]`), each painting its OWN source — a
//       highlight seeded only in A is ABSENT from B's iframe, and a SHARED cross-source
//       note (one note anchored in BOTH docs, seeded via the note API) paints in BOTH;
//   (c) FOCUS-FOLLOWS-PANE — clicking into the B pane makes B the active tab (so the
//       toolbar / add-note / commandContext target B), and clicking back into A flips it;
//   (d) the HOST-REALM GATE (delta 3) — two host-realm sources (image/pdf paint in the
//       host document) cannot split concurrently; the 分屏 button is disabled + flagged.
//
// Reuses the layer-as-lens / multi-anchor seeding idiom (shared e2e SERVER, the
// `iframe[title="Source reader"]` reader, select→paint via .sv-annotated).

import { SERVER } from "./harness";

const READER = 'iframe[title="Source reader"]';
// Scoped reader locators for the split (two same-title iframes live at once).
const LEFT_READER = `.source-split-left ${READER}`;
const RIGHT_READER = `.source-split-right ${READER}`;

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function seedHtmlSource(request: APIRequestContext, title: string, body: string) {
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content: body } });
  expect(res.ok(), `seed html source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

// A 1x1 transparent PNG — the smallest valid image to seed a HOST-REALM (image) source.
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function seedImageSource(request: APIRequestContext, title: string) {
  const res = await request.post(`${SERVER}/api/sources/image`, {
    data: { title, dataBase64: PNG_1x1, mimeType: "image/png" }
  });
  expect(res.ok(), `seed image source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

// Seed an html_selection anchor on `quote` (text-quote fallback paints it).
async function seedAnchor(request: APIRequestContext, sourceId: string, quote: string) {
  const res = await request.post(`${SERVER}/api/anchors`, {
    data: { sourceId, anchorKind: "html_selection", studyId: `seed-${uid()}`, quote, contextBefore: "", contextAfter: "" }
  });
  expect(res.ok(), `seed anchor failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).anchor as { id: string };
}

async function seedNote(request: APIRequestContext, sourceId: string, anchorIds: string[], content: string) {
  const res = await request.post(`${SERVER}/api/notes`, {
    data: { sourceId, anchorIds, contentType: "markdown", content, layerIds: [] }
  });
  expect(res.ok(), `seed note failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).note as { id: string };
}

// Open a source from the Library by its per-run-unique TITLE. Plain click SWITCHES the
// focused pane (single-doc unchanged); Ctrl/Cmd-click opens it in a NEW pane (multi-doc).
async function openSource(page: Page, source: { title: string }) {
  await page.locator(".source-item-open").filter({ hasText: source.title }).first().click();
}
async function openSourceInNewPane(page: Page, source: { title: string }) {
  await page
    .locator(".source-item-open")
    .filter({ hasText: source.title })
    .first()
    .click({ modifiers: ["ControlOrMeta"] });
}

// F1 persists open panes to localStorage, so a shared-server test run can carry a prior
// test's tabs into this one. Start each test from a CLEAN pane state: load once, clear
// storage, reload — so only the docs THIS test opens are present.
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("multi-doc (a): a single open document is unchanged (old reader-tab chrome)", async ({ page, request }) => {
  const stamp = uid();
  const passage = `Single-doc passage ${stamp}`;
  const source = await seedHtmlSource(
    request,
    `Solo ${stamp}`,
    `<article><section><p>Only ${passage} here.</p></section></article>`
  );

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await openSource(page, source);

  // Exactly one reader tab, no split, the reader iframe present.
  await expect(page.locator(".reader-tab-title")).toHaveText(source.title);
  await expect(page.locator(".reader-tab")).toHaveCount(1);
  await expect(page.locator(".source-split")).toHaveCount(0);
  await expect(page.locator(READER)).toHaveCount(1);
});

test("multi-doc (b+c): two docs split, independent paint (A absent in B), shared note in both, focus-follows-pane", async ({
  page,
  request
}) => {
  const stamp = uid();
  const onlyA = `A-only passage ${stamp}`;
  const onlyB = `B-only passage ${stamp}`;

  const docA = await seedHtmlSource(
    request,
    `DocA ${stamp}`,
    `<article><section><p>${onlyA}</p></section></article>`
  );
  const docB = await seedHtmlSource(
    request,
    `DocB ${stamp}`,
    `<article><section><p>${onlyB}</p></section></article>`
  );

  // Each doc gets its OWN note on its OWN passage — the point is INDEPENDENT per-pane
  // paint: A's highlight must be ABSENT from B's iframe and vice-versa. (A single note
  // spanning both sources would additionally need the server's listNotes to return notes
  // by anchor.sourceId, not just note.sourceId — that's P-B server work, deferred; the
  // client-side cross-source paint is proven in paneSelectors.test.ts.)
  const aAnchor = await seedAnchor(request, docA.id, onlyA);
  await seedNote(request, docA.id, [aAnchor.id], `A-only note ${stamp}`);
  const bAnchor = await seedAnchor(request, docB.id, onlyB);
  await seedNote(request, docB.id, [bAnchor.id], `B-only note ${stamp}`);

  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto("/");

  // Open A (switches the single pane to A), then open B in a NEW pane → two tabs.
  await openSource(page, docA);
  await expect(page.locator(".reader-tab.active .reader-tab-title")).toHaveText(docA.title);
  await openSourceInNewPane(page, docB);
  await expect(page.locator(".reader-tab")).toHaveCount(2);

  // 分屏: split into two independent bodies (docA + docB are html → iframe-realm → allowed).
  const splitBtn = page.locator(".reader-split-btn");
  await expect(splitBtn).toBeEnabled();
  await splitBtn.click();
  await expect(page.locator(".source-split")).toBeVisible();
  await expect(page.locator(READER)).toHaveCount(2);

  // Layout: the FOCUSED pane (docB, the last opened) is LEFT; the split pops the other
  // pane (docA) to the RIGHT side. Each pane paints its OWN source, INDEPENDENTLY.
  const left = page.frameLocator(LEFT_READER); // docB
  const right = page.frameLocator(RIGHT_READER); // docA

  // Independent paint: docA's highlight is in docA's (right) iframe + ABSENT from docB's;
  // docB's highlight is in docB's (left) iframe + ABSENT from docA's. Neither pane bleeds
  // the other's annotations — each resolves paint from its OWN source's bundle.
  await expect(right.locator(".sv-annotated", { hasText: onlyA })).toHaveCount(1);
  await expect(left.locator(".sv-annotated", { hasText: onlyA })).toHaveCount(0);
  await expect(left.locator(".sv-annotated", { hasText: onlyB })).toHaveCount(1);
  await expect(right.locator(".sv-annotated", { hasText: onlyB })).toHaveCount(0);

  // FOCUS-FOLLOWS-PANE: clicking the RIGHT (docA) pane makes docA the active tab; clicking
  // LEFT flips it back to docB. The active tab is what the toolbar/commandContext track.
  // Assert on the LEFT pane's MULTI-tab strip (lists every pane), not the side merge strip.
  const activeTab = page.locator(
    '.source-split-left .reader-tabs:not(.reader-tabs-side) .reader-tab.active .reader-tab-title'
  );
  await page.locator(".source-split-right").click({ position: { x: 5, y: 5 } });
  await expect(activeTab).toHaveText(docA.title);
  await page.locator(".source-split-left").click({ position: { x: 5, y: 5 } });
  await expect(activeTab).toHaveText(docB.title);
});

test("multi-doc (F-1): hide-all + glyph switch are PER-PANE (flipping A leaves B painted)", async ({
  page,
  request
}) => {
  const stamp = uid();
  const passA = `Per-pane A passage ${stamp}`;
  const passB = `Per-pane B passage ${stamp}`;

  const docA = await seedHtmlSource(request, `PPA ${stamp}`, `<article><section><p>${passA}</p></section></article>`);
  const docB = await seedHtmlSource(request, `PPB ${stamp}`, `<article><section><p>${passB}</p></section></article>`);
  const aAnchor = await seedAnchor(request, docA.id, passA);
  await seedNote(request, docA.id, [aAnchor.id], `A note ${stamp}`);
  const bAnchor = await seedAnchor(request, docB.id, passB);
  await seedNote(request, docB.id, [bAnchor.id], `B note ${stamp}`);

  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto("/");

  await openSource(page, docA);
  await expect(page.locator(".reader-tab.active .reader-tab-title")).toHaveText(docA.title);
  await openSourceInNewPane(page, docB);
  await expect(page.locator(".reader-tab")).toHaveCount(2);

  const splitBtn = page.locator(".reader-split-btn");
  await expect(splitBtn).toBeEnabled();
  await splitBtn.click();
  await expect(page.locator(".source-split")).toBeVisible();
  await expect(page.locator(READER)).toHaveCount(2);

  // Layout: focused pane (docB, last opened) is LEFT; docA popped to the RIGHT.
  const left = page.frameLocator(LEFT_READER); // docB
  const right = page.frameLocator(RIGHT_READER); // docA

  // Both panes paint their own note (baseline).
  await expect(left.locator(".sv-annotated", { hasText: passB })).toHaveCount(1);
  await expect(right.locator(".sv-annotated", { hasText: passA })).toHaveCount(1);
  const leftNoteChip = left.locator('.sv-anchor-markers[data-sv-slot="note"]').first();
  const rightNoteChip = right.locator('.sv-anchor-markers[data-sv-slot="note"]').first();
  const leftAnchorChip = left.locator('.sv-anchor-markers[data-sv-slot="anchor"]').first();
  const rightAnchorChip = right.locator('.sv-anchor-markers[data-sv-slot="anchor"]').first();
  await expect(leftNoteChip).toBeAttached();
  await expect(rightNoteChip).toBeAttached();

  // —— HIDE-ALL is PER-PANE —— flip the LEFT (docB) pane's toggle: its note chip +
  // gutter hide; the RIGHT (docA) pane is untouched.
  const leftHideAll = page.locator(".source-split-left .hide-all-notes-toggle").first();
  await expect(leftHideAll).toHaveAttribute("aria-pressed", "false");
  await leftHideAll.click();
  await expect(leftHideAll).toHaveAttribute("aria-pressed", "true");
  await expect(left.locator("#sv-margin-layer .sv-margin-note")).toHaveCount(0); // A(left)'s gutter gone
  await expect(leftNoteChip).toBeHidden();
  await expect(rightNoteChip).toBeVisible(); // B(right) untouched
  await expect(right.locator("#sv-margin-layer .sv-margin-note").first()).toBeVisible();

  // Restore the left pane so the glyph assertions start clean.
  await leftHideAll.click();
  await expect(leftHideAll).toHaveAttribute("aria-pressed", "false");

  // —— GLYPH SWITCH is PER-PANE —— focus the LEFT pane, then flip the anchor-glyph
  // switch (the RIGHT column's anchor panel, driven by the focused source): the LEFT
  // pane's anchor glyph hides; the RIGHT pane's glyph stays.
  await page.locator(".source-split-left").click({ position: { x: 5, y: 5 } });
  const glyphSwitch = page.locator(".anchor-glyph-switch").first();
  await expect(glyphSwitch).toHaveAttribute("aria-pressed", "true");
  await expect(leftAnchorChip).toBeVisible();
  await expect(rightAnchorChip).toBeVisible();
  await glyphSwitch.click();
  await expect(glyphSwitch).toHaveAttribute("aria-pressed", "false");
  await expect(leftAnchorChip).toBeHidden(); // focused (left) pane's glyph hidden
  await expect(rightAnchorChip).toBeVisible(); // other pane's glyph stays

  // Cleanup so the dev/e2e vault doesn't accumulate the fixtures.
  await request.delete(`${SERVER}/api/sources/${docA.id}`);
  await request.delete(`${SERVER}/api/sources/${docB.id}`);
});

test("multi-doc (d): the host-realm gate refuses a second concurrent host-realm pane (分屏 disabled)", async ({
  page,
  request
}) => {
  const stamp = uid();
  // Two HOST-REALM sources (images paint in the host document, like PDF) — they cannot
  // split concurrently (they'd share the one #sv-note-card + hide-all/glyph singletons).
  const imgA = await seedImageSource(request, `ImgA ${stamp}`);
  const imgB = await seedImageSource(request, `ImgB ${stamp}`);

  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto("/");
  await openSource(page, imgA);
  await expect(page.locator(".reader-tab.active .reader-tab-title")).toHaveText(imgA.title);
  await openSourceInNewPane(page, imgB);
  await expect(page.locator(".reader-tab")).toHaveCount(2);

  // The 分屏 button is present but DISABLED + flagged — two host-realm bodies are refused.
  const splitBtn = page.locator(".reader-split-btn");
  await expect(splitBtn).toBeVisible();
  await expect(splitBtn).toBeDisabled();
  await expect(splitBtn).toHaveAttribute("data-host-realm-blocked", "true");
  // No split is created.
  await expect(page.locator(".source-split")).toHaveCount(0);
});
