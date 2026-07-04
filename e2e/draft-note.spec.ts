import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { openNotesTab } from "./helpers";
// Canonical zh/en dict for the W1 chat-session switcher (self-updating selectors).
import { chatSessionMessages } from "../src/client/chat/chatSessionMessages";

// D6 (note-presentation-unified.md §6) — AI answer WITH anchor context AUTO-MATERIALIZES
// as a status:"draft" note (the chip appears at the passage WITHOUT a Save click) + an
// UNDO toast whose 撤销 dispatches note.delete. Free chat (no anchor) stays chat-only.
//
// Drives the real app in web mode (deterministic mock provider): select a passage so the
// reply carries anchor context, ask a question, then keep the reply via the chat card's
// "Add as note" — which, per D6, materializes a DRAFT note. We assert (1) the undo toast,
// (2) the draft note card carries the draft marker (.sv-note-draft, a WRAPPER flag — the
// body still renders through getNoteType().render), and (3) 撤销 removes it.

import { SERVER } from "./harness";
const READER = 'iframe[title="Source reader"]';
const ASSISTANT = ".chat-log .chat-msg.chat-assistant .note-rendered";

async function seedHtmlSource(request: APIRequestContext, title: string, body: string) {
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content: body } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

async function openSource(page: Page, title: string) {
  await page.goto("/");
  await page.locator(".source-item-open", { hasText: title }).first().click();
  await expect(page.locator(".reader-tab-title")).toHaveText(title);
}

// W1 chat sessions resume on mount, so a prior spec's transcript can pre-fill the log.
// Start a 新对话 so bubble counts begin at zero (same idiom as streaming-chat.spec.ts).
async function startFreshConversation(page: Page) {
  await page.getByRole("button", { name: chatSessionMessages.menuLabel.zh, exact: true }).click();
  await page.locator(".panel-menu-popover .chat-session-new").click();
  await expect(page.locator(ASSISTANT)).toHaveCount(0);
}

// Ask `question`, select `needle` within the reply, and fire "Add as note" in ONE
// synchronous step so the window selection is intact when the handler reads it.
async function askAndKeepReply(page: Page, question: string) {
  await page.locator(".composer-input").fill(question);
  await page.locator(".composer-input").press("Enter");
  const assistant = page.locator(ASSISTANT).last();
  await expect(assistant).toContainText(`You asked: ${question}`, { timeout: 15_000 });
  const addBtn = page.locator(".chat-msg.chat-assistant .chat-artifact-add").last();
  await expect(addBtn).toBeEnabled({ timeout: 15_000 });
  await page.evaluate(() => {
    const msgs = document.querySelectorAll(".chat-log .chat-msg.chat-assistant");
    const msg = msgs[msgs.length - 1];
    const btn = msg?.querySelector(".chat-artifact-add") as HTMLButtonElement | null;
    if (!btn) throw new Error("Add as note button not found");
    btn.click();
  });
}

test("D6: anchor-context AI answer auto-materializes a DRAFT note + undo removes it", async ({ page, request }) => {
  const title = `Draft Note ${Date.now()}`;
  const passage = "Osmosis is the diffusion of water across a membrane.";
  const body = `<article><section><p>${passage}</p></section></article>`;
  const source = await seedHtmlSource(request, title, body);
  await openSource(page, title);

  // Focus the passage → the reply has anchor context (the Anchor pane shows the quote).
  const reader = page.frameLocator(READER);
  await reader.getByText("Osmosis", { exact: false }).click();
  await expect(page.locator(".anchor-excerpt-quote")).toContainText("Osmosis");

  await startFreshConversation(page);

  // Baseline note count for THIS source (draft notes are real notes in the vault).
  const notesUrl = `${SERVER}/api/sources/${source.id}/notes`;
  const before = (await (await request.get(notesUrl)).json()).notes?.length ?? 0;

  // Keep the reply → WITH anchor context D6 auto-materializes a status:"draft" note.
  await askAndKeepReply(page, "What is osmosis?");

  // (1) The UNDO toast appears (no Save click was made).
  const toast = page.locator(".draft-note-toast");
  await expect(toast).toBeVisible({ timeout: 15_000 });
  await expect(toast.locator(".draft-note-undo")).toBeVisible();

  // (2) A DRAFT note now exists on the source (the chip/card materialized without Save).
  await expect
    .poll(async () => (await (await request.get(notesUrl)).json()).notes?.filter((n: { status?: string }) => n.status === "draft").length ?? 0, {
      timeout: 15_000
    })
    .toBe(1);

  // …and its NoteListPanel card carries the draft marker (a wrapper flag; the body still
  // renders through getNoteType().render — .sv-note-content is present, no bespoke path).
  await openNotesTab(page);
  const draftRow = page.locator('.note-list-row .sv-artifact-card.sv-note-draft').first();
  await expect(draftRow).toBeVisible({ timeout: 15_000 });
  await expect(draftRow).toHaveAttribute("data-note-status", "draft");

  // (3) 撤销 dispatches note.delete → the draft note is removed (paint is note-derived,
  // so the chip disappears on the repaint) and the toast clears.
  await toast.locator(".draft-note-undo").click();
  await expect(toast).toHaveCount(0);
  await expect
    .poll(async () => (await (await request.get(notesUrl)).json()).notes?.filter((n: { status?: string }) => n.status === "draft").length ?? 0, {
      timeout: 15_000
    })
    .toBe(0);
  // Net note count returned to baseline (the auto-created draft was the only add).
  await expect
    .poll(async () => (await (await request.get(notesUrl)).json()).notes?.length ?? 0, { timeout: 15_000 })
    .toBe(before);
});
