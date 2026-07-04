import { expect, test, type APIRequestContext } from "@playwright/test";
import { openChatMenu, openNotesTab } from "./helpers";

// Click-driven self-test of the no-AI study loop against the REAL running app,
// matching the current UI (library + reader iframe + study panel). The current UI
// has no paste-HTML import box, so we seed an HTML source via the API, then drive
// the UI: select → source chip → save note → anchored highlight → patch → apply →
// revert → reload → persistence.
//
// Run: npm run e2e   (Playwright boots its own server+client on dedicated e2e ports — e2e/harness.ts.)

import { SERVER } from "./harness";
const READER = 'iframe[title="Source reader"]';

async function seedHtmlSource(request: APIRequestContext, title: string, body: string) {
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content: body } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

// Seed an html_selection anchor on `quote` (placeholder studyId; the reader paints it via
// the text-quote fallback) + a markdown note hung off it. Replaces the removed
// select→composer→Save-Note flow for specs that just need an anchored note to exist.
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

// SKIP: drives the removed right-panel Note-mode composer (select → "Save Note") to
// CREATE a note. The Growte IA rebuild made the composer AI-only; manual note-creation
// UX is a pending product decision. The patch/apply/revert half is still covered by the
// surviving chat ⋯ menu but is gated behind the removed note-create step here.
test.skip("no-AI study loop: select → note → patch → apply → revert → persist", async ({ page, request }) => {
  const title = `E2E Loop ${Date.now()}`;
  const body = [
    "<article>",
    "  <section>",
    "    <h1>E2E Source</h1>",
    "    <p>Original paragraph for the click self-test.</p>",
    "  </section>",
    "</article>"
  ].join("\n");
  const patchedText = "Patched by the click self-test.";

  await seedHtmlSource(request, title, body);

  await page.goto("/");

  // Open the seeded source from the library list.
  await page.locator(".source-item-open", { hasText: title }).first().click();
  await expect(page.locator(".reader-tab-title")).toHaveText(title);

  // Select a passage in the reader iframe → the study panel "source" chip fills in
  // (a draft anchor; the real anchor is created lazily on save).
  const reader = page.frameLocator(READER);
  await reader.getByText("Original paragraph", { exact: false }).click();
  await expect(page.locator(".chat-source")).toContainText("Original paragraph");

  // Save a Note via the composer (switch to Note mode first).
  const noteText = "Self-test note.";
  await page.locator(".mode-tab", { hasText: "Note" }).click();
  await page.locator(".composer-input").fill(noteText);
  await page.getByRole("button", { name: "Save Note" }).click();
  await expect(page.locator(".note-list")).toContainText(noteText);
  await expect(page.locator(".note-list .record-card strong").first()).toContainText("markdown");

  // The note paints as an anchored highlight on the passage (proves anchorIds work).
  const annotated = reader.locator(".sv-annotated").first();
  await expect(annotated).toBeVisible();
  await expect(annotated).toContainText("Original paragraph");

  // Create a Patch (folded under "Edit source (patch)", relocated into the AI Chat ⋯ menu).
  await openChatMenu(page);
  await page.locator(".patch-fold summary").click();
  await page.locator(".patch-input").fill(`<p>${patchedText}</p>`);
  await page.getByRole("button", { name: "Create Patch" }).click();
  await expect(page.locator(".patch-list")).toContainText("pending");

  // Apply → rendered content changes; Revert → original returns.
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(reader.getByText(patchedText)).toBeVisible();
  await page.getByRole("button", { name: "Revert" }).click();
  await expect(reader.getByText("Original paragraph", { exact: false })).toBeVisible();

  // Reload → re-open → note persisted.
  await page.reload();
  await page.locator(".source-item-open", { hasText: title }).first().click();
  await expect(page.locator(".note-list")).toContainText(noteText);
  await expect(reader.locator(".sv-annotated").first()).toBeVisible();
});

