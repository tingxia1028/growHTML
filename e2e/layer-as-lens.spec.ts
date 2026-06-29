import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { openLayers } from "./helpers";

// Layer-as-lens V1 end-to-end (web mode). A study layer is a LENS, not a container: a
// note can belong to SEVERAL layers, the multi-select filter is OR across the enabled
// layers, and anchor painting is DERIVED (an anchor paints iff it has a note in an
// enabled layer). This drives the real Stage-3 UI the client produced:
//
//   • the Layers pane (.layer-panel) — grouped checkboxes (.layer-item / .layer-toggle)
//     are the multi-select FILTER; the stored `enabled` flag is the source of truth the
//     server reads for both the note list AND the derived anchor painting.
//   • the per-note membership control (.note-layers) — chips + a checkbox picker
//     (.note-layer-picker / .note-layer-option) that sends the note's FULL next
//     membership via note.set-layers (PATCH /api/notes/:id { layerIds }).
//   • the preset stages 预习 / 学习 / 复习 / 拓展 (data-group="preset"), auto-created per
//     source, and a CUSTOM layer the user creates (.layer-create-input/.layer-create-btn).
//
// Asserts:
//   (a) a note assigned to TWO layers shows while EITHER is enabled (OR), hides when both off
//   (b) a CUSTOM layer can be created and appears in the custom group
//   (c) moving a note from 预习 to 复习 makes visibility follow the enabled-layer filter
//   (d) an anchor STOPS painting (.sv-annotated) when all its notes' layers are disabled
//       (derived painting), and repaints when one is re-enabled
//
// Modeled on e2e/study-layer.spec.ts (SERVER 4177, READER iframe, highlight .sv-annotated)
// and viewer-flows.spec.ts (select→note→html_selection anchor→highlight).

const SERVER = "http://127.0.0.1:4177";
const READER = 'iframe[title="Source reader"]';

async function seedHtmlSource(request: APIRequestContext, title: string, body: string) {
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content: body } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

// Open a freshly seeded source from the library and wait for it to be active. Opens by
// the source's globally-unique ID (the .source-item-open row renders "sourceType · id"),
// NOT by title — so accumulated vault state from other tests/iterations can never make the
// row ambiguous (titles aren't guaranteed unique under repeats; ids always are).
async function openSource(page: Page, source: { id: string; title: string }) {
  await page.goto("/");
  await page.locator(".source-item-open").filter({ hasText: source.id }).click();
  await expect(page.locator(".reader-header h2")).toHaveText(source.title);
  // R1: the Layers pane is reached via the IconRail (not an always-on column). Every test
  // in this spec drives the layer filter, so surface it right after opening the source.
  await openLayers(page);
}

// A per-test unique stamp so source titles + note text never collide across tests or
// `--repeat-each` iterations (the e2e vault is shared within a run).
function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Select a passage in the reader iframe → save it as a markdown note. This materializes
// an html_selection anchor on the passage and (since the note defaults to the source's
// owned layer) paints it as a .sv-annotated highlight. Returns nothing — the note shows
// in the .note-list with `text`.
async function selectAndSaveNote(page: Page, passage: string, text: string) {
  const reader = page.frameLocator(READER);
  await reader.getByText(passage, { exact: false }).click();
  await expect(page.locator(".chat-source")).toContainText(passage);
  await page.locator(".composer-mode .mode-tab", { hasText: "Note" }).click();
  await page.locator(".composer-input").fill(text);
  await page.getByRole("button", { name: "Save Note" }).click();
  await expect(page.locator(".note-list")).toContainText(text);
}

// The note card in the study panel that contains `text` (the .record-card it renders in).
function noteCard(page: Page, text: string) {
  return page.locator(".note-list .record-card", { hasText: text });
}

// A layer row in the Layers pane by its visible title.
function layerItem(page: Page, title: string) {
  return page.locator(".layer-panel .layer-item", { hasText: title });
}

