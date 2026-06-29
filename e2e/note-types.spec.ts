import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { makeGradientPng } from "./fixtures/image";

// P4 client NoteType plugins — STRUCTURED + MEDIA notes against the REAL running app
// (web mode; these paths are server-backed, no native dialog needed). It drives the
// NEW composer editors:
//
//   • flashcard — front/back form  → saved note renders a flip card (<summary>front</summary>)
//   • quiz      — question/options/answer form → saved note renders the question + marked answer
//   • media     — seed an asset (POST /api/assets/local-file on a temp PNG) + create an
//                 image note (POST /api/notes {contentType:"image", content:{assetId}}),
//                 then assert the note list renders <img src="/api/assets/<id>">
//
// It only adds to the existing study panel's note list/composer with their ORIGINAL
// selectors (.note-list / .composer-mode / .note-type-select / Save Note), so the 10
// existing web e2e keep their selectors. (Media EDIT/pick uses the native file dialog
// → desktop-only; the render path is covered here, the pick path is documented.)

const SERVER = "http://127.0.0.1:4177";

async function seedHtmlSource(request: APIRequestContext, title: string, body: string) {
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content: body } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

// Open a freshly seeded source from the library list and wait for it to be active.
async function openSource(page: Page, title: string) {
  await page.goto("/");
  await page.locator(".source-item-open", { hasText: title }).click();
  await expect(page.locator(".reader-header h2")).toHaveText(title);
}

// Switch the composer into Note mode and pick a content type from the (registry-fed)
// type <select>. The select's option values are the contentType keys.
async function chooseNoteType(page: Page, contentType: string) {
  await page.locator(".composer-mode .mode-tab", { hasText: "Note" }).click();
  // The type picker now shows a "detected · change" chip by default (adaptive note
  // forms Phase 1b). Reveal the override <select> to pick a non-detected type.
  const select = page.locator(".composer-type-picker select.note-type-select");
  if (!(await select.isVisible())) {
    await page.locator(".composer-detected-change").click();
  }
  await select.selectOption(contentType);
}

test("flashcard composer: front/back form → saved note renders a flip card", async ({ page, request }) => {
  const title = `Flashcard ${Date.now()}`;
  await seedHtmlSource(request, title, "<article><p>Body about spaced repetition.</p></article>");
  await openSource(page, title);

  await chooseNoteType(page, "flashcard");
  // The flashcard editor renders front/back fields (NOT the shared text textarea).
  await page.locator(".composer-note-editor .flashcard-front").fill("What is a render thread?");
  await page.locator(".composer-note-editor .flashcard-back").fill("The thread that submits draw commands.");
  await page.getByRole("button", { name: "Save Note" }).click();

  // The saved note appears in the list, typed `flashcard`, rendered as a flip card.
  const card = page.locator(".note-list .record-card", { hasText: "What is a render thread?" });
  await expect(card).toBeVisible();
  await expect(card.locator("strong")).toContainText("flashcard");
  // Flip card = a <details>/<summary> from the sanitized flashcard renderer.
  await expect(card.locator(".sv-flashcard summary")).toHaveText("What is a render thread?");
  await expect(card.locator(".sv-flashcard-back")).toContainText("submits draw commands");
});

test("quiz composer: question/options/answer form → saved note renders the question + marked answer", async ({
  page,
  request
}) => {
  const title = `Quiz ${Date.now()}`;
  await seedHtmlSource(request, title, "<article><p>Body about the event loop.</p></article>");
  await openSource(page, title);

  await chooseNoteType(page, "quiz");
  const editor = page.locator(".composer-note-editor");
  await editor.locator(".quiz-question").fill("Which thread submits draw commands?");
  const options = editor.locator(".quiz-option");
  await options.nth(0).fill("Game thread");
  await options.nth(1).fill("Render thread");
  // Mark option 1 (Render thread) as the answer via its radio.
  await editor.locator(".quiz-option-row").nth(1).locator(".quiz-answer-radio").check();
  await page.getByRole("button", { name: "Save Note" }).click();

  // The saved note renders the question, the options, and marks the chosen answer.
  const card = page.locator(".note-list .record-card", { hasText: "Which thread submits draw commands?" });
  await expect(card).toBeVisible();
  await expect(card.locator("strong")).toContainText("quiz");
  await expect(card.locator(".sv-quiz-question")).toContainText("Which thread submits draw commands?");
  await expect(card.locator(".sv-quiz-option")).toHaveCount(2);
  // The marked answer is the option carrying the answer class with the right text.
  await expect(card.locator(".sv-quiz-answer")).toContainText("Render thread");
});

test("media note render: seed an asset + image note → note list renders <img src=/api/assets/:id>", async ({
  page,
  request
}) => {
  const title = `Image Note ${Date.now()}`;
  const source = await seedHtmlSource(request, title, "<article><p>Body with a figure.</p></article>");

  // Seed an ASSET by importing a real temp PNG off disk (the server runs on this same
  // machine, so it can read the absolute path). This is the same route the desktop
  // file-pick uses; here we drive it directly to cover the RENDER path in web mode.
  const dir = await mkdtemp(path.join(tmpdir(), "sv-e2e-asset-"));
  const pngPath = path.join(dir, "figure.png");
  await writeFile(pngPath, makeGradientPng(120, 90));
  const assetRes = await request.post(`${SERVER}/api/assets/local-file`, { data: { path: pngPath } });
  expect(assetRes.ok(), `import asset failed: ${assetRes.status()}`).toBeTruthy();
  const asset = (await assetRes.json()).asset as { id: string };
  expect(asset.id).toBeTruthy();

  // Create an IMAGE note whose structured content references the asset.
  const noteRes = await request.post(`${SERVER}/api/notes`, {
    data: { sourceId: source.id, contentType: "image", content: { assetId: asset.id, caption: "A seeded figure" } }
  });
  expect(noteRes.ok(), `create image note failed: ${noteRes.status()}`).toBeTruthy();

  // Open the source → its note list renders the image note via the image plugin.
  await openSource(page, title);
  const card = page.locator(".note-list .record-card", { hasText: "image" }).first();
  await expect(card).toBeVisible();
  const img = card.locator(".sv-media-img");
  await expect(img).toHaveAttribute("src", `/api/assets/${asset.id}`);
  await expect(card.locator(".sv-media-caption")).toContainText("A seeded figure");
  // The <img> actually loads the seeded bytes (naturalWidth > 0 = a decoded image).
  await expect.poll(async () => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
});
