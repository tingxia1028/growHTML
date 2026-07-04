import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { openLibraryMenu } from "./helpers";

// SRC-1/2 (docs/design/source-authoring.md §5 e2e): the full authored loop against the
// real app — `+` → 新建 Markdown → the editor view opens straight into 编辑 mode (blank
// doc, kid typing in seconds) → type + retitle → 保存 (SRC-2 pipeline: re-hash, revision
// bump) → 阅读 renders the markdown through the server pipeline (DomReader iframe with
// study ids) → select the passage like any source (draft quote in .chat-source) →
// anchor + note materialize and PAINT on the authored source (.sv-annotated).
//
// Run: npx playwright test e2e/source-authoring.spec.ts
// (Playwright boots its own ephemeral server+client on the e2e ports — e2e/harness.ts.)

import { SERVER } from "./harness";

const READER = 'iframe[title="Source reader"]';

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type ApiSource = {
  id: string;
  title: string;
  sourceType: string;
  origin?: string;
  revision?: number;
  contentHash: string;
};

async function findSourceByTitle(request: APIRequestContext, title: string): Promise<ApiSource> {
  const res = await request.get(`${SERVER}/api/sources`);
  expect(res.ok(), `list sources failed: ${res.status()}`).toBeTruthy();
  const { sources } = (await res.json()) as { sources: ApiSource[] };
  const source = sources.find((item) => item.title === title);
  expect(source, `source titled "${title}" not found`).toBeTruthy();
  return source!;
}

async function listAnchors(request: APIRequestContext, sourceId: string) {
  const res = await request.get(`${SERVER}/api/sources/${sourceId}/anchors`);
  expect(res.ok(), `list anchors failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).anchors as Array<{ id: string; quote?: string }>;
}

async function openSourceRow(page: Page, title: string) {
  await page.goto("/");
  await page.locator(".source-item-open", { hasText: title }).first().click();
  await expect(page.locator(".reader-tab-title")).toHaveText(title);
}

test("新建 Markdown → type → save → read → annotate like any source", async ({ page, request }) => {
  const stamp = uid();
  const title = `我的第一篇 ${stamp}`;
  const passage = `线粒体是细胞的动力工厂 ${stamp}`;

  // Seed the imported-guard fixture FIRST (also keeps the SHELL-2 onboarding checklist
  // from auto-opening over the center slot — a fresh e2e vault has zero sources).
  const importedTitle = `导入对照 ${stamp}`;
  const seed = await request.post(`${SERVER}/api/sources/html`, {
    data: { title: importedTitle, content: `<article><p>导入的内容 ${stamp}</p></article>` }
  });
  expect(seed.ok()).toBeTruthy();
  const imported = (await seed.json()).source as ApiSource;

  // Wide viewport so the secondary right pane (the .chat-source draft chip) stays
  // expanded — it auto-collapses below the 1280 responsive breakpoint (bookmark.spec).
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");

  // `+` → 新建 Markdown (the default, FIRST create entry).
  await openLibraryMenu(page);
  const createMarkdown = page.locator('[data-add-action="core.create-markdown"]');
  await expect(createMarkdown).toBeVisible();
  await createMarkdown.click();

  // The blank authored doc opens STRAIGHT into 编辑 mode — typing within seconds.
  const host = page.locator(".source-editor-host");
  await expect(host).toHaveAttribute("data-mode", "edit");
  const textarea = page.locator(".source-editor-input");
  await textarea.fill(`# 细胞小知识\n\n${passage}\n\n还有别的段落。`);

  // Retitle inline (no separate rename surface needed) and save.
  await page.locator(".source-editor-title").fill(title);
  await expect(page.locator(".source-editor-dirty")).toBeVisible();
  await page.locator(".source-editor-save").click();
  await expect(page.locator(".source-editor-dirty")).toHaveCount(0);

  // The rename flowed through loadSources → the reader tab shows the new title.
  await expect(page.locator(".reader-tab-title")).toHaveText(title);

  // Model checks: authored origin, revision bumped by the save (1 → 2).
  const source = await findSourceByTitle(request, title);
  expect(source.origin).toBe("authored");
  expect(source.sourceType).toBe("markdown");
  expect(source.revision).toBe(2);

  // 阅读 mode renders the markdown through the server pipeline into the DomReader.
  await page.locator(".source-editor-mode-btn", { hasText: "阅读" }).click();
  const reader = page.frameLocator(READER);
  await expect(reader.getByText(passage, { exact: false })).toBeVisible();

  // Select the passage like any source → the focused quote surfaces in the right-rail
  // anchor pane with the selection Actions toolbar armed.
  await reader.getByText(passage, { exact: false }).click();
  await expect(page.getByRole("tabpanel")).toContainText(passage.slice(0, 12));

  // Annotate it like any source through the REAL selection toolbar: 书签/Bookmark
  // materializes an html_selection anchor on the authored source. Wait for the UI's
  // completion signal BEFORE touching /anchors — that endpoint prunes note-less
  // anchors, so an external poll mid-dispatch would tombstone the half-created anchor.
  await page
    .getByRole("toolbar", { name: "Actions" })
    .getByRole("button", { name: /^(书签|Bookmark)$/ })
    .click();
  await expect(page.getByRole("button", { name: "Show bookmark in Notes" })).toBeVisible();
  const uiAnchor = (await listAnchors(request, source.id)).find((a) => (a.quote ?? "").includes(passage));
  expect(uiAnchor, "the UI-created anchor should list with the passage quote").toBeTruthy();

  // A markdown note on that anchor PAINTS in the reader like any annotation.
  const nRes = await request.post(`${SERVER}/api/notes`, {
    data: { sourceId: source.id, anchorIds: [uiAnchor!.id], contentType: "markdown", content: `第一条笔记 ${stamp}` }
  });
  expect(nRes.ok(), `seed note failed: ${nRes.status()}`).toBeTruthy();
  await openSourceRow(page, title);
  const painted = reader.locator(".sv-annotated", { hasText: passage }).first();
  await expect(painted).toBeVisible();

  // Imported sources stay read-only: the HTML ingest seam creates origin "imported",
  // the editor never mounts for it, and the edit route rejects it.
  const patch = await request.patch(`${SERVER}/api/sources/${imported.id}/content`, {
    data: { content: "<p>rewrite</p>" }
  });
  expect(patch.status()).toBe(400);

  await openSourceRow(page, importedTitle);
  await expect(page.frameLocator(READER).getByText(`导入的内容 ${stamp}`)).toBeVisible();
  await expect(page.locator(".source-editor-host")).toHaveCount(0);
});