// Set a Layers-pane layer's filter checkbox to `enabled` and WAIT for the checkbox to
// settle into that state before returning. The toggle is an async PATCH + re-fetch that
// re-renders the pane; firing two toggles back-to-back can pipeline (a stale re-fetch
// landing last can lose an update), so each filter change is driven to a confirmed state
// here rather than fired-and-forgotten. Idempotent (no click if already in the target).
async function setLayerFilter(page: Page, title: string, enabled: boolean) {
  const toggle = layerItem(page, title).locator(".layer-toggle");
  if ((await toggle.isChecked()) !== enabled) await toggle.click();
  if (enabled) await expect(toggle).toBeChecked();
  else await expect(toggle).not.toBeChecked();
}

// Open a note card's layer picker (the fold of checkboxes) so its options are clickable.
async function openNotePicker(card: Locator) {
  const picker = card.locator(".note-layer-picker");
  if ((await picker.count()) === 0 || !(await picker.isVisible())) {
    await card.locator(".note-layer-edit").click();
  }
  await expect(picker).toBeVisible();
  return picker;
}

// The labels of all layer options in a note card's picker (each is a layer title; the
// owned layer's title is data-driven, so we read them rather than hard-code it).
async function pickerLabels(card: Locator): Promise<string[]> {
  const picker = await openNotePicker(card);
  const options = picker.locator(".note-layer-option");
  const count = await options.count();
  const labels: string[] = [];
  for (let i = 0; i < count; i++) labels.push((await options.nth(i).innerText()).trim());
  return labels;
}

// Set a note card's membership to EXACTLY `target` (a set of layer titles). Each toggle
// fires note.set-layers (PATCH layerIds) → an async re-fetch that re-renders the list and
// can CLOSE the picker. The checkbox is CONTROLLED by the note's persisted layerIds, so it
// only flips AFTER that round-trip lands — clicking and immediately re-reading would race.
// So we act one option at a time: click a single checkbox whose state differs from the
// target, then WAIT (Playwright web-first retry) for that checkbox to settle into its new
// state before re-reading from the top. We re-locate the card by text every step (no stale
// index snapshots). The note card must currently be visible (in an enabled layer or empty).
async function setExactMembership(page: Page, noteText: string, target: string[]) {
  const want = new Set(target);
  // Loop until no option's checked-state disagrees with the target (idempotent).
  for (let guard = 0; guard < 12; guard++) {
    const labels = await pickerLabels(noteCard(page, noteText));
    let changed = false;
    for (const label of labels) {
      const picker = await openNotePicker(noteCard(page, noteText));
      const checkbox = picker.locator(".note-layer-option", { hasText: label }).locator('input[type="checkbox"]');
      const isChecked = await checkbox.isChecked();
      const shouldCheck = want.has(label);
      if (isChecked !== shouldCheck) {
        await checkbox.click();
        // Block until the controlled checkbox reflects the persisted change (the PATCH +
        // re-fetch settled), so the next read isn't against stale optimistic state.
        const settled = (await openNotePicker(noteCard(page, noteText)))
          .locator(".note-layer-option", { hasText: label })
          .locator('input[type="checkbox"]');
        if (shouldCheck) await expect(settled).toBeChecked();
        else await expect(settled).not.toBeChecked();
        changed = true;
        break; // re-read from the top — the list re-rendered
      }
    }
    if (!changed) break;
  }
  // Verify the final chip set equals the target (the visible chips are the persisted
  // memberships), then close the fold so later assertions read the card cleanly.
  const card = noteCard(page, noteText);
  await expect(card.locator(".note-layer-chip")).toHaveCount(target.length);
  for (const layerTitle of target) {
    await expect(card.locator(".note-layer-chip", { hasText: layerTitle })).toBeVisible();
  }
  if (await card.locator(".note-layer-picker").isVisible()) await card.locator(".note-layer-edit").click();
}

