import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// SC-1 — the inline `/类型` slash composer wired into the AI-Chat composer
// (docs/design/slash-composer.md §5 "SC-1 — chat wiring"). Driving the REAL app
// (web mode, deterministic mock provider):
//   • Typing "/" in the chat composer drops the SC-0 palette ABOVE the input,
//     enumerated from the LIVE note-type registry (markdown/quiz present; hidden
//     types like bookmark never appear).
//   • A BARE `/quiz` pick (Enter) opens the D5 FloatingNoteEditor in MANUAL mode
//     (createDefault seed) — the same editor + Save loop, no bespoke render path.
//   • `/<type> + instruction` dispatches the FORM-ROUTER generation
//     (note.generate-block); its draft parks in the SAME floating editor and Save
//     persists it as a real note (rendered via getNoteType().render — §0.5 no bypass).
// This is the affordance the "Type / for commands" placeholder promised since R-era.

import { SERVER } from "./harness";

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

test("slash composer: `/` opens the registry palette, bare `/quiz` → manual editor, `/type + instruction` → generate → preview → save", async ({
  page,
  request
}) => {
  const title = `Slash Composer ${Date.now()}`;
  await seedHtmlSource(request, title, "<article><section><p>Osmosis moves water across a membrane.</p></section></article>");
  await openSource(page, title);

  const composer = page.locator(".chat-composer-input");
  await expect(composer).toBeVisible();
  const palette = page.locator(".chat-slash-palette .slash-palette");

  // —— (1) "/" drops the palette ABOVE the input, enumerated from the registry ——
  await expect(palette).toHaveCount(0); // no palette for plain chat
  await composer.fill("/");
  await expect(palette).toBeVisible();
  await expect(page.locator('.chat-slash-palette .slash-palette-row[data-entry-id="markdown"]')).toHaveCount(1);
  await expect(page.locator('.chat-slash-palette .slash-palette-row[data-entry-id="quiz"]')).toHaveCount(1);
  // Hidden types (bookmark) are never authored from the generic slash entry.
  await expect(page.locator('.chat-slash-palette .slash-palette-row[data-entry-id="bookmark"]')).toHaveCount(0);

  // —— (2) bare `/quiz` + Enter → the D5 floating editor in MANUAL mode ——
  await composer.fill("/quiz");
  await expect(page.locator('.chat-slash-palette .slash-palette-row[data-entry-id="quiz"]')).toBeVisible();
  await composer.press("Enter"); // Enter belongs to the palette while it is open
  const editor = page.locator(".floating-note-editor");
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAttribute("data-content-type", "quiz");
  await expect(editor).toHaveAttribute("data-manual", "1");
  // The input was consumed by the pick — the chat was NOT submitted.
  await expect(composer).toHaveValue("");
  // Discard the manual draft (no note saved) and confirm the editor closes.
  await editor.locator(".gen-preview-discard").click();
  await expect(editor).toHaveCount(0);

  // —— (3) `/markdown + instruction` → form-router generation → preview → SAVE ——
  await composer.fill("/markdown 用一句话解释渗透作用");
  await composer.press("Enter");
  // The generated draft parks in the SAME floating editor (the preview loop).
  const preview = page.locator(".floating-note-editor.generation-preview");
  await expect(preview).toBeVisible({ timeout: 15_000 });
  // A generated (non-manual) draft offers Regenerate; it is rendered via the
  // adaptive-note registry (getNoteType().render), never a bespoke path.
  await expect(preview).not.toHaveAttribute("data-manual", "1");
  await expect(preview.locator(".gen-preview-regenerate")).toBeVisible();

  // Save persists the routed note through the normal note path.
  const before = (await (await request.get(`${SERVER}/api/notes`)).json()).notes?.length ?? 0;
  await preview.locator(".gen-preview-save").click();
  await expect(preview).toHaveCount(0);
  await expect
    .poll(async () => (await (await request.get(`${SERVER}/api/notes`)).json()).notes?.length ?? 0, {
      timeout: 15_000
    })
    .toBeGreaterThan(before);
});
