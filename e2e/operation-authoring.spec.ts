import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { closeShellModal, openOperations } from "./helpers";

// AI operation-as-data — the "custom plugin" authoring loop, ACTION-2b shape
// (一句话新增, commit bf19eb4): the creator is TWO fields (名字 + 一句话指令) in a
// `.operation-builder[data-mode="simple"]`; ALL the V1 template chrome (output type,
// variable blocks, template textarea, live preview, declared vars) lives inside the
// 高级 fold and only after 编辑为完整模板 (`.operation-convert-btn`) flips the builder
// to data-mode="template". Driving the real app in web mode (mock provider =
// deterministic), asserting STRUCTURE / WIRING only — never generated text.
//
// NOTE surface reality (R6 Action Registry): CLICK-focusing a passage surfaces the
// anchor-scope actions in the right-sidebar ANCHOR BAR (.anchor-action-bar
// .action-grid-btn) — the floating `.selection-toolbar` only appears over a live TEXT
// selection. Buttons are ICON-ONLY (title in aria-label), so text locators can't
// match; use data-action-id / aria-label.

import { SERVER } from "./harness";
const READER = 'iframe[title="Source reader"]';
const PASSAGE = "Osmosis is the diffusion of water across a membrane.";

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

// Focus the passage (the right-sidebar Anchor tab shows its excerpt). exact:true —
// once a generated note is saved, its gutter card may also contain the phrase.
async function selectPassage(page: Page) {
  await page.frameLocator(READER).getByText(PASSAGE, { exact: true }).click();
  await expect(page.locator(".anchor-excerpt-quote")).toContainText("Osmosis");
}

test("一句话新增: two-field author → inline validation → 试一下 preview → save → runs from the toolbar → enable/disable → built-in param", async ({
  page,
  request
}) => {
  const title = `Op Authoring ${Date.now()}`;
  const body = `<article><section><p>${PASSAGE}</p></section></article>`;
  await seedHtmlSource(request, title, body);
  await openSource(page, title);

  // Focus a passage so 试一下 (scope=anchor) has a passage to run against; the anchor
  // bar's kit actions ENABLE once the excerpt fills.
  await selectPassage(page);
  const explainBtn = page.locator('.anchor-action-bar .action-grid-btn[data-action-id="textbook.explain-concept"]');
  await expect(explainBtn).toBeEnabled();

  // SHELL-4: the Operations manager lives in the centered shell MODAL (UserMenu →
  // 操作); it opens on the "manage" tab = the ACTION-2b two-field creator.
  await openOperations(page);
  const panel = page.locator(".operation-panel");
  const builder = panel.locator(".operation-builder");
  await expect(builder).toHaveAttribute("data-mode", "simple");
  // The V1 template chrome is NOT part of the simple creator (it only exists after
  // 高级 → 编辑为完整模板 flips the mode).
  await expect(panel.locator(".operation-template-input")).toHaveCount(0);

  // —— inline validation: 试一下 with both fields empty is rejected in place ——
  await panel.locator(".operation-try-btn").click();
  await expect(panel.locator('.operation-field-error[data-field="name"]')).toBeVisible();
  await expect(panel.locator('.operation-field-error[data-field="instruction"]')).toBeVisible();

  // —— author: exactly two fields, then 试一下 = save + run the preview loop ——
  const opName = `Summarize ${Date.now()}`;
  await panel.locator(".operation-name-input").fill(opName);
  await panel.locator(".operation-instruction-input").fill("用三句话总结这段话");
  // Typing clears the attempt-time errors.
  await expect(panel.locator(".operation-field-error")).toHaveCount(0);
  await panel.locator(".operation-try-btn").click();

  // The draft parks in the chat panel's GenerationPreview BEHIND the modal — close the
  // modal (Esc) to interact with it. No output type pinned (simple + auto), so we
  // assert the loop's structure, not the routed contentType.
  await closeShellModal(page);
  const preview = page.locator(".generation-preview");
  await expect(preview).toBeVisible({ timeout: 15_000 });
  await preview.locator(".gen-preview-save").click();
  await expect(preview).toHaveCount(0);

  // —— the saved op now runs from the anchor bar (icon-only button) ——
  const customBtn = page.locator(`.anchor-action-bar .action-grid-btn[data-action-kind="operation"][aria-label="${opName}"]`);
  await selectPassage(page);
  await expect(customBtn).toBeVisible();
  await customBtn.click();
  await expect(preview).toBeVisible({ timeout: 15_000 });
  await preview.locator(".gen-preview-discard").click();
  await expect(preview).toHaveCount(0);

  // —— ENABLE/DISABLE: toggling a built-in off in the manager removes it from the
  // anchor bar; back on restores it (the action surfaces render the manager prefs).
  // Count/visibility assertions on the bar work with the modal open (no clicks). ——
  await openOperations(page);
  const explainRow = panel.locator('.operation-action-row[data-action-id="textbook.explain-concept"]');
  await expect(explainRow).toBeVisible();
  await explainRow.locator(".operation-toggle").click();
  await expect(explainBtn).toHaveCount(0);
  await explainRow.locator(".operation-toggle").click();
  await expect(explainBtn).toBeVisible();

  // —— BUILT-IN PARAM: fill explain-concept's "grade" placeholder; it persists to
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

  await closeShellModal(page);
});

