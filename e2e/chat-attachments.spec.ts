import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
// Canonical zh/en dicts (self-updating selectors) for the W1 switcher + W2 attach labels.
import { chatSessionMessages } from "../src/client/chat/chatSessionMessages";
import { SERVER } from "./harness";

// W2 chat attachments (ai-workspace.md §W2): attach a SECOND source to the chat via the
// composer "+" picker, ask a question, and assert the deterministic MOCK reply carries
// the "Attached: N source(s)" marker — the proof the widened ChatContext.sources[]
// reached the prompt. Then verify the chip persists across a session switch. Runs the
// real app in web mode against the offline mock provider.

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

// Start a 新对话 so the chat log + attachment strip begin from a clean, empty state
// (W1 sessions resume on mount, so an earlier spec's transcript could otherwise pre-fill).
async function startFreshConversation(page: Page) {
  await page.getByRole("button", { name: chatSessionMessages.menuLabel.zh, exact: true }).click();
  await page.locator(".panel-menu-popover .chat-session-new").click();
  await expect(page.locator(ASSISTANT)).toHaveCount(0);
}

async function attachSource(page: Page, sourceTitle: string) {
  // Open the composer "+" picker (its aria-label is chatSessionMessages.attachLabel).
  await page.getByRole("button", { name: chatSessionMessages.attachLabel.zh, exact: true }).click();
  const pick = page.locator(".panel-menu-popover .chat-attachment-pick", { hasText: sourceTitle });
  await expect(pick).toBeVisible();
  await pick.click();
}

test("attach a source → the question's reply carries the 'Attached' marker; the chip persists across a switch", async ({
  page,
  request
}) => {
  const stamp = Date.now();
  const readTitle = `W2 Reading ${stamp}`;
  const attachTitle = `W2 Attached ${stamp}`;
  await seedHtmlSource(request, readTitle, "<article><p>The mitochondria is the powerhouse of the cell.</p></article>");
  await seedHtmlSource(request, attachTitle, "<article><p>ATP synthase produces ATP across the membrane.</p></article>");

  await openSource(page, readTitle);
  await startFreshConversation(page);

  // Attach the OTHER source → a removable chip appears in the strip.
  await attachSource(page, attachTitle);
  const chip = page.locator(".chat-attachment-chip", { hasText: attachTitle });
  await expect(chip).toBeVisible();

  // Ask a question — the mock weaves the attachments block. The reply must carry the
  // "Attached: N source(s)" marker (proving the bundle reached the prompt).
  await page.locator(".composer-input").fill("What are these about?");
  await page.locator(".composer-input").press("Enter");
  const assistant = page.locator(ASSISTANT).last();
  await expect(assistant).toContainText("You asked: What are these about?", { timeout: 15_000 });
  await expect(assistant).toContainText("Attached:", { timeout: 15_000 });
  await expect(assistant).toContainText("source(s)");
  // The ATTACHED source's title/excerpt made it into the woven context.
  await expect(assistant).toContainText(attachTitle);

  // The attachment PERSISTS: switch away to a fresh conversation, then resume the
  // session that carries the attachment — the chip is back.
  await page.getByRole("button", { name: chatSessionMessages.menuLabel.zh, exact: true }).click();
  await page.locator(".panel-menu-popover .chat-session-new").click();
  await expect(page.locator(".chat-attachment-chip", { hasText: attachTitle })).toHaveCount(0);

  await page.getByRole("button", { name: chatSessionMessages.menuLabel.zh, exact: true }).click();
  // Resume the just-used session (its title = the asked question, the first user turn).
  await page.locator(".panel-menu-popover .chat-session-open").first().click();
  await expect(page.locator(".chat-attachment-chip", { hasText: attachTitle })).toBeVisible({ timeout: 15_000 });
});
