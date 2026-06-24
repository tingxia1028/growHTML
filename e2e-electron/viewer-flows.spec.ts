import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

// COMPREHENSIVE per-viewer study-flow self-test for the two WEBVIEW surfaces that
// can only run in the real Electron app: LIVE HTML (web_live, WebviewReader) and
// LOCAL HTML (LocalHtmlReader). The iframe (imported HTML) and PDF surfaces render
// in the host page and are covered by the web config (e2e/viewer-flows web part +
// loop.spec.ts + regions.spec.ts); here we exercise the parts a host page can't.
//
// For EACH webview viewer we drive the FULL basic study flow:
//   1. select a passage INSIDE the guest  → the host "Source" chip (.chat-source) fills
//   2. save a Note (composer Note mode)    → it appears in the host .note-list
//   3. an anchor was actually created       → assert GET /api/sources/:id/anchors has a
//                                              web_text_quote anchor for the right url
//   4. the saved note PAINTS as a highlight  → screenshot pixels in the passage region
//
// KEY TECHNIQUE (corrects the earlier "can't drive a webview selection" assumption):
// the <webview> element exposes executeJavaScript(code) that runs IN THE GUEST, where
// the guest preload (electron/webview-preload.ts) listens for `mouseup`. So we build a
// real Range over a known text node and dispatch `new MouseEvent('mouseup',{bubbles})`
// — exactly what e2e/regions.spec.ts does for the PDF text layer. That fires the
// guest's reportSelection → `sv:selection` IPC → host bindWebviewSelection → chip. The
// chip + note list live in the HOST DOM, so Playwright sees them even for a webview.

// ——————————————————————————————————————————————————————————————————————
// Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced) for screenshot pixels — same
// approach as local-html-highlight.spec.ts (kept local; this is not a general reader).
type PngImage = { width: number; height: number; data: Buffer };
function decode(buffer: Buffer): PngImage {
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    if (type === "IHDR") {
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      bitDepth = buffer[dataStart + 8];
      colorType = buffer[dataStart + 9];
    } else if (type === "IDAT") {
      idat.push(buffer.subarray(dataStart, dataStart + length));
    } else if (type === "IEND") {
      break;
    }
    offset = dataStart + length + 4;
  }
  const srcChannels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (bitDepth !== 8 || srcChannels === 0) {
    throw new Error(`unsupported PNG format (bitDepth=${bitDepth}, colorType=${colorType})`);
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * srcChannels;
  const filtered = Buffer.alloc(height * stride);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filterType = raw[y * (stride + 1)];
    const rowStart = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[rowStart + x];
      const a = x >= srcChannels ? filtered[y * stride + x - srcChannels] : 0;
      const b = y > 0 ? filtered[(y - 1) * stride + x] : 0;
      const c = x >= srcChannels && y > 0 ? filtered[(y - 1) * stride + x - srcChannels] : 0;
      let value: number;
      switch (filterType) {
        case 0:
          value = rawByte;
          break;
        case 1:
          value = rawByte + a;
          break;
        case 2:
          value = rawByte + b;
          break;
        case 3:
          value = rawByte + ((a + b) >> 1);
          break;
        case 4:
          value = rawByte + paeth(a, b, c);
          break;
        default:
          throw new Error(`unsupported PNG filter ${filterType}`);
      }
      filtered[y * stride + x] = value & 0xff;
    }
  }
  if (srcChannels === 4) return { width, height, data: filtered };
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < filtered.length; i += 3, j += 4) {
    rgba[j] = filtered[i];
    rgba[j + 1] = filtered[i + 1];
    rgba[j + 2] = filtered[i + 2];
    rgba[j + 3] = 255;
  }
  return { width, height, data: rgba };
}

type Rect = { x: number; y: number; width: number; height: number };

// Count pixels in `rect` that differ meaningfully between two same-size screenshots.
function diffPixelsInRect(a: PngImage, b: PngImage, rect: Rect): number {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(a.width, b.width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(a.height, b.height, Math.ceil(rect.y + rect.height));
  let changed = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const ia = (a.width * y + x) << 2;
      const ib = (b.width * y + x) << 2;
      const dr = Math.abs(a.data[ia] - b.data[ib]);
      const dg = Math.abs(a.data[ia + 1] - b.data[ib + 1]);
      const db = Math.abs(a.data[ia + 2] - b.data[ib + 2]);
      if (dr + dg + db > 40) changed++;
    }
  }
  return changed;
}

