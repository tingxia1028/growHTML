import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
// Canonical zh/en dict for the W1 chat-session switcher (self-updating selectors).
import { chatSessionMessages } from "../src/client/chat/chatSessionMessages";
import { SERVER } from "./harness";
import { openNotesTab, openRailPane } from "./helpers";

// V-2 (vision-input.md §3) — the 拍错题 killer flow, end to end in web mode against the
// offline mock (mock-agent DELEGATES to the vision mock, so it accepts image input and its
// completeStructured echoes the extract prompt's deterministic mockContent). Pick a fixture
// PHOTO via the composer's 拍错题 file input → the server runs the VLM extract → the
// extracted `mistake` draft parks in the generation preview → Save → a `mistake` note
// renders (the `.tb-mistake` selectors from mistakeNoteType). Fully offline/deterministic.

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
}

test("拍照错题 → VLM 抽取 → 预览 → 存错题本 (deterministic mock)", async ({ page, request }) => {
  const title = `Mistake Photo ${Date.now()}`;
  const source = await seedHtmlSource(request, title, "<article><p>错题本练习页。</p></article>");
  await openSource(page, title);
  await startFreshConversation(page);

  // Baseline mistake-note count on this source (the draft persists on the focused source).
  const notesUrl = `${SERVER}/api/sources/${source.id}/notes`;
  const mistakesBefore =
    (await (await request.get(notesUrl)).json()).notes?.filter((n: { contentType?: string }) => n.contentType === "mistake")
      .length ?? 0;

  // 拍错题: pick a fixture photo via the composer's 拍错题 file input → it imports into the
  // vault (POST /api/assets) and dispatches mistake-photo.capture, which runs the VLM extract.
  await page.locator(".chat-capture-mistake input[type=file]").setInputFiles({
    name: "mistake.png",
    mimeType: "image/png",
    buffer: PNG_1x1
  });

  // The extracted `mistake` draft parks in the generation preview (nothing saved yet).
  const preview = page.locator(".generation-preview");
  await expect(preview).toBeVisible({ timeout: 15_000 });
  await expect(preview.locator(".generation-preview-type")).toHaveText("mistake");
  // The preview renders the FULL mistake card (deterministic mockContent from the extract
  // prompt) — the question the mock 抽取ed from the photo.
  await expect(preview.locator(".tb-mistake")).toBeVisible();
  await expect(preview.locator(".tb-mistake-question")).toContainText("1/2 + 1/3");

  // Save → the mistake persists on the source (preview clears).
  await preview.locator(".gen-preview-save").click();
  await expect(preview).toHaveCount(0);

  // A `mistake` note now exists on the source (the anchor-less photo mistake rides the
  // preview-then-Save path, persisted on the focused source).
  await expect
    .poll(
      async () =>
        (await (await request.get(notesUrl)).json()).notes?.filter(
          (n: { contentType?: string }) => n.contentType === "mistake"
        ).length ?? 0,
      { timeout: 15_000 }
    )
    .toBe(mistakesBefore + 1);

  // …and its NoteListPanel card renders through the CORE mistake note type (mode:"card" →
  // the `.tb-mistake-preview` body carrying the extracted question).
  await openNotesTab(page);
  const mistakeCard = page.locator(".note-list-row .tb-mistake-preview").first();
  await expect(mistakeCard).toBeVisible({ timeout: 15_000 });
  await expect(mistakeCard).toContainText("1/2 + 1/3");

  // 错题本 → 复习错题 loop closure: open the 错题本 rail pane (cross-source browse). The saved
  // mistake lists there (the FULL tb-mistake card + its mastery badge) — no schedule row yet.
  await openRailPane(page, "错题本", ".mistake-book");
  const bookItem = page.locator(".mistake-book-item").filter({ hasText: "1/2 + 1/3" }).first();
  await expect(bookItem).toBeVisible({ timeout: 15_000 });
  await expect(bookItem.locator(".tb-mistake")).toBeVisible();
  await expect(bookItem.locator(".tb-badge[data-mastery]")).toBeVisible();

  // 复习错题 launches the EXISTING review runner scoped to mistakes. The saved mistake has no
  // schedule row, so it queues immediately as a NEW mistake (data-reason="mistake-new").
  await page.locator(".mistake-book-launch").click();
  await expect(page.locator(".review-panel")).toBeVisible({ timeout: 15_000 });
  const reviewItem = page.locator(".review-item").first();
  await expect(reviewItem).toBeVisible({ timeout: 15_000 });
  await expect(reviewItem).toHaveAttribute("data-reason", "mistake-new");
  // The review runner renders the mistake through its note type (ArtifactCard card mode →
  // the .tb-mistake-preview body carrying the extracted question).
  await expect(reviewItem.locator(".tb-mistake-preview")).toContainText("1/2 + 1/3");
});
