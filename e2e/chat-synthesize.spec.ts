import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
// Canonical zh/en dicts (self-updating selectors) for the W1 switcher + W2 attach labels.
import { chatSessionMessages } from "../src/client/chat/chatSessionMessages";
import { SERVER } from "./harness";

// W3 doc synthesis (ai-workspace.md §W3): seed a chat session, attach a SECOND source,
// click 生成文档 → the conversation (+ its attachment) is synthesized into a NEW markdown
// source that appears in the library AND opens in a fresh reader pane with a rendered
// heading outline. Runs the real app in web mode against the offline mock provider — the
// mock detects the synthesis prompt marker and returns a deterministic {title, markdown}
// default (no live provider needed), so the created doc's headings are assertable.

const ASSISTANT = ".chat-log .chat-msg.chat-assistant .note-rendered";
const READER = 'iframe[title="Source reader"]';

async function seedHtmlSource(request: APIRequestContext, title: string, body: string) {
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content: body } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

async function listSources(request: APIRequestContext) {
  const res = await request.get(`${SERVER}/api/sources`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).sources as Array<{ id: string; title: string; sourceType: string; origin?: string }>;
}

async function openSource(page: Page, title: string) {
  await page.goto("/");
  await page.locator(".source-item-open", { hasText: title }).first().click();
  await expect(page.locator(".reader-tab-title").first()).toHaveText(title);
}

// Start a 新对话 so the chat log + attachment strip begin from a clean, empty state.
async function startFreshConversation(page: Page) {
  await page.getByRole("button", { name: chatSessionMessages.menuLabel.zh, exact: true }).click();
  await page.locator(".panel-menu-popover .chat-session-new").click();
  await expect(page.locator(ASSISTANT)).toHaveCount(0);
}

async function attachSource(page: Page, sourceTitle: string) {
  await page.getByRole("button", { name: chatSessionMessages.attachLabel.zh, exact: true }).click();
  const pick = page.locator(".panel-menu-popover .chat-attachment-pick", { hasText: sourceTitle });
  await expect(pick).toBeVisible();
  await pick.click();
}

async function ask(page: Page, question: string) {
  await page.locator(".composer-input").fill(question);
  await page.locator(".composer-input").press("Enter");
  await expect(page.locator(ASSISTANT).last()).toContainText(`You asked: ${question}`, { timeout: 15_000 });
}

test("生成文档: a chat transcript (+ attachment) is synthesized into a new markdown source opened in a pane", async ({
  page,
  request
}) => {
  const stamp = Date.now();
  const readTitle = `W3 Reading ${stamp}`;
  const attachTitle = `W3 Attached ${stamp}`;
  await seedHtmlSource(request, readTitle, "<article><p>The mitochondria is the powerhouse of the cell.</p></article>");
  await seedHtmlSource(request, attachTitle, "<article><p>ATP synthase produces ATP across the membrane.</p></article>");

  // Wide viewport so the multi-pane tab strip + right rail stay expanded.
  await page.setViewportSize({ width: 1400, height: 900 });
  await openSource(page, readTitle);
  await startFreshConversation(page);

  // Attach the OTHER source and hold a short conversation → a real transcript exists.
  await attachSource(page, attachTitle);
  await expect(page.locator(".chat-attachment-chip", { hasText: attachTitle })).toBeVisible();
  await ask(page, "How do these two connect?");

  // The 生成文档 button is enabled once there is a transcript.
  const synth = page.getByRole("button", { name: "生成文档", exact: true });
  await expect(synth).toBeEnabled();

  const before = await listSources(request);
  await synth.click();

  // A NEW markdown source lands in the vault (origin authored) — poll the API.
  await expect
    .poll(async () => (await listSources(request)).length, { timeout: 15_000 })
    .toBeGreaterThan(before.length);
  const after = await listSources(request);
  const created = after.find((s) => !before.some((b) => b.id === s.id));
  expect(created, "a new source was created").toBeTruthy();
  expect(created!.sourceType).toBe("markdown");
  expect(created!.origin).toBe("authored");

  // It OPENS in a fresh reader pane — a tab shows its title.
  await expect(page.locator(".reader-tab-title", { hasText: created!.title })).toBeVisible({ timeout: 15_000 });

  // The rendered content carries the heading OUTLINE (# / ## → <h1>/<h2> in the DomReader).
  const reader = page.frameLocator(READER).last();
  await expect(reader.locator("h1, h2").first()).toBeVisible({ timeout: 15_000 });
  await expect(reader.getByText("Synthesized Document", { exact: false }).first()).toBeVisible();
});