test("layer-as-lens: a note in TWO layers shows by OR; toggling layers hides/shows it", async ({ page, request }) => {
  const stamp = uid();
  const title = `Lens OR ${stamp}`;
  const noteText = `OR-rule note ${stamp}.`;
  const passage = "the render thread submits draw commands";
  const body = `<article><section><p>In a typical engine ${passage} every frame.</p></section></article>`;
  const source = await seedHtmlSource(request, title, body);
  await openSource(page, source);

  // Create a note on the passage. It defaults to the source's OWNED layer ("Mine").
  await selectAndSaveNote(page, passage, noteText);
  const card = noteCard(page, noteText);
  await expect(card).toBeVisible();

  // Pin the note's membership to EXACTLY {预习, 复习} — stripping the owned-layer default —
  // so visibility is governed solely by the two presets (the owned layer can't keep it
  // visible). This makes the OR test crisp.
  await setExactMembership(page, noteText, ["预习", "复习"]);

  // The note's chips now read 预习 + 复习.
  await expect(card.locator(".note-layer-chip", { hasText: "预习" })).toBeVisible();
  await expect(card.locator(".note-layer-chip", { hasText: "复习" })).toBeVisible();

  // All preset stages start ENABLED (the server creates them enabled), so the note shows.
  await expect(noteCard(page, noteText)).toBeVisible();

  // Disable 复习 → still in 预习 → OR keeps it visible.
  await setLayerFilter(page, "复习", false);
  await expect(noteCard(page, noteText)).toBeVisible();

  // Disable 预习 too → BOTH its layers are now off → it hides (no orphan: it has layers).
  await setLayerFilter(page, "预习", false);
  await expect(noteCard(page, noteText)).toHaveCount(0);

  // Re-enable 复习 → OR brings it back.
  await setLayerFilter(page, "复习", true);
  await expect(noteCard(page, noteText)).toBeVisible();
});