// Count "highlight yellow-ish" pixels (the highlight is rgba(255,213,79,.4) over
// white ≈ a warm yellow). Same predicate as local-html-highlight.spec.ts.
function yellowPixelsInRect(png: PngImage, rect: Rect): number {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(png.width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(png.height, Math.ceil(rect.y + rect.height));
  let yellow = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (png.width * y + x) << 2;
      const r = png.data[i];
      const g = png.data[i + 1];
      const b = png.data[i + 2];
      if (r > 200 && g > 170 && b < 200 && r - b > 45 && g - b > 25) yellow++;
    }
  }
  return yellow;
}

// ——————————————————————————————————————————————————————————————————————
const VAULT = path.resolve(".e2e-electron-vault-flows");

// A page with a unique passage on its own line near the top, white background so
// the yellow highlight stands out, and tall filler so it scrolls like a real page.
const QUOTE = "PASSAGE the render thread submits draw commands every frame";
const PAGE_HTML =
  "<!doctype html><html><head><meta charset='utf-8'><title>Flow</title>" +
  "<style>html,body{margin:0;background:#fff;color:#000;}" +
  "#para{font:26px/1.4 Arial, sans-serif;padding:36px;}</style></head>" +
  `<body><p id='para'>${QUOTE}.</p><div style='height:1200px'></div></body></html>`;

let app: ElectronApplication;
let page: Page;
let tmpDir = "";
let fixture: Server;
let fixtureOrigin = ""; // http://127.0.0.1:PORT (no trailing slash)

// Mirror App.tsx localFileUrl(absPath): the /api/local url whose path mirrors the
// file's absolute path. web_text_quote anchors for local files are keyed by this.
function localFileUrl(absPath: string): string {
  const encoded = absPath
    .replace(/\\/g, "/")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return `/api/local/${encoded}`;
}

// Drive a REAL text selection inside a guest <webview> via executeJavaScript: build a
// Range over #para, set the selection, and dispatch a bubbling mouseup so the guest
// preload's reportSelection fires. Returns whether the script ran. The `selector`
// targets the host <webview> element (executeJavaScript runs in its guest).
async function selectInGuest(webviewSelector: string): Promise<boolean> {
  return page
    .evaluate(async (sel) => {
      const view = document.querySelector(sel) as
        | (HTMLElement & { executeJavaScript: (code: string) => Promise<unknown> })
        | null;
      if (!view) return false;
      // Poll inside the guest until #para exists, then select it and fire a bubbling
      // mouseup (the guest listens on document for 'mouseup'). Returns the selected
      // string so we can assert the guest really had the text.
      const result = await view.executeJavaScript(
        "(function(){" +
          "var p=document.getElementById('para');" +
          "if(!p) return '';" +
          "var r=document.createRange();r.selectNodeContents(p);" +
          "var s=window.getSelection();s.removeAllRanges();s.addRange(r);" +
          "var picked=s.toString();" +
          "p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));" +
          "document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));" +
          "return picked;})()"
      );
      return typeof result === "string" && result.length > 0;
    }, webviewSelector)
    .catch(() => false);
}

// Drive the guest selection repeatedly until the HOST "Source" chip reflects it, then
// assert the chip. Retrying absorbs the guest still loading (#para not present yet) or
// a single mouseup being dropped while the guest attaches — the chip filling is the
// authoritative proof that select→sv:selection→host wiring works for this surface.
async function selectUntilChip(webviewSelector: string) {
  const chip = page.locator(".chat-source .chat-source-quote");
  await expect
    .poll(
      async () => {
        await selectInGuest(webviewSelector);
        return chip
          .textContent({ timeout: 1000 })
          .catch(() => "");
      },
      { timeout: 20_000, message: "the host Source chip should reflect the guest selection" }
    )
    .toContain("render thread");
}

// Save a note via the composer (Note mode) and confirm it lands in the host note list.
async function saveNote(text: string) {
  await page.locator(".composer-mode .mode-tab", { hasText: "Note" }).click();
  await page.locator(".composer-input").fill(text);
  await page.getByRole("button", { name: "Save Note" }).click();
  await expect(page.locator(".note-list")).toContainText(text);
}

// Fetch the stored anchors for a source from the HOST (same API the UI uses).
async function fetchAnchors(sourceId: string) {
  return page.evaluate(async (id) => {
    const res = await fetch(`/api/sources/${id}/anchors`);
    return (await res.json()).anchors as Array<{ anchorKind: string; normalizedUrl?: string; quote?: string }>;
  }, sourceId);
}

