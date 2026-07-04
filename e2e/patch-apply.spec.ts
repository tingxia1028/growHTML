import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { openChatMenu, openReaderMenu } from "./helpers";

// SRC-3 (docs/design/source-authoring.md §4): the patch APPLY engine + imported-source
// fork against the real app.
//   • Seed an imported HTML source + an html_selection anchor + a patch via the API.
//   • Drive Apply through the chat panel's patch list → the edit BAKES into the stored
//     content (revision bumps, contentHash changes) and the reader shows the new text.
//   • Drive Revert → the original bytes come back.
//   • Fork the imported source to an editable authored copy via the Reader ⋯ menu
//     (复制为可编辑副本) → a new authored source opens in the editor; the original keeps
//     its anchor (notes/anchors stay on the original, §3).
//
// Run: npx playwright test e2e/patch-apply.spec.ts
// (Playwright boots its own ephemeral server+client on the e2e ports — e2e/harness.ts.)

import { SERVER } from "./harness";

const READER = 'iframe[title="Source reader"]';

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type ApiSource = { id: string; title: string; sourceType: string; origin?: string; revision?: number };

async function getSource(request: APIRequestContext, id: string): Promise<ApiSource> {
  const res = await request.get(`${SERVER}/api/sources`);
  expect(res.ok()).toBeTruthy();
  const { sources } = (await res.json()) as { sources: ApiSource[] };
  const source = sources.find((s) => s.id === id);
  expect(source, `source ${id} not found`).toBeTruthy();
  return source!;
}

async function listAnchors(request: APIRequestContext, sourceId: string) {
  const res = await request.get(`${SERVER}/api/sources/${sourceId}/anchors`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).anchors as Array<{ id: string; studyId?: string; quote?: string }>;
}

async function openSourceRow(page: Page, title: string) {
  await page.goto("/");
  await page.locator(".source-item-open", { hasText: title }).first().click();
  await expect(page.locator(".reader-tab-title")).toHaveText(title);
}

// Expand the <details class="patch-fold"> in the (already-open) chat menu popover so the
// patch list is visible. Idempotent — only clicks the summary when the fold is closed.
async function expandPatchFold(page: Page) {
  const fold = page.locator(".panel-menu-popover .patch-fold");
  if ((await fold.getAttribute("open")) === null) {
    await fold.locator("> summary").click();
  }
  await expect(page.locator(".panel-menu-popover .patch-list .record-card").first()).toBeVisible();
}

