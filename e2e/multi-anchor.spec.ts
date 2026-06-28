import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Multi-anchor note V1 end-to-end (web mode). A note can hang off SEVERAL passages
// (NoteRecord.anchorIds is a list). This is pure UX over data the layer already
// supports (no schema change). This drives the real Stage-1/2 UI:
//
//   • create a note on passage A (the normal select → Save Note flow);
//   • focus a SECOND passage B, then click the note card's "Link to selection"
//     (.note-anchor-link) → dispatches note.link-anchor → materializes B's anchor →
//     appends its id to the note's anchorIds (deduped);
//   • the note then PAINTS at BOTH anchors (each anchor that belongs to a visible note
//     paints its highlight — .sv-annotated) and the card shows the indicator
//     "Anchored at 2 places" (.note-anchor-count) with a per-anchor jump button
//     (.note-anchor-jump) that re-selects each passage (focus.setAnchor).
//
// Modeled on e2e/bookmark.spec.ts (SERVER 4177, READER iframe, select→note flow).

const SERVER = "http://127.0.0.1:4177";
const READER = 'iframe[title="Source reader"]';

async function seedHtmlSource(request: APIRequestContext, title: string, body: string) {
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content: body } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

async function openSource(page: Page, source: { id: string; title: string }) {
  await page.goto("/");
  await page.locator(".source-item-open").filter({ hasText: source.id }).click();
  await expect(page.locator(".reader-header h2")).toHaveText(source.title);
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Select a passage in the reader iframe → focus it (its quote fills .chat-source).
async function selectPassage(page: Page, passage: string) {
  const reader = page.frameLocator(READER);
  await reader.getByText(passage, { exact: false }).click();
  await expect(page.locator(".chat-source")).toContainText(passage);
}

test("multi-anchor V1: note on A → link to B → paints at both → 'Anchored at 2 places' → jumps", async ({
  page,
  request
}) => {
  const stamp = uid();
  const title = `Multi-anchor ${stamp}`;
  const passageA = `First anchor passage ${stamp}`;
  const passageB = `Second anchor passage ${stamp}`;
  const passageC = `Third anchor passage ${stamp}`;
  const noteText = `Note spanning two passages ${stamp}.`;
  const body = `<article><section><p>${passageA}</p><p>${passageB}</p><p>${passageC}</p></section></article>`;
  const source = await seedHtmlSource(request, title, body);

  // Wide viewport so secondary panes stay expanded (mirrors bookmark spec).
  await page.setViewportSize({ width: 1400, height: 900 });
  await openSource(page, source);

  const reader = page.frameLocator(READER);

  // 1) Create a note anchored at passage A.
  await selectPassage(page, passageA);
  await page.locator(".composer-mode .mode-tab", { hasText: "Note" }).click();
  await page.locator(".composer-input").fill(noteText);
  await page.getByRole("button", { name: "Save Note" }).click();
  await expect(page.locator(".note-list")).toContainText(noteText);

  // The note paints at passage A; it's a single-anchor note so the card shows only the
  // "Link to selection" affordance (no count, no jump list yet).
  await expect(reader.locator(".sv-annotated", { hasText: passageA })).toHaveCount(1);
  const card = page.locator(".note-list .record-card", { hasText: noteText });
  await expect(card.locator(".note-anchor-count")).toHaveCount(0);
  await expect(card.locator(".note-anchor-jump")).toHaveCount(0);
  await expect(card.locator(".note-anchor-link")).toBeVisible();

  // 2) Focus passage B, then click the card's "Link to selection" → note.link-anchor
  //    materializes B's anchor and appends it to the note (deduped).
  await selectPassage(page, passageB);
  await expect(card.locator(".note-anchor-link")).toBeEnabled();
  await card.locator(".note-anchor-link").click();

  // 3) The card now shows the multi-anchor indicator + two jump buttons.
  await expect(card.locator(".note-anchor-count")).toContainText("Anchored at 2 places");
  await expect(card.locator(".note-anchor-jump")).toHaveCount(2);

  // The note now paints at BOTH passages (each of its anchors highlights).
  await expect(reader.locator(".sv-annotated", { hasText: passageA })).toHaveCount(1);
  await expect(reader.locator(".sv-annotated", { hasText: passageB })).toHaveCount(1);

  // 4) Link a THIRD passage C the same way → the note now claims three anchors.
  await selectPassage(page, passageC);
  await expect(card.locator(".note-anchor-link")).toBeEnabled();
  await card.locator(".note-anchor-link").click();
  await expect(card.locator(".note-anchor-count")).toContainText("Anchored at 3 places");
  await expect(card.locator(".note-anchor-jump")).toHaveCount(3);

  // The note paints at ALL THREE passages — each additional anchor receives the paint.
  await expect(reader.locator(".sv-annotated", { hasText: passageA })).toHaveCount(1);
  await expect(reader.locator(".sv-annotated", { hasText: passageB })).toHaveCount(1);
  await expect(reader.locator(".sv-annotated", { hasText: passageC })).toHaveCount(1);

  // Server-side: the note carries three anchorIds (the data the painting/indicator derive from).
  const notes = (await (await request.get(`${SERVER}/api/sources/${source.id}/notes`)).json()).notes as Array<{
    contentType: string;
    anchorIds: string[];
  }>;
  const note = notes.find((n) => n.contentType === "markdown");
  expect(note, "the markdown note exists server-side").toBeTruthy();
  expect(note!.anchorIds.length, "the note has three anchors").toBe(3);

  // 5) JUMP: clicking each jump button re-selects (focus.setAnchor) its passage — the
  //    quote reappears in .chat-source. Clear focus between jumps to prove each lands.
  const jumps = card.locator(".note-anchor-jump");

  await page.locator(".chat-source-clear").click();
  await expect(page.locator(".chat-source")).toHaveCount(0);
  await jumps.nth(0).click();
  await expect(page.locator(".chat-source")).toContainText(passageA);

  await page.locator(".chat-source-clear").click();
  await expect(page.locator(".chat-source")).toHaveCount(0);
  await jumps.nth(1).click();
  await expect(page.locator(".chat-source")).toContainText(passageB);

  await page.locator(".chat-source-clear").click();
  await expect(page.locator(".chat-source")).toHaveCount(0);
  await jumps.nth(2).click();
  await expect(page.locator(".chat-source")).toContainText(passageC);

  // Idempotency: re-linking the SAME (currently focused) passage C doesn't add a duplicate.
  await card.locator(".note-anchor-link").click();
  await expect(card.locator(".note-anchor-count")).toContainText("Anchored at 3 places");
  await expect(card.locator(".note-anchor-jump")).toHaveCount(3);
});
