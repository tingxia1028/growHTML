import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Adaptive note forms — Phase 1b (card + centered overlay UX) against the REAL app
// (web mode). Covers the two browser-dependent capabilities this phase ships:
//
//   • Composer "detected · override" chip (decision #2): typing a mermaid source into
//     the composer LIVE-classifies it and shows a "detected: mermaid" chip; "change"
//     reveals the override <select>.
//   • Note viewer (requirement 2) → shared FocusOverlay (requirement 1): a saved
//     markmap note renders IN ITS FORM, and "Open interactively" opens the CENTERED
//     overlay that mounts the live interactive diagram (real markmap SVG) — the same
//     FocusOverlay capability the chat ArtifactCard uses.
//
// (The thread ArtifactCard for a high-confidence AI reply is covered by the component
// tests — the deterministic mock prepends a header to every reply, so a chat reply
// never classifies as a pure rich form; the card/overlay capability itself is proven
// end-to-end here via the note viewer, which shares the SAME components.)

const SERVER = "http://127.0.0.1:4177";

async function seedHtmlSource(request: APIRequestContext, title: string, body: string) {
  const res = await request.post(`${SERVER}/api/sources/html`, { data: { title, content: body } });
  expect(res.ok(), `seed source failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).source as { id: string; title: string };
}

async function openSource(page: Page, title: string) {
  await page.goto("/");
  await page.locator(".source-item-open", { hasText: title }).click();
  await expect(page.locator(".reader-header h2")).toHaveText(title);
}

test("composer 'detected · override' chip: a mermaid source auto-detects mermaid, 'change' reveals the override", async ({
  page,
  request
}) => {
  const title = `Composer Chip ${Date.now()}`;
  await seedHtmlSource(request, title, "<article><p>Body about flowcharts.</p></article>");
  await openSource(page, title);

  // Switch to Note mode — the demoted picker (a detected chip) appears.
  await page.locator(".composer-mode .mode-tab", { hasText: "Note" }).click();
  await expect(page.locator(".composer-detected-chip")).toBeVisible();
  // Empty composer → low confidence → markdown.
  await expect(page.locator(".composer-detected-label strong")).toHaveText("markdown");

  // Type a bare mermaid source → it LIVE-classifies and auto-detects mermaid.
  await page.locator(".composer-input").fill("flowchart LR; Start --> End");
  await expect(page.locator(".composer-detected-label strong")).toHaveText("mermaid");

  // "change" demotes to the override <select> listing every offered type.
  await page.locator(".composer-detected-change").click();
  const select = page.locator(".composer-type-picker select.note-type-select");
  await expect(select).toBeVisible();
  await expect(select.locator("option", { hasText: "markmap" })).toHaveCount(1);
});

test("note viewer → centered overlay: a markmap note renders in its form and opens interactively", async ({
  page,
  request
}) => {
  const title = `Markmap Note ${Date.now()}`;
  const source = await seedHtmlSource(request, title, "<article><p>Body about mind maps.</p></article>");

  // Seed a markmap note directly (its content is the markdown outline string).
  const noteRes = await request.post(`${SERVER}/api/notes`, {
    data: { sourceId: source.id, contentType: "markmap", content: "# Root\n## Branch A\n## Branch B" }
  });
  expect(noteRes.ok(), `create markmap note failed: ${noteRes.status()}`).toBeTruthy();

  await openSource(page, title);

  // The note renders IN ITS FORM (requirement 2): the diagram mounts inline (a real
  // markmap <svg>), not flattened to text.
  const card = page.locator(".note-list .record-card", { hasText: "markmap" }).first();
  await expect(card).toBeVisible();
  await expect(card.locator(".note-diagram-markmap svg")).toBeVisible({ timeout: 15_000 });

  // "Open interactively" focuses the note into the shared centered FocusOverlay.
  await card.locator(".note-open-overlay").click();
  const overlay = page.locator(".sv-focus-overlay");
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('[role="dialog"][aria-modal="true"]')).toBeVisible();
  // The overlay mounts the FULL interactive view — a live markmap SVG, centered.
  await expect(overlay.locator(".note-diagram-markmap svg")).toBeVisible({ timeout: 15_000 });
  await expect(overlay.locator(".sv-focus-type")).toHaveText("markmap");

  // Esc closes the overlay.
  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);
});

// —— Phase 2: video (embed + local-asset Range) ————————————————————————————

test("composer auto-detects a BARE YouTube link as a video embed, and the saved note renders a provider <iframe>", async ({
  page,
  request
}) => {
  const title = `Video Embed ${Date.now()}`;
  const source = await seedHtmlSource(request, title, "<article><p>Body about videos.</p></article>");

  // Composer LIVE-classifies a bare provider URL as `video` (the Phase 2 rule).
  await openSource(page, title);
  await page.locator(".composer-mode .mode-tab", { hasText: "Note" }).click();
  await page.locator(".composer-input").fill("https://youtu.be/dQw4w9WgXcQ");
  await expect(page.locator(".composer-detected-label strong")).toHaveText("video");

  // Seed the embed note via the API (the same {kind:'embed',…} the classifier shapes)
  // so the assertion targets the RENDER deterministically.
  const noteRes = await request.post(`${SERVER}/api/notes`, {
    data: {
      sourceId: source.id,
      contentType: "video",
      content: {
        kind: "embed",
        provider: "youtube",
        videoId: "dQw4w9WgXcQ",
        url: "https://youtu.be/dQw4w9WgXcQ"
      }
    }
  });
  expect(noteRes.ok(), `create video embed note failed: ${noteRes.status()}`).toBeTruthy();

  await openSource(page, title);
  const card = page.locator(".note-list .record-card", { hasText: "video" }).first();
  await expect(card).toBeVisible();
  // The note renders IN ITS FORM: a provider <iframe> pointing at the embed player.
  const iframe = card.locator("iframe.sv-video-embed-frame");
  await expect(iframe).toBeVisible();
  await expect(iframe).toHaveAttribute("src", "https://www.youtube.com/embed/dQw4w9WgXcQ");
});

test("GET /api/assets/:id honors HTTP Range: 206 + correct Content-Range for a sub-range, 416 past EOF", async ({
  request
}) => {
  // Import a small local file as an asset, then exercise the Range path on it. We use
  // this very spec file as the source bytes (it always exists on disk).
  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  const url = await import("node:url");
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const absPath = path.join(here, "adaptive-note-forms.spec.ts");
  const total = (await fs.stat(absPath)).size;

  const importRes = await request.post(`${SERVER}/api/assets/local-file`, { data: { path: absPath } });
  expect(importRes.ok(), `import asset failed: ${importRes.status()}`).toBeTruthy();
  const assetId = (await importRes.json()).asset.id as string;

  // (1) A sub-range → 206 with Accept-Ranges + an exact Content-Range + sliced length.
  const partial = await request.get(`${SERVER}/api/assets/${assetId}`, { headers: { Range: "bytes=0-9" } });
  expect(partial.status()).toBe(206);
  expect(partial.headers()["accept-ranges"]).toBe("bytes");
  expect(partial.headers()["content-range"]).toBe(`bytes 0-9/${total}`);
  expect(partial.headers()["content-length"]).toBe("10");
  expect((await partial.body()).length).toBe(10);

  // (2) A range entirely past EOF → 416 with `Content-Range: bytes */total`.
  const past = await request.get(`${SERVER}/api/assets/${assetId}`, {
    headers: { Range: `bytes=${total + 100}-${total + 200}` }
  });
  expect(past.status()).toBe(416);
  expect(past.headers()["content-range"]).toBe(`bytes */${total}`);

  // (3) No Range → 200 full body, with Accept-Ranges advertised.
  const full = await request.get(`${SERVER}/api/assets/${assetId}`);
  expect(full.status()).toBe(200);
  expect(full.headers()["accept-ranges"]).toBe("bytes");
  expect((await full.body()).length).toBe(total);
});
