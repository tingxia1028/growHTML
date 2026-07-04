import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { openNotesTab } from "./helpers";

// Note EDIT + DELETE end-to-end (web mode). Both flow through the command layer:
//   • Edit  — the note row's pencil (.note-edit-start) opens the SAME registry editor the
//             composer used (getNoteType(contentType).edit), seeded with the current
//             content; Save dispatches note.edit → PATCH /api/notes/:id {content} → the
//             list refreshes and the change persists across a reload.
//   • Delete — the row's trash (.note-delete) dispatches note.delete → DELETE
//             /api/notes/:id → the note disappears from the list and stays gone.
//
// Old→new: the Growte IA rebuild removed the right-panel Note-mode COMPOSER and the old
// source-side `.note-list .record-card`. Notes are now SEEDED via the API and surface in
// the right-sidebar NoteListPanel (a collapsed "Notes" fold in the Anchor pane); edit +
// delete live on each `.note-list-row`. So we seed via the API (deterministic) and drive
// the new fold — the manual create-a-note-via-composer flow is a separate pending decision.

import { SERVER } from "./harness";
const READER = 'iframe[title="Source reader"]';

async function seedHtmlSource(request: APIRequestContext, title: string, body: string) {
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content: body } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

// Seed an html_selection anchor on a passage. A placeholder studyId satisfies the API
// (html_selection requires a non-empty studyId + quote); the DomReader paints it via the
// text-quote FALLBACK (decorateAnnotations re-finds the quote when the studyId is absent),
// so the highlight shows on the passage without us knowing the injected study-ids.
async function seedAnchor(request: APIRequestContext, sourceId: string, quote: string) {
  const res = await request.post(`${SERVER}/api/anchors`, {
    data: { sourceId, anchorKind: "html_selection", studyId: `seed-${Date.now()}`, quote, contextBefore: "", contextAfter: "" }
  });
  expect(res.ok(), `seed anchor failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).anchor as { id: string };
}

async function seedNote(request: APIRequestContext, sourceId: string, content: string, anchorIds: string[] = []) {
  const res = await request.post(`${SERVER}/api/notes`, {
    data: { sourceId, anchorIds, contentType: "markdown", content }
  });
  expect(res.ok(), `seed note failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).note as { id: string };
}

async function openSource(page: Page, source: { id: string; title: string }) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await page.locator(".source-item-open").filter({ hasText: source.id }).first().click();
  await expect(page.locator(".reader-tab-title")).toHaveText(source.title);
}

// Activate the right-sidebar Notes tab (the always-open full panel) and return the row
// locator. (The old collapsible `.note-list-head` fold is no longer mounted.)
async function expandNotes(page: Page) {
  await openNotesTab(page);
}
const noteRow = (page: Page, text: string) => page.locator(".note-list-row", { hasText: text });

test("edit a note's content → the change persists across a reload", async ({ page, request }) => {
  const stamp = Date.now();
  const title = `Edit Note ${stamp}`;
  const source = await seedHtmlSource(request, title, "<article><p>Body about editing notes.</p></article>");

  const original = `Original body ${stamp}`;
  const edited = `${original} — EDITED`;
  await seedNote(request, source.id, original);

  await openSource(page, source);
  await expandNotes(page);
  await expect(noteRow(page, original)).toBeVisible();

  // Open the registry editor in place (the SAME markdown editor the composer used).
  await noteRow(page, original).locator(".note-edit-start").click();
  const editor = page.locator(".note-list-row-editing .note-edit-inline textarea");
  await expect(editor).toBeVisible();
  await editor.fill(edited);
  await page.locator(".note-list-row-editing .note-edit-save").click();

  // The row now shows the edited content.
  await expect(noteRow(page, edited)).toBeVisible();

  // Reload → the edit persisted server-side (refetched note shows the new content).
  await openSource(page, source);
  await expandNotes(page);
  await expect(noteRow(page, edited)).toBeVisible();
});

test("delete a note → it disappears from the list and stays gone", async ({ page, request }) => {
  const stamp = Date.now();
  const title = `Delete Note ${stamp}`;
  const source = await seedHtmlSource(request, title, "<article><p>Body about deleting notes.</p></article>");

  const text = `Disposable note ${stamp}`;
  await seedNote(request, source.id, text);

  // note.delete asks window.confirm — auto-accept it.
  page.on("dialog", (dialog) => void dialog.accept());

  await openSource(page, source);
  await expandNotes(page);
  await expect(noteRow(page, text)).toBeVisible();

  await noteRow(page, text).locator(".note-delete").click();

  // Gone from the list immediately…
  await expect(noteRow(page, text)).toHaveCount(0);

  // …and still gone after a reload (deleted server-side, not just from local state).
  await openSource(page, source);
  await expandNotes(page);
  await expect(noteRow(page, text)).toHaveCount(0);
});

test("delete an anchored note → its highlight is removed from the reader", async ({ page, request }) => {
  const stamp = Date.now();
  const title = `Delete Highlight ${stamp}`;
  const passage = `Highlighted passage to delete ${stamp}`;
  const source = await seedHtmlSource(request, title, `<article><section><p>${passage}</p></section></article>`);

  // Seed an anchor on the passage + a note hung off it → the reader paints .sv-annotated.
  const anchor = await seedAnchor(request, source.id, passage);
  const noteText = `Note on highlighted passage ${stamp}`;
  await seedNote(request, source.id, noteText, [anchor.id]);

  await openSource(page, source);

  // note.delete asks window.confirm — auto-accept it.
  page.on("dialog", (dialog) => void dialog.accept());

  const reader = page.frameLocator(READER);
  // The highlight is painted on the passage (text-quote fallback).
  await expect(reader.locator(".sv-annotated", { hasText: passage })).toHaveCount(1);

  await expandNotes(page);
  await expect(noteRow(page, noteText)).toBeVisible();

  // Delete the note → server cascade-deletes the now-orphaned anchor → refreshAnnotations
  // re-fetches an anchors list without it → the reader repaints WITHOUT the highlight.
  await noteRow(page, noteText).locator(".note-delete").click();
  await expect(noteRow(page, noteText)).toHaveCount(0);

  // The highlight (.sv-annotated for that passage) is GONE from the reader — not just the
  // list row. This is the regression the orphan-anchor cascade fixes.
  await expect(reader.locator(".sv-annotated", { hasText: passage })).toHaveCount(0);

  // And it stays gone after a reload (deleted server-side).
  await openSource(page, source);
  await expect(page.frameLocator(READER).locator(".sv-annotated", { hasText: passage })).toHaveCount(0);
});
