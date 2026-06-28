import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Bookmark V1 end-to-end (web mode). A bookmark IS a note (contentType "bookmark"),
// created on the focused passage's anchor — the SAME materialize path every note uses —
// but it SURFACES differently: as a jump-target ROW in the dedicated Bookmarks pane (a
// compact color-dot + label chip), NOT as a card in the main note list. This drives the
// real Stage-2 UI:
//
//   • the "Bookmark" selection action (.selection-toolbar-btn[data-action-id="bookmark.add"])
//     — a CORE action (not kit-gated) shown whenever a passage is in focus. It dispatches
//     bookmark.add → materializes the anchor → POST /api/notes {contentType:"bookmark"}.
//   • the Bookmarks pane (.bookmark-panel) — filters the source's visible notes to the
//     bookmark type and renders each as a .bookmark-row carrying the .sv-bookmark-chip /
//     .sv-bookmark-label. Clicking a row calls focus.setAnchor → the passage is re-selected
//     (its quote reappears in .chat-source — the jump/select).
//   • the main note list (.note-list) — bookmarks are FILTERED OUT so they read as markers,
//     not content cards (a co-created markdown note still shows there; the bookmark does not).
//
// Modeled on e2e/layer-as-lens.spec.ts (SERVER 4177, READER iframe, select→note flow).

const SERVER = "http://127.0.0.1:4177";
const READER = 'iframe[title="Source reader"]';

async function seedHtmlSource(request: APIRequestContext, title: string, body: string) {
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content: body } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

// Open a freshly seeded source from the library by its globally-unique id (the row renders
// "sourceType · id"), so accumulated vault state can't make the row ambiguous across repeats.
async function openSource(page: Page, source: { id: string; title: string }) {
  await page.goto("/");
  await page.locator(".source-item-open").filter({ hasText: source.id }).click();
  await expect(page.locator(".reader-header h2")).toHaveText(source.title);
}

// A per-test unique stamp so titles + passages never collide across tests/iterations.
function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Select a passage in the reader iframe → focus it (its quote fills .chat-source). This is
// the same selection gesture the note flow uses; here it arms the selection toolbar.
async function selectPassage(page: Page, passage: string) {
  const reader = page.frameLocator(READER);
  await reader.getByText(passage, { exact: false }).click();
  await expect(page.locator(".chat-source")).toContainText(passage);
}

// Is the painted anchor element for `passage` inside the reader iframe's viewport?
// The REVEAL assertion: clicking a bookmark row must scroll its [data-sv-key]
// highlight (.sv-annotated) on-screen, not just re-focus it.
async function anchorInView(page: Page, passage: string): Promise<boolean> {
  return page
    .frameLocator(READER)
    .locator(".sv-annotated", { hasText: passage })
    .first()
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      const view = el.ownerDocument.defaultView;
      const vh = view ? view.innerHeight : 0;
      return r.bottom > 0 && r.top < vh;
    });
}

// Scroll the reader document to its bottom so a top passage goes off-screen — the
// setup for proving a jump scrolls it BACK into view.
async function scrollReaderToBottom(page: Page) {
  await page
    .frameLocator(READER)
    .locator("body")
    .evaluate((b) => {
      const view = b.ownerDocument.defaultView;
      if (view) view.scrollTo(0, b.scrollHeight);
    });
}