// Old→new: the TopBar "Document" tab (annotationMode "floating") was REMOVED (user
// decision 2026-07-04 — the overlay IS the document; annotationMode stays "margin").
// The Floating ↔ Margin toggle is gone, so this now asserts marginalia as the ONE
// reading presentation: the gutter card + connector lay out by default, the Notes
// Overlay tab is idempotent, and the removed Document tab never comes back.
test("marginalia: Notes Overlay (the default, only mode) lays the note card in the gutter", async ({ page, request }) => {
  const title = `E2E Margin ${Date.now()}`;
  const body = "<article><p>A marginalia passage about the render loop and study notes.</p></article>";
  const noteText = "This note lives in the gutter.";

  const source = await seedHtmlSource(request, title, body);
  // Seed an anchored note (the removed composer used to create this) so a highlight +
  // note exist to lay out in the gutter.
  await seedAnchoredNote(request, source.id, "marginalia passage about the render loop and study notes", noteText);

  await page.goto("/");
  await page.locator(".source-item-open", { hasText: title }).first().click();
  await expect(page.locator(".reader-tab-title")).toHaveText(title);

  const reader = page.frameLocator(READER);
  // The seeded note paints as a highlight on the passage.
  await expect(reader.locator(".sv-annotated", { hasText: "marginalia passage" }).first()).toBeVisible();

  // The TopBar segmented control is exactly 笔记叠层 (Notes Overlay) + 锚点聚焦 —
  // the count-of-2 keeps the removed "Document" (floating) tab from resurfacing.
  // zh default locale; TopBar.tsx topBarMessages (module-private): notesOverlay = 笔记叠层.
  await expect(page.locator(".topbar-center .topbar-tab")).toHaveCount(2);
  const overlayTab = page.locator(".topbar-tab", { hasText: "笔记叠层" });
  await expect(overlayTab).toHaveClass(/active/);

  // Margin IS the default: a persistent card with the note text sits in the gutter,
  // a dashed leader connects it to the anchor, and the body reserves right padding.
  const marginCard = reader.locator("#sv-margin-layer .sv-margin-note").first();
  await expect(marginCard).toBeVisible();
  await expect(marginCard).toContainText("This note lives in the gutter");
  await expect(reader.locator("#sv-margin-connectors path")).toHaveCount(1);
  await expect(reader.locator("body.sv-annot-margin")).toHaveCount(1);

  // Re-clicking the tab (it self-heals the mode to "margin") keeps the gutter intact.
  await overlayTab.click();
  await expect(overlayTab).toHaveClass(/active/);
  await expect(marginCard).toBeVisible();
  await expect(reader.locator("body.sv-annot-margin")).toHaveCount(1);
});

test("AI chat: ask about a passage → reply → save reply as a note", async ({ page, request }) => {
  const title = `E2E AI ${Date.now()}`;
  const body = "<article><p>A passage about render threads and study notes.</p></article>";

  await seedHtmlSource(request, title, body);
  await page.goto("/");
  await page.locator(".source-item-open", { hasText: title }).first().click();
  await expect(page.locator(".reader-tab-title")).toHaveText(title);

  // Select a passage → focuses it (shown in the Anchor excerpt) so the mock weaves it in.
  const reader = page.frameLocator(READER);
  await reader.getByText("render threads", { exact: false }).click();
  await expect(page.locator(".anchor-excerpt-quote")).toContainText("render threads");

  // Ask the assistant (deterministic mock provider in dev).
  const chat = page.locator(".chat-box");
  await page.locator(".composer-input").fill("What is this about?");
  await chat.getByRole("button", { name: "Send" }).click();

  const assistant = chat.locator(".chat-assistant").first();
  await expect(assistant).toContainText("What is this about?");
  await expect(assistant).toContainText("render threads");

  // Save the reply as a note via the §10 chat-artifact action "Add as note" (it classifies
  // the reply — this prose is `markdown` — and creates the note directly). Wait for the
  // button to enable (it's disabled while the reply streams), then the note lands in the
  // right-sidebar NoteListPanel.
  const addBtn = chat.locator(".chat-assistant .chat-artifact-add").first();
  await expect(addBtn).toBeEnabled({ timeout: 15_000 });
  await addBtn.click();

  // Activate the right-sidebar Notes tab (the always-open full panel) — the chat composer
  // lives in the bottom split pane, the note list behind the top group's "Notes" tab.
  await openNotesTab(page);
  await expect(page.locator(".note-list-row", { hasText: "render threads" }).first()).toBeVisible({ timeout: 15_000 });
});
