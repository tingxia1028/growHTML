import { expect, test, type APIRequestContext } from "@playwright/test";

// Study Layer V2 end-to-end (web mode): the full local `.studypack` import UX in the
// Layers pane. Seed an HTML source, then import a pack whose three anchors are built
// to hit all three rematch states, and assert:
//   1. the import PREVIEW shows matched / fuzzy / unmatched counts (1 / 1 / 1)
//   2. committing creates an imported layer + paints the MATCHED passage
//   3. toggling the layer OFF hides its highlight, ON brings it back
// (The pack matches the local source by FINGERPRINT TITLE — no contentHash needed.)

const SERVER = "http://127.0.0.1:4177";
const READER = 'iframe[title="Source reader"]';

// A sentence we quote exactly (matched) and case-mangle (fuzzy).
const EXACT = "the render thread submits draw commands to the GPU each frame";

async function seedHtmlSource(request: APIRequestContext, title: string) {
  const content = `<article><section><p>In a typical engine ${EXACT}, a frame behind the simulation.</p></section></article>`;
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

function samplePack(title: string) {
  return {
    packId: "layer_smoke_pack",
    createdAt: new Date().toISOString(),
    app: "ai-study-vault",
    // Match the importer's local copy by title (contentHash unknown to the test).
    sourceFingerprint: { title },
    layer: { title: "Alex's rendering highlights", author: { name: "Alex" }, visibility: "public" },
    anchors: [
      { refId: "a1", anchorKind: "html_selection", quote: EXACT, contextBefore: "", contextAfter: "" },
      // same words, different case, no context → only the flexible tier hits → fuzzy
      { refId: "a2", anchorKind: "html_selection", quote: "THE RENDER THREAD SUBMITS DRAW COMMANDS", contextBefore: "", contextAfter: "" },
      // not present → unmatched
      { refId: "a3", anchorKind: "html_selection", quote: "quantum entanglement of the bytecode interpreter", contextBefore: "", contextAfter: "" }
    ],
    notes: [{ contentType: "markdown", content: "Imported note.", anchorRefs: ["a1", "a2", "a3"], conceptRefs: [] }]
  };
}

test("study layer: import a .studypack → 3-state preview → commit paints matched → toggle hides/shows", async ({ page, request }) => {
  const title = `Layer Source ${Date.now()}`;
  const source = await seedHtmlSource(request, title);

  await page.goto("/");
  await page.locator(".source-item-open", { hasText: title }).click();
  await expect(page.locator(".reader-header h2")).toHaveText(title);

  // The matched passage isn't highlighted yet (no layer imported).
  const reader = page.frameLocator(READER);
  await expect(reader.getByText("render thread", { exact: false })).toBeVisible();
  await expect(reader.locator(".sv-annotated")).toHaveCount(0);

  // STEP 1 — pick the pack file → the (non-persisting) preview renders 3 states.
  await page.locator(".layer-import-input").setInputFiles({
    name: "sample.studypack",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(samplePack(title)))
  });
  const preview = page.locator(".layer-import-preview");
  await expect(preview).toBeVisible();
  await expect(preview.locator('.layer-stat[data-status="matched"]')).toContainText("1");
  await expect(preview.locator('.layer-stat[data-status="fuzzy"]')).toContainText("1");
  await expect(preview.locator('.layer-stat[data-status="unmatched"]')).toContainText("1");

  // STEP 2 — commit → an imported layer appears + the matched passage paints.
  await page.locator(".layer-preview-confirm").click();
  const layerItem = page.locator(".layer-item", { hasText: "Alex's rendering highlights" });
  await expect(layerItem).toBeVisible();
  await expect(reader.locator(".sv-annotated").first()).toBeVisible();

  // STEP 3 — toggle the layer OFF → its highlight disappears; ON → it returns.
  // (The checkbox is controlled by an async patch→re-fetch round-trip, so assert the
  // real effect — the painted highlight — rather than the checkbox's instant state.)
  await layerItem.locator(".layer-toggle").click();
  await expect(reader.locator(".sv-annotated")).toHaveCount(0);
  await layerItem.locator(".layer-toggle").click();
  await expect(reader.locator(".sv-annotated").first()).toBeVisible();

  // The imported layer + its anchor are scoped to this source on the server.
  const layers = (await (await request.get(`${SERVER}/api/sources/${source.id}/layers`)).json()).layers as Array<{
    importMode: string;
  }>;
  expect(layers.some((l) => l.importMode === "imported")).toBeTruthy();
});
