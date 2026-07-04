import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Anchor Focus board end-to-end (N6 / D12, web mode). The board is a read-only surface
// over a source's anchors + notes with TWO layouts — (A) by document order (anchor rows +
// their notes' PreviewCards), (B) by stage layer (columns = the source's ENABLED stage
// layers, notes bucketed by layerId). It reuses the shipped §10 PreviewCard and the
// F7a stage-layer axis (预习/学习/复习/拓展 are auto-created per source on first layer read).
//
// Flow under test: seed a source with anchors + layer-assigned notes → open it → open the
// board from the TopBar's Anchor Focus tab → toggle A/B → a search filter narrows.
//
// Run: npm run e2e (Playwright boots its own server+client on dedicated e2e ports).

import { SERVER } from "./harness";

async function seedHtmlSource(request: APIRequestContext, title: string, body: string) {
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content: body } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

// name → layerId for the source's preset (+ custom) layers (预习/学习/复习/拓展 are
// auto-created per source the first time its layers are read).
async function layerIds(request: APIRequestContext, sourceId: string): Promise<Record<string, string>> {
  const res = await request.get(`${SERVER}/api/sources/${sourceId}/layers`);
  expect(res.ok(), `get layers failed: ${res.status()}`).toBeTruthy();
  const layers = (await res.json()).layers as Array<{ id: string; title: string }>;
  return Object.fromEntries(layers.map((l) => [l.title, l.id]));
}

async function seedAnchoredNote(
  request: APIRequestContext,
  sourceId: string,
  quote: string,
  content: string,
  noteLayerIds: string[]
) {
  const aRes = await request.post(`${SERVER}/api/anchors`, {
    data: {
      sourceId,
      anchorKind: "html_selection",
      studyId: `seed-${Date.now()}-${Math.random()}`,
      quote,
      contextBefore: "",
      contextAfter: ""
    }
  });
  expect(aRes.ok(), `seed anchor failed: ${aRes.status()}`).toBeTruthy();
  const anchor = (await aRes.json()).anchor as { id: string };
  const nRes = await request.post(`${SERVER}/api/notes`, {
    data: { sourceId, anchorIds: [anchor.id], contentType: "markdown", content, layerIds: noteLayerIds }
  });
  expect(nRes.ok(), `seed note failed: ${nRes.status()}`).toBeTruthy();
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function openSource(page: Page, source: { id: string; title: string }) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await page.locator(".source-item-open").filter({ hasText: source.title }).first().click();
  await expect(page.locator(".reader-tab-title")).toHaveText(source.title);
}

test("anchor-board: open from the TopBar, toggle A/B, and a filter narrows", async ({ page, request }) => {
  const stamp = uid();
  const title = `Anchor Board ${stamp}`;
  const previewNote = `Preview note about photosynthesis ${stamp}`;
  const studyNote = `Study note about respiration ${stamp}`;
  const passageA = "the light reactions split water";
  const passageB = "the Calvin cycle fixes carbon";
  const body = `<article><section><p>First, ${passageA} in the thylakoid.</p><p>Then, ${passageB} in the stroma.</p></section></article>`;

  const source = await seedHtmlSource(request, title, body);
  const ids = await layerIds(request, source.id);

  // Two anchors, each with a note in a DISTINCT stage layer (预习 vs 学习).
  await seedAnchoredNote(request, source.id, passageA, previewNote, [ids["预习"]]);
  await seedAnchoredNote(request, source.id, passageB, studyNote, [ids["学习"]]);

  await openSource(page, source);

  // The board is closed until the TopBar's Anchor Focus tab opens it. The e2e default
  // locale is zh, so target the SECOND center tab (锚点聚焦 / Anchor Focus) by index —
  // locale-robust, mirroring shell-smoke.spec.
  await expect(page.locator(".anchor-board")).toHaveCount(0);
  await page.locator(".topbar-center .topbar-tab").nth(1).click();
  const board = page.locator(".anchor-board");
  await expect(board).toBeVisible();

  // —— Layout A (default): anchors in document order, each with its notes' PreviewCards ——
  await expect(board).toHaveAttribute("data-layout", "document");
  const rows = board.locator(".anchor-board-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText(passageA);
  await expect(board.locator(".anchor-board-row", { hasText: previewNote })).toBeVisible();
  await expect(board.locator(".anchor-board-row .sv-preview-card")).toHaveCount(2);

  // —— Toggle to Layout B: stage-layer columns, notes bucketed by layerId ——
  await board.locator('.anchor-board-tab[data-layout="layer"]').click();
  await expect(board).toHaveAttribute("data-layout", "layer");
  // Data-driven columns: the source's four preset stages (预习/学习/复习/拓展) render.
  const preview = board.locator('.anchor-board-column[data-layer-id="' + ids["预习"] + '"]');
  const study = board.locator('.anchor-board-column[data-layer-id="' + ids["学习"] + '"]');
  await expect(preview).toContainText(previewNote); // 预习 bucket holds the preview note
  await expect(study).toContainText(studyNote); // 学习 bucket holds the study note

  // —— A search filter narrows (in the layer layout) to just the study note ——
  await board.locator(".anchor-board-search-input").fill("respiration");
  await expect(study).toContainText(studyNote);
  await expect(board.locator(".anchor-board-body")).not.toContainText(previewNote);

  // —— Back to Layout A; the filter still applies ——
  await board.locator('.anchor-board-tab[data-layout="document"]').click();
  await expect(board).toHaveAttribute("data-layout", "document");
  await expect(board.locator(".anchor-board-body")).toContainText(studyNote);
  await expect(board.locator(".anchor-board-body")).not.toContainText(previewNote);

  // Close the board → the reader returns.
  await board.locator(".anchor-board-close-btn").click();
  await expect(page.locator(".anchor-board")).toHaveCount(0);

  // Cleanup so the e2e vault doesn't accumulate the fixture.
  await request.delete(`${SERVER}/api/sources/${source.id}`);
});
