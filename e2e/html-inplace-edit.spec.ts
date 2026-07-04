import { expect, test } from "@playwright/test";
import { openLibraryMenu } from "./helpers";

// SRC-2b (HTML 所见即改) in a REAL browser — the one layer the unit suite cannot
// reach: a sandboxed (allow-same-origin, NO allow-scripts) iframe whose body is
// contenteditable, receiving real typing + a floating style-bar action, then the
// serialized result flowing through 源码 / 保存 / 阅读. Flow: `+` → 新建 HTML 页 (blank
// authored doc opens straight into 编辑, 页面编辑 default) → type in the page →
// select a word → style bar 加粗 (<b> by construction, applyInPlaceStyle — never
// execCommand) → 源码 sub-toggle shows the serialized markup → 保存 → 阅读 renders the
// bold through the server pipeline in the DomReader.
//
// The selection is set programmatically inside the frame (selectionchange still fires
// → the bar places itself) — dblclick word-selection is locale/boundary-flaky.

import { SERVER } from "./harness";

const READER = 'iframe[title="Source reader"]';
const EDIT_FRAME = "iframe.source-editor-inplace-frame";

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

test("新建 HTML 页 → type in the page → style bar 加粗 → 源码 shows <b> → 保存 → 阅读 renders bold", async ({
  page,
  request
}) => {
  const stamp = uid();
  const title = `我的 HTML 页 ${stamp}`;
  const word = "energy";

  // Guard fixture: a fresh e2e vault has zero sources and the SHELL-2 onboarding
  // checklist would auto-open over the center slot (source-authoring.spec idiom).
  const seed = await request.post(`${SERVER}/api/sources/html`, {
    data: { title: `导入对照 ${stamp}`, content: `<article><p>导入的内容 ${stamp}</p></article>` }
  });
  expect(seed.ok()).toBeTruthy();

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");

  // `+` → 新建 HTML 页 — the blank authored doc opens STRAIGHT into 编辑 with the
  // in-place page surface (页面编辑) as the default view.
  await openLibraryMenu(page);
  await page.locator('[data-add-action="core.create-html"]').click();
  await expect(page.locator(".source-editor-host")).toHaveAttribute("data-mode", "edit");
  const editFrame = page.frameLocator(EDIT_FRAME);

  // Type INTO the page (the sandboxed frame's contenteditable body — real key events).
  await editFrame.locator("body").click();
  await page.keyboard.type(`细胞需要能量 ${word} 才能工作。`);
  await expect(editFrame.locator("body")).toContainText(word);

  // Select the word programmatically → selectionchange → the floating style bar
  // appears in the HOST wrapper (its mousedown-preventDefault keeps the frame's
  // selection alive while we click).
  await editFrame.locator("body").evaluate((body, needle) => {
    const doc = body.ownerDocument;
    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? "";
      const idx = text.indexOf(needle);
      if (idx >= 0) {
        const range = doc.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + needle.length);
        const sel = doc.getSelection();
        if (!sel) throw new Error("no selection API in frame");
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
    }
    throw new Error(`word "${needle}" not found in the edited page`);
  }, word);
  const bar = page.locator(".source-editor-stylebar");
  await expect(bar).toBeVisible();

  // 加粗 → the pure transform wraps the selection in a real <b> (toggle semantics).
  await bar.locator('[data-style-action="bold"]').click();
  await expect(editFrame.locator("b", { hasText: word })).toBeVisible();

  // 源码 sub-toggle: the live DOM serializes into the SAME draft — the markup shows
  // the <b> the page edit just produced.
  await page.locator(".source-editor-html-view-btn", { hasText: "源码" }).click();
  await expect(page.locator(".source-editor-input-html")).toHaveValue(new RegExp(`<b>${word}</b>`));

  // Retitle + 保存 (the SRC-2 pipeline: re-hash, revision bump, reprojection).
  await page.locator(".source-editor-title").fill(title);
  await page.locator(".source-editor-save").click();
  await expect(page.locator(".source-editor-dirty")).toHaveCount(0);

  // 阅读 renders the saved page through the server pipeline — the bold survives.
  await page.locator(".source-editor-mode-btn", { hasText: "阅读" }).click();
  await expect(page.frameLocator(READER).locator("b", { hasText: word })).toBeVisible();
});
