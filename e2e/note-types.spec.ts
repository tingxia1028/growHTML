import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { makeGradientPng } from "./fixtures/image";

// §10 note display — MEDIA notes end-to-end.
//
// NOTE (old→new): the previous version of this spec drove the study-panel's Note-mode
// COMPOSER (`.composer-mode .mode-tab` "Note" → `.note-type-select` → "Save Note") and
// asserted the resulting `.note-list .record-card`. The Growte IA rebuild (in progress on
// this branch) removed that composer + the source-side `.note-list` surface — notes now
// surface as §10.4 note-type icons in the Anchor panel (click → shared PreviewCard) and
// through the generation-preview path. The flashcard/quiz COMPOSER authoring tests were
// therefore retired here (the structured-content render contract for every type — card
// AND full — is covered at the stable unit layer in
// src/client/notes/noteTypeRegistry.test.tsx, incl. the media card `.sv-media-img` /
// `.sv-media-caption` and the audio/video poster + duration badge).
//
// What remains worth an E2E against the REAL running app is the IA-independent half of
// the media path: the asset-import route stores real bytes and the asset bytes route
// (/api/assets/:id) serves a DECODABLE image — the bytes the §10 image PreviewCard /
// CenterView point their <img src> at. We drive it directly (web mode; no native dialog).

import { SERVER } from "./harness";

async function seedHtmlSource(request: APIRequestContext, title: string, body: string) {
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content: body } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

test("media: import an asset + create an image note → the asset bytes route serves a decodable image", async ({
  page,
  request
}) => {
  const title = `Image Note ${Date.now()}`;
  const source = await seedHtmlSource(request, title, "<article><p>Body with a figure.</p></article>");

  // Import an ASSET by reading a real temp PNG off disk (the server runs on this same
  // machine). This is the same route the desktop file-pick uses; here we drive it
  // directly to cover the asset pipeline in web mode.
  const dir = await mkdtemp(path.join(tmpdir(), "sv-e2e-asset-"));
  const pngPath = path.join(dir, "figure.png");
  await writeFile(pngPath, makeGradientPng(120, 90));
  const assetRes = await request.post(`${SERVER}/api/assets/local-file`, { data: { path: pngPath } });
  expect(assetRes.ok(), `import asset failed: ${assetRes.status()}`).toBeTruthy();
  const asset = (await assetRes.json()).asset as { id: string };
  expect(asset.id).toBeTruthy();

  // Create an IMAGE note whose structured content references the asset — the same
  // content shape the §10 image PreviewCard / CenterView render.
  const noteRes = await request.post(`${SERVER}/api/notes`, {
    data: { sourceId: source.id, contentType: "image", content: { assetId: asset.id, caption: "A seeded figure" } }
  });
  expect(noteRes.ok(), `create image note failed: ${noteRes.status()}`).toBeTruthy();
  const note = (await noteRes.json()).note as { contentType: string; content: { assetId: string; caption?: string } };
  expect(note.contentType).toBe("image");
  expect(note.content.assetId).toBe(asset.id);
  expect(note.content.caption).toBe("A seeded figure");

  // The asset bytes route (what the image card's <img src> points at) serves a DECODABLE
  // image — load it in the real browser (the Vite dev server proxies /api → the server)
  // and confirm it decodes (naturalWidth > 0).
  await page.goto("/");
  const decodedWidth = await page.evaluate(async (id: string) => {
    return await new Promise<number>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth);
      img.onerror = () => reject(new Error("image failed to load"));
      img.src = `${location.origin}/api/assets/${id}`;
    });
  }, asset.id);
  expect(decodedWidth).toBeGreaterThan(0);
});