test("bookmark V1: select → Add bookmark → row in Bookmarks pane → jumps → absent from note list", async ({
  page,
  request
}) => {
  const stamp = uid();
  const title = `Bookmark ${stamp}`;
  // The bookmark target lives in its OWN short <p> so the focused quote (→ the seeded
  // bookmark label) is exactly this passage; a SECOND passage gets a normal markdown note
  // so the main note list is non-empty and we can prove the bookmark is absent from it.
  const passage = `Bookmark this key idea ${stamp}`;
  const otherPassage = `A separate plain note passage ${stamp}`;
  const noteText = `Regular note ${stamp}.`;
  const body = `<article><section><p>${passage}</p><p>${otherPassage}</p></section></article>`;
  const source = await seedHtmlSource(request, title, body);

  // Wide viewport so the (secondary) Bookmarks pane stays expanded (it auto-collapses below
  // the 1280 responsive breakpoint).
  await page.setViewportSize({ width: 1400, height: 900 });
  await openSource(page, source);

  // The Bookmarks pane is present and starts empty for this source.
  const panel = page.locator(".bookmark-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("No bookmarks yet.");

  // Focus the passage → the CORE "Bookmark" selection action appears (not kit-gated).
  await selectPassage(page, passage);
  const bookmarkBtn = page.locator('.selection-toolbar-btn[data-action-id="bookmark.add"]');
  await expect(bookmarkBtn).toBeVisible();

  // Add the bookmark → it materializes the anchor + creates a bookmark note.
  await bookmarkBtn.click();

  // It appears as a jump-target ROW in the Bookmarks pane, rendered as the bespoke chip
  // (color dot + label) — the label seeded from the focused passage's quote.
  const row = panel.locator(".bookmark-row");
  await expect(row).toHaveCount(1);
  await expect(row.locator(".sv-bookmark-chip")).toBeVisible();
  await expect(row.locator(".sv-bookmark-label")).toContainText(passage);

  // The bookmark created a server-side anchor on the passage (the same html_selection
  // path every note uses) — its note is typed "bookmark".
  const notes = (await (await request.get(`${SERVER}/api/sources/${source.id}/notes`)).json()).notes as Array<{
    contentType: string;
    content: { label?: string };
  }>;
  const bm = notes.find((n) => n.contentType === "bookmark");
  expect(bm, "a bookmark note was created server-side").toBeTruthy();
  expect(bm!.content.label).toContain("Bookmark this key idea");

  // Co-create a NORMAL markdown note on the OTHER passage so the main note list is
  // non-empty — this lets the "bookmark is absent from the note list" check be meaningful.
  await selectPassage(page, otherPassage);
  await page.locator(".composer-mode .mode-tab", { hasText: "Note" }).click();
  await page.locator(".composer-input").fill(noteText);
  await page.getByRole("button", { name: "Save Note" }).click();
  await expect(page.locator(".note-list")).toContainText(noteText);

  // The bookmark is FILTERED OUT of the main note-card list (it reads as a marker, not a
  // card): no record card is typed "bookmark", and the label doesn't show among the cards.
  await expect(page.locator(".note-list .record-card strong", { hasText: "bookmark" })).toHaveCount(0);
  await expect(page.locator(".note-list .record-card", { hasText: passage })).toHaveCount(0);

  // JUMP: clear the current focus, then click the bookmark row → focus.setAnchor re-selects
  // the bookmarked passage (its quote reappears in .chat-source).
  await page.locator(".chat-source-clear").click();
  await expect(page.locator(".chat-source")).toHaveCount(0);
  await row.click();
  await expect(page.locator(".chat-source")).toContainText(passage);
});

// REVEAL: a bookmark row click must SCROLL the reader to the passage, not just set
// focus state (the reported "no jump" bug). With a tall spacer below the bookmarked
// passage, scrolling the reader away and clicking the row must bring it back on-screen.
test("bookmark reveal: clicking a row scrolls the off-screen passage back into the reader", async ({
  page,
  request
}) => {
  const stamp = uid();
  const title = `Bookmark reveal ${stamp}`;
  const passage = `Reveal bookmark passage ${stamp}`;
  // A tall spacer below the passage so scrolling the reader to the bottom pushes the
  // bookmarked passage off-screen — the precondition for proving the jump scrolls back.
  const body = `<article><section><p>${passage}</p><div style="height:2400px"></div><p>End of document ${stamp}</p></section></article>`;
  const source = await seedHtmlSource(request, title, body);

  await page.setViewportSize({ width: 1400, height: 900 });
  await openSource(page, source);

  // Bookmark the passage (select → core Bookmark action) → a row in the Bookmarks pane.
  await selectPassage(page, passage);
  await page.locator('.selection-toolbar-btn[data-action-id="bookmark.add"]').click();
  const row = page.locator(".bookmark-panel .bookmark-row");
  await expect(row).toHaveCount(1);

  // The bookmarked anchor paints (carries data-sv-key) so reveal has a target.
  await expect(page.frameLocator(READER).locator(".sv-annotated", { hasText: passage })).toHaveCount(1);

  // Scroll the reader to the bottom → the bookmarked passage is off-screen.
  await scrollReaderToBottom(page);
  await expect.poll(() => anchorInView(page, passage)).toBe(false);

  // Click the row → it re-focuses (quote in .chat-source) AND scrolls back into view.
  await page.locator(".chat-source-clear").click();
  await expect(page.locator(".chat-source")).toHaveCount(0);
  await row.click();
  await expect(page.locator(".chat-source")).toContainText(passage);
  await expect.poll(() => anchorInView(page, passage)).toBe(true);

  // RE-TRIGGER: scroll away and re-click the SAME row — revealSeq must re-fire the scroll.
  await scrollReaderToBottom(page);
  await expect.poll(() => anchorInView(page, passage)).toBe(false);
  await row.click();
  await expect.poll(() => anchorInView(page, passage)).toBe(true);
});