test("layer-as-lens: create a CUSTOM layer; it appears in the custom group and filters", async ({ page, request }) => {
  const stamp = uid();
  const title = `Lens Custom ${stamp}`;
  const noteText = `Custom-layer note ${stamp}.`;
  const passage = "a custom lens over this passage";
  const body = `<article><section><p>Notes about ${passage} live here.</p></section></article>`;
  const source = await seedHtmlSource(request, title, body);
  await openSource(page, source);

  // The Layers pane shows the four preset stages out of the box.
  const presets = page.locator('.layer-panel .layer-group[data-group="preset"] .layer-item');
  await expect(presets).toHaveCount(4);
  for (const stage of ["预习", "学习", "复习", "拓展"]) {
    await expect(layerItem(page, stage)).toBeVisible();
  }

  // Create a CUSTOM layer via the manager's add row.
  const customName = `My Lens ${stamp}`;
  await page.locator(".layer-panel .layer-create-input").fill(customName);
  await page.locator(".layer-panel .layer-create-btn").click();

  // It lands in the CUSTOM group, with data-role="custom" and a delete control (custom-only).
  const custom = page.locator('.layer-panel .layer-group[data-group="custom"] .layer-item', { hasText: customName });
  await expect(custom).toBeVisible();
  await expect(custom).toHaveAttribute("data-role", "custom");
  await expect(custom.locator(".layer-delete-btn")).toBeVisible();

  // Assign a note exclusively to the custom layer and assert the filter governs it.
  await selectAndSaveNote(page, passage, noteText);
  const card = noteCard(page, noteText);
  // Pin membership to EXACTLY {customLayer} so only the custom lens holds this note.
  await setExactMembership(page, noteText, [customName]);
  await expect(card.locator(".note-layer-chip", { hasText: customName })).toBeVisible();

  // Visible while the custom layer is enabled.
  await expect(noteCard(page, noteText)).toBeVisible();
  // Disable the custom layer → the note (its only layer) hides.
  await setLayerFilter(page, customName, false);
  await expect(noteCard(page, noteText)).toHaveCount(0);
  // Re-enable → it returns.
  await setLayerFilter(page, customName, true);
  await expect(noteCard(page, noteText)).toBeVisible();
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
  await openSource(page, source);

  await selectAndSaveNote(page, passage, noteText);
  const card = noteCard(page, noteText);

  // Make membership EXACTLY {预习}.
  await setExactMembership(page, noteText, ["预习"]);
  await expect(card.locator(".note-layer-chip", { hasText: "预习" })).toBeVisible();

  // Disable 复习, leave 预习 on → the note (in 预习) is visible.
  await setLayerFilter(page, "复习", false);
  await expect(noteCard(page, noteText)).toBeVisible();
  // Now disable 预习 too → it hides (it's only in 预习).
  await setLayerFilter(page, "预习", false);
  await expect(noteCard(page, noteText)).toHaveCount(0);

  // Re-enable 复习 so the FILTER currently shows 复习 (and 预习 is off). The note is still
  // in 预习, so it stays hidden — proving the filter is driving visibility.
  await setLayerFilter(page, "复习", true);
  await expect(noteCard(page, noteText)).toHaveCount(0);

  // MOVE the note 预习 → 复习. The note card isn't in the list now (it's filtered out), so
  // make 预习 visible again to reach the card, perform the move, then assert.
  await setLayerFilter(page, "预习", true);
  await expect(noteCard(page, noteText)).toBeVisible();
  const moveCard = noteCard(page, noteText);
  // Move membership EXACTLY {预习} → {复习}.
  await setExactMembership(page, noteText, ["复习"]);
  await expect(moveCard.locator(".note-layer-chip", { hasText: "复习" })).toBeVisible();
  await expect(moveCard.locator(".note-layer-chip", { hasText: "预习" })).toHaveCount(0);

  // Now disable 预习 — the note has MOVED to 复习, so the 预习 filter no longer affects it;
  // it stays visible because 复习 is enabled.
  await setLayerFilter(page, "预习", false);
  await expect(noteCard(page, noteText)).toBeVisible();
  // Disable 复习 → now the note's only layer is off → it hides.
  await setLayerFilter(page, "复习", false);
  await expect(noteCard(page, noteText)).toHaveCount(0);
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
  await openSource(page, source);

  const reader = page.frameLocator(READER);
  // No highlight before any note exists.
  await expect(reader.locator(".sv-annotated")).toHaveCount(0);

  // Create a note on the passage → materializes an html_selection anchor + paints it.
  await selectAndSaveNote(page, passage, noteText);
  await expect(reader.locator(".sv-annotated").first()).toBeVisible();

  // Confirm the anchor was created server-side (html_selection on the passage).
  const anchors = (await (await request.get(`${SERVER}/api/sources/${source.id}/anchors`)).json()).anchors as Array<{
    anchorKind: string;
    quote?: string;
  }>;
  expect(anchors.some((a) => a.anchorKind === "html_selection" && (a.quote ?? "").includes("draw commands"))).toBeTruthy();

  // Pin the note's membership to EXACTLY {复习}. Painting is DERIVED from the note's
  // layers, so once the note sits only in 复习, disabling 复习 must un-paint the anchor.
  const card = noteCard(page, noteText);
  await setExactMembership(page, noteText, ["复习"]);
  await expect(card.locator(".note-layer-chip", { hasText: "复习" })).toBeVisible();

  // Still painted (复习 enabled).
  await expect(reader.locator(".sv-annotated").first()).toBeVisible();

  // Disable 复习 → the anchor's only note is now in a disabled layer → derived painting
  // removes the highlight from the reader.
  await setLayerFilter(page, "复习", false);
  await expect(reader.locator(".sv-annotated")).toHaveCount(0);

  // Re-enable 复习 → the note is visible again → the anchor repaints (derived).
  await setLayerFilter(page, "复习", true);
  await expect(reader.locator(".sv-annotated").first()).toBeVisible();
});
