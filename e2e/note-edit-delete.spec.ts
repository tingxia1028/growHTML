import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Note EDIT + DELETE end-to-end (web mode). Both flow through the command layer:
//   • Edit  — the saved note's "Edit" affordance opens the SAME registry editor the
//             composer uses (getNoteType(contentType).edit), seeded with the current
//             content; Save dispatches note.edit → PATCH /api/notes/:id {content} →
//             the list refreshes and the change persists across a reload.
//   • Delete — the note's "Delete" affordance dispatches note.delete (confirm gated) →
//             DELETE /api/notes/:id → the note disappears from the list and stays gone.
//
// Modeled on e2e/note-types.spec.ts (SERVER 4177, seed an html source, open it, drive
// the .note-list cards). Markdown notes author through the shared .composer-input.

const SERVER = "http://127.0.0.1:4177";
const READER = 'iframe[title="Source reader"]';

async function seedHtmlSource(request: APIRequestContext, title: string, body: string) {
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content: body } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

async function openSource(page: Page, title: string) {
  await page.goto("/");
  await page.locator(".source-item-open", { hasText: title }).click();
  await expect(page.locator(".reader-tab-title")).toHaveText(title);
}

// Select a passage in the reader iframe → focus it (its quote fills .chat-source), so
// a saved note materializes an ANCHOR on it and paints its highlight (.sv-annotated).
async function selectPassage(page: Page, passage: string) {
  const reader = page.frameLocator(READER);
  await reader.getByText(passage, { exact: false }).click();
  await expect(page.locator(".chat-source")).toContainText(passage);
}

// Write a markdown note through the composer's shared textarea (the existing path).
async function addMarkdownNote(page: Page, text: string) {
  await page.locator(".composer-mode .mode-tab", { hasText: "Note" }).click();
  await page.locator(".composer-input").fill(text);
  await page.getByRole("button", { name: "Save Note" }).click();
}

test("edit a note's content → the change persists across a reload", async ({ page, request }) => {
  const title = `Edit Note ${Date.now()}`;
  await seedHtmlSource(request, title, "<article><p>Body about editing notes.</p></article>");
  await openSource(page, title);

  const original = `Original body ${Date.now()}`;
  const edited = `${original} — EDITED`;
  await addMarkdownNote(page, original);

  const card = page.locator(".note-list .record-card", { hasText: original });
  await expect(card).toBeVisible();

  // Open the registry editor in place (the SAME markdown editor the composer uses).
  await card.locator(".note-edit-start").click();
  const editor = card.locator(".note-edit-inline textarea");
  await expect(editor).toBeVisible();
  await editor.fill(edited);
  await card.locator(".note-edit-save").click();

  // The card now shows the edited content.
  const editedCard = page.locator(".note-list .record-card", { hasText: edited });
  await expect(editedCard).toBeVisible();

  // Reload → the edit persisted server-side (refetched note shows the new content).
  await openSource(page, title);
  await expect(page.locator(".note-list .record-card", { hasText: edited })).toBeVisible();
});

test("delete a note → it disappears from the list and stays gone", async ({ page, request }) => {
  const title = `Delete Note ${Date.now()}`;
  await seedHtmlSource(request, title, "<article><p>Body about deleting notes.</p></article>");
  await openSource(page, title);

  // note.delete asks window.confirm — auto-accept it.
  page.on("dialog", (dialog) => void dialog.accept());

  const text = `Disposable note ${Date.now()}`;
  await addMarkdownNote(page, text);

  const card = page.locator(".note-list .record-card", { hasText: text });
  await expect(card).toBeVisible();

  await card.locator(".note-delete").click();

  // Gone from the list immediately…
  await expect(page.locator(".note-list .record-card", { hasText: text })).toHaveCount(0);

  // …and still gone after a reload (deleted server-side, not just from local state).
  await openSource(page, title);
  await expect(page.locator(".note-list .record-card", { hasText: text })).toHaveCount(0);
});

test("delete an anchored note → its highlight is removed from the reader", async ({ page, request }) => {
  const stamp = Date.now();
  const title = `Delete Highlight ${stamp}`;
  const passage = `Highlighted passage to delete ${stamp}`;
  await seedHtmlSource(request, title, `<article><section><p>${passage}</p></section></article>`);

  // Wide viewport so the secondary panes (note list) stay expanded.
  await page.setViewportSize({ width: 1400, height: 900 });
  await openSource(page, title);

  // note.delete asks window.confirm — auto-accept it.
  page.on("dialog", (dialog) => void dialog.accept());

  // Select the passage → save a note on it. This materializes an exclusive anchor and
  // paints its highlight (.sv-annotated) in the reader iframe.
  const reader = page.frameLocator(READER);
  await selectPassage(page, passage);
  const noteText = `Note on highlighted passage ${stamp}`;
  await addMarkdownNote(page, noteText);

  const card = page.locator(".note-list .record-card", { hasText: noteText });
  await expect(card).toBeVisible();
  // The highlight is painted on the passage.
  await expect(reader.locator(".sv-annotated", { hasText: passage })).toHaveCount(1);

  // Delete the note → server cascade-deletes the now-orphaned anchor → refreshAnnotations
  // re-fetches an anchors list without it → the reader repaints WITHOUT the highlight.
  await card.locator(".note-delete").click();
  await expect(page.locator(".note-list .record-card", { hasText: noteText })).toHaveCount(0);

  // The highlight (.sv-annotated for that passage) is GONE from the reader — not just the
  // list row. This is the regression the orphan-anchor cascade fixes.
  await expect(reader.locator(".sv-annotated", { hasText: passage })).toHaveCount(0);

  // And it stays gone after a reload (deleted server-side).
  await openSource(page, title);
  await expect(page.frameLocator(READER).locator(".sv-annotated", { hasText: passage })).toHaveCount(0);
});