// Poll a screenshot of the given webview's bounding box until the passage band shows
// the highlight color; returns the max yellow count seen (asserted by the caller).
async function highlightYellowInPassage(webview: ReturnType<Page["locator"]>): Promise<number> {
  const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
  await expect.poll(async () => (await webview.boundingBox())?.width ?? 0, { timeout: 10_000 }).toBeGreaterThan(0);
  const box = (await webview.boundingBox())!;
  const passageRect: Rect = {
    x: box.x * dpr,
    y: box.y * dpr,
    width: box.width * dpr,
    height: Math.min(160, box.height) * dpr
  };
  let best = 0;
  await expect
    .poll(
      async () => {
        const shot = decode(await page.screenshot());
        best = Math.max(best, yellowPixelsInRect(shot, passageRect));
        return best;
      },
      { timeout: 10_000, message: "expected the highlight color to appear in the passage region" }
    )
    .toBeGreaterThan(60);
  return best;
}

// BEST EFFORT: hover the highlighted line and look for the shared floating note card
// (#sv-note-card) appearing just below it, via a before/after pixel diff in that band.
// The card is painted inside the guest and is timing-flaky across Electron versions
// (the existing local-html-highlight.spec.ts also only logs it), so we LOG the outcome
// and return it rather than asserting — the card's hover/show logic is unit-covered in
// src/client/annotationDom.test.ts. Returns whether a card-sized change was observed.
async function hoverCardObservable(webview: ReturnType<Page["locator"]>, label: string): Promise<boolean> {
  try {
    const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
    const box = (await webview.boundingBox())!;
    const cardRect: Rect = {
      x: box.x * dpr,
      y: (box.y + 40) * dpr,
      width: box.width * dpr,
      height: Math.min(260, box.height - 40) * dpr
    };
    const before = decode(await page.screenshot());
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.move(box.x + box.width / 2, box.y + 50, { steps: 8 });
    let diff = 0;
    const seen = await expect
      .poll(
        async () => {
          diff = diffPixelsInRect(before, decode(await page.screenshot()), cardRect);
          return diff;
        },
        { timeout: 4000 }
      )
      .toBeGreaterThan(500)
      .then(() => true)
      .catch(() => false);
    // eslint-disable-next-line no-console
    console.log(`[viewer-flows ${label}] hover note-card observable: ${seen} (diff px in band=${diff})`);
    return seen;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.log(`[viewer-flows ${label}] hover note-card check skipped: ${(err as Error).message}`);
    return false;
  }
}

test.beforeAll(async () => {
  await rm(VAULT, { recursive: true, force: true });
  tmpDir = await mkdtemp(path.join(tmpdir(), "sv-flows-"));

  // A local HTTP fixture so "live HTML" (web_live) is deterministic + offline. We
  // serve the SAME passage HTML at a non-root path so the URL has a real path
  // segment (the case where normalizeUrl vs. getURL trailing-slash handling differs).
  fixture = createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(PAGE_HTML);
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", () => resolve()));
  const address = fixture.address();
  const port = typeof address === "object" && address ? address.port : 0;
  fixtureOrigin = `http://127.0.0.1:${port}`;

  app = await electron.launch({
    args: ["dist-electron/main.cjs"],
    env: { ...process.env, STUDY_VAULT_ROOT: VAULT }
  });
  page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator(".brand-block h1")).toHaveText("Sources");
});

test.afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => fixture.close(() => resolve()));
  await rm(VAULT, { recursive: true, force: true });
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
});

