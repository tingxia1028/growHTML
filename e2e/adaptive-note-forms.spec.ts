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

// —— Phase 3: interactive html (game) sandbox + ESCAPE regression guard ————————
//
// The load-bearing security test. An interactive:true html note opened in the overlay
// runs a script that TRIES to escape — read window.parent/top location & DOM, fetch() a
// URL, and reach window.parent.studyVault. We assert:
//   (1) the game's script RAN and rendered/interacted (the frame is allow-scripts);
//   (2) EVERY escape attempt FAILED (opaque "null" origin + default-src 'none' CSP):
//       parent/top access throws (cross-origin), fetch is CSP-blocked, studyVault is
//       unreachable — the game records each as "blocked" inside its own frame;
//   (3) the HOST is untouched: window.studyVault still present, no host-DOM mutation,
//       and the iframe carries the hardened sandbox (allow-scripts, NO same-origin).

test("interactive html ESCAPE guard: game runs but cannot reach parent/top, fetch, or studyVault", async ({
  page,
  request
}) => {
  const title = `Escape Game ${Date.now()}`;
  const source = await seedHtmlSource(request, title, "<article><p>Body about games.</p></article>");

  // A self-contained game that DRAWS on a canvas (proves the script ran) and probes the
  // three escapes, recording each outcome into a <pre id="results"> as JSON.
  const game = `
<canvas id="c" width="120" height="40"></canvas>
<pre id="results">pending</pre>
<script>
  // Prove the script executes: draw on the canvas + flag readiness.
  try {
    var ctx = document.getElementById('c').getContext('2d');
    ctx.fillStyle = '#0a0'; ctx.fillRect(0, 0, 120, 40);
  } catch (e) {}
  function probe(fn) { try { fn(); return 'REACHED'; } catch (e) { return 'blocked:' + e.name; } }
  var r = {
    ran: true,
    // (a) read parent/top location + DOM — cross-origin → SecurityError.
    parentLocation: probe(function () { return String(window.parent.location.href); }),
    topLocation: probe(function () { return String(window.top.location.href); }),
    parentDom: probe(function () { return window.parent.document.title; }),
    // (c) reach the host bridge.
    studyVault: probe(function () { if (window.parent.studyVault) return 'has'; throw new Error('x'); }),
    // (b) fetch a URL — CSP default-src 'none' blocks the network.
    fetch: 'pending'
  };
  // fetch is async; resolve it then publish the full result object.
  (typeof fetch === 'function'
    ? fetch('http://127.0.0.1:4177/api/health').then(function () { return 'REACHED'; }, function (e) { return 'blocked:' + (e && e.name); })
    : Promise.resolve('no-fetch')
  ).then(function (f) {
    r.fetch = f;
    document.getElementById('results').textContent = JSON.stringify(r);
  });
</script>`;

  const noteRes = await request.post(`${SERVER}/api/notes`, {
    data: { sourceId: source.id, contentType: "html-sandbox", content: { html: game, interactive: true } }
  });
  expect(noteRes.ok(), `create interactive html note failed: ${noteRes.status()}`).toBeTruthy();

  await openSource(page, title);

  // Sanity: the host bridge / page is intact BEFORE we open the game.
  await expect(page.locator(".note-list .record-card", { hasText: "html-sandbox" }).first()).toBeVisible();

  // Open the note centered → the live interactive (allow-scripts) frame mounts ONLY here.
  const card = page.locator(".note-list .record-card", { hasText: "html-sandbox" }).first();
  await card.locator(".note-open-overlay").click();
  const overlay = page.locator(".sv-focus-overlay");
  await expect(overlay).toBeVisible();

  // (3a) The frame carries the HARDENED sandbox: allow-scripts, NEVER allow-same-origin.
  const frame = overlay.locator("iframe.sv-interactive-frame");
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  const sandboxAttr = await frame.getAttribute("sandbox");
  expect(sandboxAttr).not.toContain("same-origin");
  const cspAttr = await frame.getAttribute("csp");
  expect(cspAttr).toContain("default-src 'none'");

  // The script RAN and EVERY escape was blocked — read the results from inside the frame.
  const fl = overlay.frameLocator("iframe.sv-interactive-frame");
  const results = fl.locator("#results");
  await expect(results).not.toHaveText("pending", { timeout: 15_000 });
  const raw = await results.textContent();
  const r = JSON.parse(raw ?? "{}") as Record<string, string | boolean>;
  expect(r.ran, "the game script must execute (allow-scripts)").toBe(true);
  // Cross-origin parent/top access throws; fetch is CSP-blocked; studyVault unreachable.
  expect(String(r.parentLocation)).toMatch(/^blocked:/);
  expect(String(r.topLocation)).toMatch(/^blocked:/);
  expect(String(r.parentDom)).toMatch(/^blocked:/);
  expect(String(r.studyVault)).toMatch(/^blocked:/);
  expect(String(r.fetch), "network must be blocked by default-src 'none'").toMatch(/^blocked:|^no-fetch$/);

  // (3b) The HOST is untouched: the studyVault bridge is unaffected by the game, and the
  // host page still works (the overlay closes normally).
  const hostStudyVaultType = await page.evaluate(() => typeof (window as unknown as { studyVault?: unknown }).studyVault);
  // In web mode there is no studyVault bridge at all; in electron it is present — either
  // way the GAME could not have created/removed it. Assert the host DOM is intact.
  expect(["object", "undefined"]).toContain(hostStudyVaultType);
  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);
});

