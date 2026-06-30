import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { openOperations } from "./helpers";

// AI operation-as-data V1 — the "custom plugin" authoring loop. Driving the real app in
// web mode (mock provider = deterministic), this proves the whole data-defined-operation
// wiring without asserting any generated text (the mock returns the contentType's default
// sample, so we assert STRUCTURE / WIRING only):
//
//   1. BUILDER: in the Actions pane author a custom operation — name it, pick an output
//      type, and INSERT a variable as a clickable content block (never typing {{}}); the
//      LIVE PREVIEW substitutes the focused passage's real text into the block.
//   2. 试一下: save + run through the ALREADY-SHIPPED generation-preview loop (the draft
//      previews, nothing auto-saves), then Save it.
//   3. RUN FROM TOOLBAR: the saved custom op now shows as a selection-toolbar action and
//      runs through the same preview loop.
//   4. ENABLE/DISABLE: toggling a built-in action off in the manager removes it from the
//      selection toolbar (the toolbars render the manager's prefs); toggling it back on
//      restores it.
//   5. BUILT-IN PARAM: filling a built-in's placeholder param (grade) persists to
//      operation-prefs.json (verified via the API).

const SERVER = "http://127.0.0.1:4177";
const READER = 'iframe[title="Source reader"]';
const PASSAGE = "Osmosis is the diffusion of water across a membrane.";

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

async function selectPassage(page: Page) {
  const reader = page.frameLocator(READER);
  await reader.getByText("Osmosis is the diffusion", { exact: false }).click();
  await expect(page.locator(".chat-source")).toContainText("Osmosis");
}

test.skip("operation authoring: build a custom action → 试一下 preview → save → run from toolbar → enable/disable → built-in param", async ({
  page,
  request
}) => {
  const title = `Op Authoring ${Date.now()}`;
  const body = `<article><section><p>${PASSAGE}</p></section></article>`;
  await seedHtmlSource(request, title, body);
  await openSource(page, title);

  // Focus a passage so the selection toolbar + the builder's live preview have real text.
  await selectPassage(page);
  await expect(page.locator(".selection-toolbar-btn", { hasText: "Explain" })).toBeVisible();

  // R1: the Actions/Operations pane is reached via the IconRail (not an always-on column).
  await openOperations(page);
  const panel = page.locator(".operation-panel");
  await expect(panel).toBeVisible();

  // —— 1. BUILDER: name + output type + a variable inserted as a content block ——
  const opName = `Summarize ${Date.now()}`;
  await panel.locator(".operation-name-input").fill(opName);
  await panel.locator(".operation-output-select").selectOption("markdown");

  // Write the instruction, then drop in the passage variable via the block button (the
  // author never types {{}}). The advanced variables list mirrors the inserted block.
  await panel.locator(".operation-template-input").fill("Summarize this passage: ");
  await panel.locator('.operation-var-btn[data-var="anchorText"]').click();
  // The advanced declared-variables list (collapsed by default) now tracks the block.
  await expect(panel.locator('.operation-var-edit[data-var="anchorText"]')).toBeAttached();

  // Live preview replaces the {{anchorText}} block with the focused passage's real text.
  await expect(panel.locator(".operation-preview")).toContainText("Summarize this passage:");
  await expect(panel.locator(".operation-preview")).toContainText("Osmosis is the diffusion");

  // —— 2. 试一下: save + run through the shipped generation-preview loop, then Save ——
  const preview = page.locator(".generation-preview");
  await panel.locator(".operation-try-btn").click();
  await expect(preview).toBeVisible({ timeout: 15_000 });
  await expect(preview.locator(".generation-preview-type")).toHaveText("markdown");
  await preview.locator(".gen-preview-save").click();
  await expect(preview).toHaveCount(0);

  // —— 3. RUN FROM TOOLBAR: the saved custom op now surfaces as a selection action ——
  const customBtn = page.locator('.selection-toolbar-btn[data-action-kind="operation"]', { hasText: opName });
  await selectPassage(page);
  await expect(customBtn).toBeVisible();
  await customBtn.click();
  await expect(preview).toBeVisible({ timeout: 15_000 });
  // Don't assert generated text (mock is deterministic default) — just the wiring.
  await preview.locator(".gen-preview-discard").click();
  await expect(preview).toHaveCount(0);

  // —— 4. ENABLE/DISABLE: turning a built-in off in the manager removes it from the
  // selection toolbar; turning it on restores it (toolbars render the manager prefs). ——
  const explainRow = panel.locator('.operation-action-row[data-action-id="textbook.explain-concept"]');
  await expect(explainRow).toBeVisible();
  const explainBtn = page.locator(".selection-toolbar-btn", { hasText: "Explain" });
  await expect(explainBtn).toBeVisible();

  // The toggle is controlled by prefs that round-trip to the server, so assert the
  // downstream toolbar effect rather than the checkbox's immediate state.
  await explainRow.locator(".operation-toggle").click();
  await expect(explainBtn).toHaveCount(0);
  await explainRow.locator(".operation-toggle").click();
  await expect(explainBtn).toBeVisible();

  // —— 5. BUILT-IN PARAM: fill the explain-concept "grade" placeholder; it persists to
  // operation-prefs.json (merged into generate input server-side before build()). ——
  const gradeInput = explainRow.locator('.operation-param[data-param="grade"] .operation-param-input');
  await expect(gradeInput).toBeVisible();
  await gradeInput.fill("Grade 3");
  await gradeInput.blur();

  await expect(async () => {
    const res = await request.get(`${SERVER}/api/operation-prefs`);
    expect(res.ok()).toBeTruthy();
    const { prefs } = await res.json();
    expect(prefs.params?.["textbook.explain-concept"]?.grade).toBe("Grade 3");
  }).toPass({ timeout: 10_000 });
});