// ——————————————————————————————————————————————————————————————————————
// LOCAL HTML (LocalHtmlReader) — full flow: select → chip → note → anchor → highlight.
test("local HTML viewer: select in guest → chip → save note → anchor created → highlight paints", async () => {
  const filePath = path.join(tmpDir, "local-flow.html");
  await writeFile(filePath, PAGE_HTML, "utf8");
  const sourceId = await page.evaluate(async (p) => {
    const res = await fetch("/api/sources/local-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: p })
    });
    return (await res.json()).source.id as string;
  }, filePath);

  await page.getByRole("button", { name: "Refresh" }).click();
  await page.locator(".source-item-open").filter({ hasText: sourceId }).click();

  const webview = page.locator(".local-webview-host webview.local-webview");
  await expect(webview).toHaveCount(1);
  await expect(webview).toHaveAttribute("preload", /webview-preload\.cjs$/);

  // STEP 1 — drive a REAL selection inside the guest; the host chip must fill in.
  await selectUntilChip(".local-webview-host webview.local-webview");

  // STEP 2 — save a Note; it lands in the host note list.
  await saveNote("Local flow note.");

  // STEP 3 — an anchor was actually created: a web_text_quote keyed by the /api/local
  // url (local HTML can't be html_selection — stored raw, no study-ids).
  const anchors = await fetchAnchors(sourceId);
  const webAnchor = anchors.find((a) => a.anchorKind === "web_text_quote");
  expect(webAnchor, "expected a web_text_quote anchor for the local file").toBeTruthy();
  expect(webAnchor!.normalizedUrl).toBe(localFileUrl(filePath));
  expect(webAnchor!.quote).toContain("render thread");

  // STEP 4 — the saved note paints as a highlight inside the guest (pixels).
  const yellow = await highlightYellowInPassage(webview);
  // eslint-disable-next-line no-console
  console.log(`[viewer-flows local] anchor=${webAnchor!.anchorKind} highlight yellow px=${yellow}`);

  // STEP 5 (best effort, logged) — hovering the highlight surfaces the note card.
  await hoverCardObservable(webview, "local");
});

// ——————————————————————————————————————————————————————————————————————
// LIVE HTML (web_live, WebviewReader) — full flow + the "no anchor" bug repro. The
// passage is served at a NON-root path so the live page url has a path segment.
test("live HTML viewer: select in guest → chip → save note → anchor created → highlight paints", async () => {
  const liveUrl = `${fixtureOrigin}/lesson`;
  await page.locator("section.url-import-box input").fill(liveUrl);
  await page.locator("section.url-import-box").getByRole("button", { name: "Open Live" }).click();

  // The web_live source becomes active and renders a <webview> in the tabbed reader.
  const webview = page.locator(".webview-host webview");
  await expect(webview).toHaveCount(1);
  await expect(webview).toHaveAttribute("preload", /webview-preload\.cjs$/);
  // The active source id (so we can fetch its anchors). It's shown in the source list.
  const sourceId = await page.evaluate(async () => {
    const res = await fetch("/api/sources");
    const sources = (await res.json()).sources as Array<{ id: string; sourceType: string }>;
    return sources.find((s) => s.sourceType === "web_live")!.id;
  });

  // Wait for the live page to actually load its passage before selecting (the guest
  // must have #para). The address bar settling to the loaded URL is a good proxy.
  await expect(page.getByRole("textbox", { name: "Address" })).toHaveValue(/127\.0\.0\.1/);

  // STEP 1 — drive a REAL selection inside the live guest; the host chip must fill in.
  // (Before the WebviewReader preload-ordering fix this NEVER filled — the live page
  // loaded without the selection-capture preload, so no sv:selection ever reached the
  // host. That missing chip is exactly the reported "no anchor" symptom for live HTML.)
  await selectUntilChip(".webview-host webview");

  // STEP 2 — save a Note.
  await saveNote("Live flow note.");

  // STEP 3 — THE BUG: a web_text_quote anchor must actually be created. Before the
  // fix, an empty webview.getURL() at selection time produced `normalizedUrl: ""` →
  // the server rejected it (400) and NO anchor existed here.
  const anchors = await fetchAnchors(sourceId);
  const webAnchor = anchors.find((a) => a.anchorKind === "web_text_quote");
  expect(
    webAnchor,
    "expected a web_text_quote anchor for the live source (the live-HTML 'no anchor' bug)"
  ).toBeTruthy();
  expect(webAnchor!.quote).toContain("render thread");
  // The anchor's url is non-empty and points at the live host (either the live page
  // url from getURL(), or the source's stored normalizedUrl via the fallback).
  expect(webAnchor!.normalizedUrl, "anchor normalizedUrl must not be blank").toBeTruthy();
  expect(webAnchor!.normalizedUrl).toContain("127.0.0.1");

  // STEP 4 — the saved note paints as a highlight inside the live guest (pixels).
  const yellow = await highlightYellowInPassage(webview);
  // eslint-disable-next-line no-console
  console.log(
    `[viewer-flows live] anchor=${webAnchor!.anchorKind} normalizedUrl=${webAnchor!.normalizedUrl} highlight yellow px=${yellow}`
  );

  // STEP 5 (best effort, logged) — hovering the highlight surfaces the note card.
  await hoverCardObservable(webview, "live");
});
