import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { openLayers } from "./helpers";

// Layer-as-lens V1 end-to-end (web mode). A study layer is a LENS, not a container: a
// note can belong to SEVERAL layers, the multi-select filter is OR across the enabled
// layers, and anchor painting is DERIVED (an anchor paints iff it has a note in an
// enabled layer).
//
// Old→new: the Growte IA rebuild removed the right-panel Note-mode composer AND the
// per-note layer-membership picker (.note-layer-*). The Layers PANE filter
// (.layer-panel/.layer-item/.layer-toggle) and custom-layer creation
// (.layer-create-input) survive. So we SEED notes (with explicit layerIds) + set
// membership via the API, and drive the surviving Layers-pane filter; the note now
// surfaces in the right-sidebar NoteListPanel (.note-list-row), whose visibility follows
// the enabled-layer filter. Derived painting is still asserted via .sv-annotated.
//
// Asserts:
//   (a) a note in TWO layers shows while EITHER is enabled (OR), hides when both off
//   (b) a CUSTOM layer can be created (UI) and governs a note assigned to it
//   (c) moving a note 预习→复习 (API) makes visibility follow the enabled-layer filter
//   (d) an anchor STOPS painting (.sv-annotated) when its note's only layer is disabled

const SERVER = "http://127.0.0.1:4177";
const READER = 'iframe[title="Source reader"]';

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

// Seed an html_selection anchor on `quote` (placeholder studyId; reader paints via the
// text-quote fallback) + a markdown note hung off it, assigned to `noteLayerIds`.
async function seedAnchoredNote(
  request: APIRequestContext,
  sourceId: string,
  quote: string,
  content: string,
  noteLayerIds: string[]
) {
  const aRes = await request.post(`${SERVER}/api/anchors`, {
    data: { sourceId, anchorKind: "html_selection", studyId: `seed-${Date.now()}-${Math.random()}`, quote, contextBefore: "", contextAfter: "" }
  });
  expect(aRes.ok(), `seed anchor failed: ${aRes.status()}`).toBeTruthy();
  const anchor = (await aRes.json()).anchor as { id: string };
  const nRes = await request.post(`${SERVER}/api/notes`, {
    data: { sourceId, anchorIds: [anchor.id], contentType: "markdown", content, layerIds: noteLayerIds }
  });
  expect(nRes.ok(), `seed note failed: ${nRes.status()}`).toBeTruthy();
  return (await nRes.json()).note as { id: string };
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Open a source by its globally-unique id, then surface the Layers pane + expand the
// right-sidebar Notes fold (collapsed by default) so both the filter and the note list
// are visible.
async function openSource(page: Page, source: { id: string; title: string }) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await page.locator(".source-item-open").filter({ hasText: source.id }).click();
  await expect(page.locator(".reader-tab-title")).toHaveText(source.title);
  await openLayers(page);
  await expandNotes(page);
}

async function expandNotes(page: Page) {
  const head = page.locator(".note-list-head");
  await expect(head).toBeVisible();
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
}

const noteRow = (page: Page, text: string) => page.locator(".note-list-row", { hasText: text });
const layerItem = (page: Page, title: string) => page.locator(".layer-panel .layer-item", { hasText: title });

// Set a Layers-pane filter checkbox to `enabled` and wait for it to settle (the toggle is
// an async PATCH + re-fetch). Idempotent.
async function setLayerFilter(page: Page, title: string, enabled: boolean) {
  const toggle = layerItem(page, title).locator(".layer-toggle");
  if ((await toggle.isChecked()) !== enabled) await toggle.click();
  if (enabled) await expect(toggle).toBeChecked();
  else await expect(toggle).not.toBeChecked();
}

test("layer-as-lens: a note in TWO layers shows by OR; toggling layers hides/shows it", async ({ page, request }) => {
  const stamp = uid();
  const title = `Lens OR ${stamp}`;
  const noteText = `OR-rule note ${stamp}.`;
  const passage = "the render thread submits draw commands";
  const body = `<article><section><p>In a typical engine ${passage} every frame.</p></section></article>`;
  const source = await seedHtmlSource(request, title, body);
  const ids = await layerIds(request, source.id);

  // The note belongs to EXACTLY {预习, 复习} (no owned-layer default), so visibility is
  // governed solely by those two presets — making the OR test crisp.
  await seedAnchoredNote(request, source.id, passage, noteText, [ids["预习"], ids["复习"]]);
  await openSource(page, source);

  // All preset stages start ENABLED, so the note shows.
  await expect(noteRow(page, noteText)).toBeVisible();

  // Disable 复习 → still in 预习 → OR keeps it visible.
  await setLayerFilter(page, "复习", false);
  await expect(noteRow(page, noteText)).toBeVisible();

  // Disable 预习 too → BOTH its layers are now off → it hides.
  await setLayerFilter(page, "预习", false);
  await expect(noteRow(page, noteText)).toHaveCount(0);

  // Re-enable 复习 → OR brings it back.
  await setLayerFilter(page, "复习", true);
  await expect(noteRow(page, noteText)).toBeVisible();
});

