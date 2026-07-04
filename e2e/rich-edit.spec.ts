import { expect, test } from "@playwright/test";
import { openLibraryMenu } from "./helpers";

// SRC-4 (rich HTML editing + templates) in a REAL browser — the layer unit tests can't
// reach: an authored html page opened into the SRC-4 rich block editor + a template
// picked from the gallery, edited, saved through the SRC-2 pipeline, and re-projected in
// the read-mode DomReader. Flow: `+` → 新建 HTML 页 (blank authored doc → straight into
// 编辑) → 从模板开始 → pick 课堂笔记 (empty page REPLACES its body with the layout) → 丰富
// mode → block toolbar inserts a real block → 保存 (re-hash, revision bump, reprojection)
// → 阅读 renders the template + inserted block through the server pipeline.
//
// The SRC-4 editor adopts NO heavy WYSIWYG lib (verdict: extend SRC-2b's zero-dep
// in-place editing + templates); everything is pure-DOM, so grapesjs stays out of the
// bundle (asserted by the richEditorBundle unit guard + the build chunk output).

import { SERVER } from "./harness";

const READER = 'iframe[title="Source reader"]';
const EDIT_FRAME = "iframe.source-editor-inplace-frame";

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

test("新建 HTML 页 → 从模板开始 → 丰富 block insert → 保存 → 阅读 renders template + block", async ({
  page,
  request
}) => {
  const stamp = uid();
  const title = `我的模板页 ${stamp}`;

  // Guard fixture: a fresh e2e vault has zero sources and the onboarding checklist would
  // auto-open over the center slot (source-authoring.spec idiom).
  const seed = await request.post(`${SERVER}/api/sources/html`, {
    data: { title: `导入对照 ${stamp}`, content: `<article><p>导入的内容 ${stamp}</p></article>` }
  });
  expect(seed.ok()).toBeTruthy();

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");

  // `+` → 新建 HTML 页 — blank authored doc opens STRAIGHT into 编辑, 页面编辑 default.
  await openLibraryMenu(page);
  await page.locator('[data-add-action="core.create-html"]').click();
  await expect(page.locator(".source-editor-host")).toHaveAttribute("data-mode", "edit");
  const editFrame = page.frameLocator(EDIT_FRAME);

  // 从模板开始 → the gallery opens → pick 课堂笔记. The page is empty, so the template
  // REPLACES its body with the layout (an <h1> 课堂标题 among other blocks).
  await page.locator("[data-template-open]").click();
  await expect(page.locator(".source-editor-templates")).toBeVisible();
  await page.locator('[data-template-id="lessonNotes"]').click();
  await expect(page.locator(".source-editor-templates")).toHaveCount(0);
  await expect(editFrame.locator("h1", { hasText: "课堂标题" })).toBeVisible();

  // 丰富 mode: the block-insert toolbar appears (SRC-4 rich editing). Drop a callout
  // block — a real styled box, inserted by the pure DOM transform (never a page-builder).
  await page.locator('[data-html-view="rich"]').click();
  await expect(page.locator(".source-editor-blockbar")).toBeVisible();
  // Put the caret in the page first so the block has a deterministic landing spot.
  await editFrame.locator("h1").first().click();
  await page.locator('[data-block-insert="callout"]').click();

  // Retitle + 保存 (the SRC-2 pipeline: re-hash, revision bump, reprojection).
  await page.locator(".source-editor-title").fill(title);
  await page.locator(".source-editor-save").click();
  await expect(page.locator(".source-editor-dirty")).toHaveCount(0);

  // 阅读 renders the saved page through the server pipeline — template heading + the
  // inserted callout both survive.
  await page.locator(".source-editor-mode-btn", { hasText: "阅读" }).click();
  const reader = page.frameLocator(READER);
  await expect(reader.locator("h1", { hasText: "课堂标题" })).toBeVisible();
  // The callout is a styled <div> with our accent border-left — present in the render.
  await expect(reader.locator("div[style*='border-left']")).toBeVisible();
});