test("template path: 高级 → 编辑为完整模板 flips to template mode; V1 chrome + live preview substitute the focused passage", async ({
  page,
  request
}) => {
  const title = `Op Template ${Date.now()}`;
  const body = `<article><section><p>${PASSAGE}</p></section></article>`;
  await seedHtmlSource(request, title, body);
  await openSource(page, title);

  // Focus the passage FIRST so the template-mode live preview has real text to
  // substitute for {{anchorText}}.
  await selectPassage(page);

  await openOperations(page);
  const panel = page.locator(".operation-panel");
  const builder = panel.locator(".operation-builder");
  await expect(builder).toHaveAttribute("data-mode", "simple");

  const opName = `Template Op ${Date.now()}`;
  await panel.locator(".operation-name-input").fill(opName);
  await panel.locator(".operation-instruction-input").fill("Summarize this passage:");

  // 高级 (simple mode): output-type pin + scope + the convert seam — no V1 chrome yet.
  await panel.locator(".operation-advanced summary").click();
  await expect(panel.locator(".operation-output-select")).toBeVisible();
  await expect(panel.locator(".operation-scope-select")).toBeVisible();
  const convertBtn = panel.locator(".operation-convert-btn");
  await expect(convertBtn).toBeVisible();

  // 编辑为完整模板 asks for confirmation (window.confirm) before the one-way flip.
  page.once("dialog", (dialog) => void dialog.accept());
  await convertBtn.click();
  await expect(builder).toHaveAttribute("data-mode", "template");

  // The V1 chrome now lives INSIDE 高级: the template textarea is seeded from the
  // instruction + an {{anchorText}} block, and the variable auto-declares.
  const template = panel.locator(".operation-template-input");
  await expect(template).toBeVisible();
  await expect(template).toHaveValue(/Summarize this passage:[\s\S]*\{\{anchorText\}\}/);
  await expect(panel.locator('.operation-var-edit[data-var="anchorText"]')).toBeAttached();

  // Live preview replaces the {{anchorText}} block with the focused passage's text.
  await expect(panel.locator(".operation-preview")).toContainText("Summarize this passage:");
  await expect(panel.locator(".operation-preview")).toContainText("Osmosis is the diffusion");

  // Insert another variable as a clickable BLOCK (the author never types {{}}); the
  // preview substitutes the real source title.
  await panel.locator('.operation-var-btn[data-var="sourceTitle"]').click();
  await expect(panel.locator('.operation-var-edit[data-var="sourceTitle"]')).toBeAttached();
  await expect(panel.locator(".operation-preview")).toContainText(title);

  // Save → the op lands in the manager list as a custom (operation) row.
  await panel.locator(".operation-save-btn").click();
  await expect(
    panel.locator('.operation-action-row[data-action-kind="operation"]', { hasText: opName })
  ).toBeVisible();

  await closeShellModal(page);
});