test("layer-as-lens: create a CUSTOM layer; it appears in the custom group and filters", async ({ page, request }) => {
  const stamp = uid();
  const title = `Lens Custom ${stamp}`;
  const noteText = `Custom-layer note ${stamp}.`;
  const passage = "a custom lens over this passage";
  const body = `<article><section><p>Notes about ${passage} live here.</p></section></article>`;
  const source = await seedHtmlSource(request, title, body);
  await layerIds(request, source.id); // ensure presets exist

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/");
  await page.locator(".source-item-open").filter({ hasText: source.id }).click();
  await expect(page.locator(".reader-tab-title")).toHaveText(source.title);
  await openLayers(page);

  // The Layers pane shows the four preset stages out of the box.
  const presets = page.locator('.layer-panel .layer-group[data-group="preset"] .layer-item');
  await expect(presets).toHaveCount(4);
  for (const stage of ["预习", "学习", "复习", "拓展"]) {
    await expect(layerItem(page, stage)).toBeVisible();
  }

  // Create a CUSTOM layer via the manager's add row (this UI survives).
  const customName = `My Lens ${stamp}`;
  await page.locator(".layer-panel .layer-create-input").fill(customName);
  await page.locator(".layer-panel .layer-create-btn").click();
  const custom = page.locator('.layer-panel .layer-group[data-group="custom"] .layer-item', { hasText: customName });
  await expect(custom).toBeVisible();
  await expect(custom).toHaveAttribute("data-role", "custom");
  await expect(custom.locator(".layer-delete-btn")).toBeVisible();

  // Assign a note EXCLUSIVELY to the custom layer (membership via API — the per-note
  // picker was removed), then reload so the client picks the note up.
  const ids = await layerIds(request, source.id);
  await seedAnchoredNote(request, source.id, passage, noteText, [ids[customName]]);
  await openSource(page, source);

  // Visible while the custom layer is enabled.
  await expect(noteRow(page, noteText)).toBeVisible();
  // Disable the custom layer → the note (its only layer) hides.
  await setLayerFilter(page, customName, false);
  await expect(noteRow(page, noteText)).toHaveCount(0);
  // Re-enable → it returns.
  await setLayerFilter(page, customName, true);
  await expect(noteRow(page, noteText)).toBeVisible();
});

test("layer-as-lens: move a note from 预习 to 复习; visibility follows the enabled-layer filter", async ({
  page,
  request
}) => {
  const stamp = uid();
  const title = `Lens Move ${stamp}`;
  const noteText = `Stage-move note ${stamp}.`;
  const passage = "moving this note between stages";
  const body = `<article><section><p>We are ${passage} as the term goes on.</p></section></article>`;
  const source = await seedHtmlSource(request, title, body);
  const ids = await layerIds(request, source.id);

  // Membership EXACTLY {预习}.
  const note = await seedAnchoredNote(request, source.id, passage, noteText, [ids["预习"]]);
  await openSource(page, source);

  // Disable 复习, leave 预习 on → the note (in 预习) is visible.
  await setLayerFilter(page, "复习", false);
  await expect(noteRow(page, noteText)).toBeVisible();
  // Disable 预习 too → it hides (only in 预习).
  await setLayerFilter(page, "预习", false);
  await expect(noteRow(page, noteText)).toHaveCount(0);

  // MOVE the note 预习 → 复习 via the API (the per-note picker was removed).
  const patch = await request.patch(`${SERVER}/api/notes/${note.id}`, { data: { layerIds: [ids["复习"]] } });
  expect(patch.ok(), `move note failed: ${patch.status()}`).toBeTruthy();

  // Re-enable 复习 → the moved note shows (its layer is enabled); 预习 stays off.
  await setLayerFilter(page, "复习", true);
  await expect(noteRow(page, noteText)).toBeVisible();
  // Disable 复习 → now the note's only layer is off → it hides.
  await setLayerFilter(page, "复习", false);
  await expect(noteRow(page, noteText)).toHaveCount(0);
});

test("layer-as-lens: DERIVED painting — an anchor stops painting when all its notes' layers are disabled", async ({
  page,
  request
}) => {
  const stamp = uid();
  const title = `Lens Paint ${stamp}`;
  const noteText = `Painted-anchor note ${stamp}.`;
  const passage = "the GPU consumes draw commands each frame";
  const body = `<article><section><p>In the pipeline ${passage} before present.</p></section></article>`;
  const source = await seedHtmlSource(request, title, body);
  const ids = await layerIds(request, source.id);

  // A note on the passage, membership EXACTLY {复习} → materializes the painted anchor.
  await seedAnchoredNote(request, source.id, passage, noteText, [ids["复习"]]);
  await openSource(page, source);

  const reader = page.frameLocator(READER);
  // Painted while 复习 enabled (text-quote fallback paints the seeded anchor).
  await expect(reader.locator(".sv-annotated", { hasText: "draw commands" }).first()).toBeVisible();

  // Disable 复习 → the anchor's only note is now in a disabled layer → derived painting
  // removes the highlight from the reader.
  await setLayerFilter(page, "复习", false);
  await expect(reader.locator(".sv-annotated", { hasText: "draw commands" })).toHaveCount(0);

  // Re-enable 复习 → the anchor repaints (derived).
  await setLayerFilter(page, "复习", true);
  await expect(reader.locator(".sv-annotated", { hasText: "draw commands" }).first()).toBeVisible();
});