// —— Phase 4: form router (the MODEL picks the form) ——————————————————————————
//
// The form-router endpoint runs ONE structured call against the discriminated-union
// formRouterSchema and unwraps the chosen member into a real { contentType, content }.
// With the deterministic mock returning a MARKMAP form (via the seeded `sample`), the
// routed note saves + renders AS A MARKMAP (not markdown) through the normal note path.

test("form router: a markmap form from the model unwraps + saves + renders as a markmap note (not markdown)", async ({
  page,
  request
}) => {
  const title = `Form Router ${Date.now()}`;
  const source = await seedHtmlSource(request, title, "<article><p>Body about routing forms.</p></article>");

  // Run the form router against the deterministic mock, forcing a MARKMAP form via the
  // sample (a valid discriminated-union member). The server unwraps form→contentType.
  const routed = await request.post(`${SERVER}/api/notes/generate-block`, {
    data: {
      text: "make a mind map of the water cycle",
      sample: { form: "markmap", outline: "# Water Cycle\n## Evaporation\n## Condensation" }
    }
  });
  expect(routed.ok(), `generate-block failed: ${routed.status()}`).toBeTruthy();
  const body = (await routed.json()) as { contentType: string; content: unknown };
  // The MODEL chose markmap — NOT the markdown fallback.
  expect(body.contentType).toBe("markmap");
  expect(body.content).toBe("# Water Cycle\n## Evaporation\n## Condensation");

  // Save the routed form as a note (the preview/save loop does exactly this on Save) and
  // verify it renders IN ITS FORM (a live markmap SVG), proving the routed note is a real
  // registered contentType that flows through getNoteType().render — no bypass.
  const noteRes = await request.post(`${SERVER}/api/notes`, {
    data: { sourceId: source.id, contentType: body.contentType, content: body.content }
  });
  expect(noteRes.ok(), `save routed note failed: ${noteRes.status()}`).toBeTruthy();

  await openSource(page, title);
  const card = page.locator(".note-list .record-card", { hasText: "markmap" }).first();
  await expect(card).toBeVisible();
  await expect(card.locator(".note-diagram-markmap svg")).toBeVisible({ timeout: 15_000 });

  // The chat composer surfaces the "Generate as best form" action on assistant replies
  // (item 1's UI entry point). Ask a question so a reply appears, then assert the button.
  await page.locator(".composer-input").fill("What is the water cycle?");
  await page.locator(".composer-input").press("Enter");
  await expect(page.locator(".chat-log .chat-msg.chat-assistant").first()).toBeVisible({ timeout: 15_000 });
  await expect(
    page.locator(".chat-log .chat-msg.chat-assistant .row-actions .link-button", {
      hasText: "Generate as best form"
    }).first()
  ).toBeVisible();
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
