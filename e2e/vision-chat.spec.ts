import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
// Canonical zh/en dict for the W1 chat-session switcher (self-updating selectors).
import { chatSessionMessages } from "../src/client/chat/chatSessionMessages";
import { SERVER } from "./harness";

// V-1 (vision-input.md §2, A5) — the vision/multimodal content-parts seam, end to end in
// web mode against the offline mock (pinned mock-agent DELEGATES to the vision mock, so it
// accepts image input and echoes the deterministic "Saw N image(s)." marker). Attach a
// fixture PNG via the composer's 附加图片 file input → send → the reply carries "Saw 1
// image." AND a thumbnail (<img src="/api/assets/:id">) renders in the user bubble.

const ASSISTANT = ".chat-log .chat-msg.chat-assistant .note-rendered";

// A minimal valid 1x1 PNG (transparent) — enough for the asset store + <img> to accept.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

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

// Start a 新对话 so the chat log begins empty (W1 sessions resume on mount).
async function startFreshConversation(page: Page) {
  await page.getByRole("button", { name: chatSessionMessages.menuLabel.zh, exact: true }).click();
  await page.locator(".panel-menu-popover .chat-session-new").click();
  await expect(page.locator(ASSISTANT)).toHaveCount(0);
}

test("attach an image → the reply carries 'Saw 1 image.' and a thumbnail renders", async ({ page, request }) => {
  const title = `Vision Chat ${Date.now()}`;
  await seedHtmlSource(request, title, "<article><p>A study passage for the vision test.</p></article>");
  await openSource(page, title);
  await startFreshConversation(page);

  // Pick a fixture image via the composer's 附加图片 file input → it imports into the
  // vault (POST /api/assets) and a pending-image chip appears.
  await page.locator(".chat-attach-image input[type=file]").setInputFiles({
    name: "diagram.png",
    mimeType: "image/png",
    buffer: PNG_1x1
  });
  const pendingChip = page.locator(".chat-image-pending-chip");
  await expect(pendingChip).toHaveCount(1, { timeout: 15_000 });
  await expect(pendingChip.locator("img")).toHaveAttribute("src", /\/api\/assets\/asset_/);

  // Ask a question alongside the image → the user turn is an ARRAY [image, text]. The
  // mock (vision) echoes the deterministic ack.
  await page.locator(".composer-input").fill("what is this?");
  await page.locator(".composer-input").press("Enter");

  const assistant = page.locator(ASSISTANT).last();
  await expect(assistant).toContainText("Saw 1 image.", { timeout: 15_000 });
  // messageText collapses the array to text with an [image] placeholder for the image
  // part, so the echoed question reads "[image] what is this?".
  await expect(assistant).toContainText("You asked: [image] what is this?");

  // The user bubble shows the image THUMBNAIL (the byte route), never crashing the log.
  const thumb = page.locator(".chat-log .chat-msg.chat-user img.chat-msg-image").last();
  await expect(thumb).toBeVisible({ timeout: 15_000 });
  await expect(thumb).toHaveAttribute("src", /\/api\/assets\/asset_/);

  // The pending strip cleared after send (the image folded into the message).
  await expect(page.locator(".chat-image-pending-chip")).toHaveCount(0);
});