test("patch apply bakes into storage + revert restores; imported source forks to an editable copy", async ({
  page,
  request
}) => {
  const stamp = uid();
  const title = `细胞导入 ${stamp}`;
  const original = `线粒体是细胞的动力工厂 ${stamp}`;
  const edited = `叶绿体负责光合作用 ${stamp}`;

  // —— seed an IMPORTED html source (ingest injects study ids) ——
  const seed = await request.post(`${SERVER}/api/sources/html`, {
    data: { title, content: `<article><p>${original}</p><p>另一段落 ${stamp}。</p></article>` }
  });
  expect(seed.ok()).toBeTruthy();
  const source = (await seed.json()).source as ApiSource;
  expect(source.origin).toBe("imported");

  // The first paragraph carries a study id — anchor the patch to it.
  const renderedRes = await request.get(`${SERVER}/api/sources/${source.id}/rendered`);
  const renderedHtml = (await renderedRes.json()).content as string;
  const studyId = new RegExp(`data-study-id="([^"]+)">${original}`).exec(renderedHtml)?.[1];
  expect(studyId, "seeded paragraph should carry a study id").toBeTruthy();

  const anchorRes = await request.post(`${SERVER}/api/anchors`, {
    data: {
      sourceId: source.id,
      studyId,
      selector: `[data-study-id="${studyId}"]`,
      quote: original
    }
  });
  expect(anchorRes.ok()).toBeTruthy();
  const anchor = (await anchorRes.json()).anchor as { id: string };

  // A NOTE on that anchor makes it a real (painting) annotation — the §3 invariant is
  // that this note+anchor STAY on the original after a fork.
  const noteRes = await request.post(`${SERVER}/api/notes`, {
    data: { sourceId: source.id, anchorIds: [anchor.id], contentType: "markdown", content: `原件笔记 ${stamp}` }
  });
  expect(noteRes.ok()).toBeTruthy();

  const patchRes = await request.post(`${SERVER}/api/patches`, {
    data: {
      sourceId: source.id,
      anchorId: anchor.id,
      action: "replace_selection",
      oldText: original,
      newContent: `<p data-study-id="${studyId}">${edited}</p>`
    }
  });
  expect(patchRes.ok()).toBeTruthy();

  // —— open the source; the imported body renders the original passage ——
  await page.setViewportSize({ width: 1400, height: 900 });
  await openSourceRow(page, title);
  const reader = page.frameLocator(READER);
  await expect(reader.getByText(original, { exact: false })).toBeVisible();

  // —— Apply the patch through the chat panel's patch list ——
  // The list lives inside a <details class="patch-fold"> — expand it first.
  await openChatMenu(page);
  await expandPatchFold(page);
  await page
    .locator(".panel-menu-popover .patch-list .record-card")
    .first()
    .getByRole("button", { name: "Apply" })
    .click();

  // The edit is BAKED into the stored content: reader shows the new text, old text gone,
  // and the model reflects an applied patch on a bumped revision.
  await expect(reader.getByText(edited, { exact: false })).toBeVisible();
  await expect(reader.getByText(original, { exact: false })).toHaveCount(0);
  await expect
    .poll(async () => (await getSource(request, source.id)).revision)
    .toBe(2);
  await expect
    .poll(async () => {
      const list = await request.get(`${SERVER}/api/sources/${source.id}/patches`);
      return (await list.json()).patches[0]?.status;
    })
    .toBe("applied");

  // —— Revert restores the original bytes ——
  await openChatMenu(page);
  await expandPatchFold(page);
  await page
    .locator(".panel-menu-popover .patch-list .record-card")
    .first()
    .getByRole("button", { name: "Revert" })
    .click();
  await expect(reader.getByText(original, { exact: false })).toBeVisible();
  await expect
    .poll(async () => {
      const list = await request.get(`${SERVER}/api/sources/${source.id}/patches`);
      return (await list.json()).patches[0]?.status;
    })
    .toBe("reverted");

  // —— Fork the imported source to an editable authored copy (Reader ⋯ menu) ——
  await openReaderMenu(page);
  const forkBtn = page.locator(".panel-menu-popover", { hasText: "复制为可编辑副本" }).getByRole("button", {
    name: "复制为可编辑副本"
  });
  await expect(forkBtn).toBeVisible();
  await forkBtn.click();

  // The fork opens in the authored editor view (its own chrome). The reader tab title is
  // the copy's title.
  await expect(page.locator(".reader-tab-title")).toHaveText(`${title}（副本）`);
  await expect(page.locator(".source-editor-host")).toHaveCount(1);

  // The fork is a fresh AUTHORED source; the ORIGINAL keeps its anchor (§3).
  const forked = await getSource(request, (await request.get(`${SERVER}/api/sources`)
    .then((r) => r.json()))
    .sources.find((s: ApiSource) => s.title === `${title}（副本）`).id);
  expect(forked.origin).toBe("authored");
  expect(forked.id).not.toBe(source.id);
  // The original keeps its (note-backed, painting) anchor; the fork starts annotation-free.
  const originalAnchors = await listAnchors(request, source.id);
  expect(originalAnchors.some((a) => a.id === anchor.id)).toBeTruthy();
  const forkAnchors = await listAnchors(request, forked.id);
  expect(forkAnchors).toHaveLength(0);
  // The note stayed on the ORIGINAL too (never copied to the fork).
  const forkNotes = await request.get(`${SERVER}/api/sources/${forked.id}/notes`).then((r) => r.json());
  expect(forkNotes.notes).toHaveLength(0);
});
