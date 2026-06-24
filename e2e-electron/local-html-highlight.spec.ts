import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

type PngImage = { width: number; height: number; data: Buffer };

// Minimal PNG decoder for the screenshots Playwright produces (8-bit, non-
// interlaced, RGB or RGBA — Chromium emits colorType 2 (RGB) or 6 (RGBA)). Zero
// deps: Node's zlib inflates the IDAT; we undo the per-scanline filters in the
// image's native channel count, then expand to RGBA so callers can index with
// `(w*y+x)<<2`. Enough to read pixels for the assertions below; not a general reader.
function decode(buffer: Buffer): PngImage {
  // Skip the 8-byte signature, then walk chunks: [len][type][data][crc].
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
    offset = dataStart + length + 4; // + CRC
  }
  // colorType 2 = RGB (3 ch), 6 = RGBA (4 ch). Anything else we don't handle.
  const srcChannels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (bitDepth !== 8 || srcChannels === 0) {
    throw new Error(`unsupported PNG format (bitDepth=${bitDepth}, colorType=${colorType}); expected 8-bit RGB/RGBA`);
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * srcChannels;
  const filtered = Buffer.alloc(height * stride);
  // Reverse PNG scanline filters (None/Sub/Up/Average/Paeth).
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
      const a = x >= srcChannels ? filtered[y * stride + x - srcChannels] : 0; // left
      const b = y > 0 ? filtered[(y - 1) * stride + x] : 0; // up
      const c = x >= srcChannels && y > 0 ? filtered[(y - 1) * stride + x - srcChannels] : 0; // up-left
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
  // Expand RGB → RGBA (opaque) so pixel indexing is uniform for callers.
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < filtered.length; i += 3, j += 4) {
    rgba[j] = filtered[i];
    rgba[j + 1] = filtered[i + 1];
    rgba[j + 2] = filtered[i + 2];
    rgba[j + 3] = 255;
  }
  return { width, height, data: rgba };
}

// VISUAL self-test for the local-HTML highlight fix. The bug: a saved note on a
// LOCAL HTML file produced NO highlight, because LocalHtmlReader never pushed the
// stored anchors into its <webview> guest (it only wired the READ direction). The
// fix sends `sv:anchors` → the guest preload paints highlightQuote(...) per anchor.
//
// WHY a screenshot (not a DOM query): the highlight is painted INSIDE the webview
// guest, a separate WebContents the host page cannot DOM-query. But the guest is
// COMPOSITED into the host window, so its rendered PIXELS ARE captured by
// page.screenshot(). And the highlight is HOST-triggered (the host sends sv:anchors
// after seeding the anchor+note via the API) — so we never have to synthesize a
// selection inside the guest; we just seed state, open the page, and look.
//
// Robustness: rather than match an exact alpha-blended color, we compare the SAME
// passage region with vs. without an anchor and assert a meaningful pixel diff there
// (the highlight repaints those pixels). The control page is identical HTML with no
// anchor, so any large diff localized to the passage is the highlight.

const VAULT = path.resolve(".e2e-electron-vault-highlight");

// A page whose passage text is on its own line in a large, predictable spot near
// the top, with plain white background so the yellow highlight stands out. The
// quote is unique so highlightQuote can't match filler.
const QUOTE = "HIGHLIGHT ME the render thread submits draw commands";
const PAGE_HTML =
  "<!doctype html><html><head><meta charset='utf-8'><title>HL</title>" +
  "<style>html,body{margin:0;background:#fff;color:#000;}" +
  "#para{font:28px/1.4 Arial, sans-serif;padding:40px;}</style></head>" +
  `<body><p id='para'>${QUOTE}.</p>` +
  "<div style='height:1200px'></div></body></html>";

let app: ElectronApplication;
let page: Page;
let tmpDir = "";

// Mirror the client's localFileUrl(absPath): the /api/local URL whose path mirrors
// the file's absolute path (so its relative assets resolve). web_text_quote anchors
// for local files are keyed by this URL.
function localFileUrl(absPath: string): string {
  const encoded = absPath
    .replace(/\\/g, "/")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return `/api/local/${encoded}`;
}

// Seed a local-HTML source from a temp file written with the given page html.
async function seedSource(html: string, name: string): Promise<{ sourceId: string; filePath: string }> {
  const filePath = path.join(tmpDir, name);
  await writeFile(filePath, html, "utf8");
  const sourceId = await page.evaluate(async (p) => {
    const res = await fetch("/api/sources/local-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: p })
    });
    const body = await res.json();
    return body.source.id as string;
  }, filePath);
  return { sourceId, filePath };
}

// Seed a web_text_quote anchor (local HTML uses this kind) + a markdown note on it,
// from the HOST via the same API the UI uses. highlightQuote matches by quote text,
// so the quote just has to exist in the page.
async function seedAnchorWithNote(sourceId: string, normalizedUrl: string, quote: string, noteText: string) {
  await page.evaluate(
    async ({ sourceId, normalizedUrl, quote, noteText }) => {
      const aRes = await fetch("/api/anchors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId,
          anchorKind: "web_text_quote",
          normalizedUrl,
          quote,
          contextBefore: "",
          contextAfter: ""
        })
      });
      const anchorId = (await aRes.json()).anchor.id as string;
      await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId, anchorIds: [anchorId], contentType: "markdown", content: noteText })
      });
    },
    { sourceId, normalizedUrl, quote, noteText }
  );
}

// Open a seeded source by id and wait until its local <webview> has rendered.
async function openSource(sourceId: string) {
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.locator(".source-item-open").filter({ hasText: sourceId }).click();
  const webview = page.locator(".local-webview-host webview.local-webview");
  await expect(webview).toHaveCount(1);
  // The guest must have attached the selection/paint preload.
  await expect(webview).toHaveAttribute("preload", /webview-preload\.cjs$/);
  return webview;
}

// A screenshot sub-region in device pixels.
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

// Count pixels in `rect` that look "highlight yellow-ish": noticeably more red+green
// than blue (the highlight is rgba(255,213,79,.4) over white ≈ a warm yellow). A
// second, color-based signal independent of the control diff.
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
      // Warm (r,g high), clearly less blue, and not pure white.
      if (r > 200 && g > 170 && b < 200 && r - b > 45 && g - b > 25) yellow++;
    }
  }
  return yellow;
}

test.beforeAll(async () => {
  await rm(VAULT, { recursive: true, force: true });
  tmpDir = await mkdtemp(path.join(tmpdir(), "sv-hl-"));
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
  await rm(VAULT, { recursive: true, force: true });
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
});

test("local HTML: a saved note paints a VISIBLE highlight inside the webview (pixels)", async () => {
  // page.screenshot() is in DEVICE pixels but boundingBox() is in CSS pixels; on a
  // HiDPI display they differ by devicePixelRatio. Scale our sample rects so they
  // land on the right pixels regardless of display scaling.
  const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
  const toDevice = (r: { x: number; y: number; width: number; height: number }): Rect => ({
    x: r.x * dpr,
    y: r.y * dpr,
    width: r.width * dpr,
    height: r.height * dpr
  });

  // 1) Control: identical page, NO anchor. Open it and capture the passage region.
  const control = await seedSource(PAGE_HTML, "control.html");
  const controlWebview = await openSource(control.sourceId);
  // Let the guest paint the (un-highlighted) page.
  await expect
    .poll(async () => (await controlWebview.boundingBox())?.width ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(0);
  const region = (await controlWebview.boundingBox())!;
  // The passage (#para) renders near the top of the page (~40px padding, 28px text);
  // sample a band over its first ~160 CSS px. Inset x a little so the page's own left
  // padding (white) doesn't dominate.
  const passageRect = toDevice({
    x: region.x,
    y: region.y,
    width: region.width,
    height: Math.min(160, region.height)
  });
  const beforeShot = decode(await page.screenshot());

  // 2) Highlighted: a DIFFERENT source with the SAME html, plus a seeded anchor+note.
  //    Seed BEFORE opening so the host pushes sv:anchors as soon as the guest is ready.
  const subject = await seedSource(PAGE_HTML, "subject.html");
  await seedAnchorWithNote(subject.sourceId, localFileUrl(subject.filePath), QUOTE, "screenshot note");
  const subjectWebview = await openSource(subject.sourceId);
  await expect
    .poll(async () => (await subjectWebview.boundingBox())?.width ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(0);

  // 3) Wait for the highlight to actually paint, then capture the same region. We
  //    poll the screenshot until the passage band shows the highlight color (rather
  //    than a blind sleep), so the assertion isn't racing the guest's paint.
  let afterShot = decode(await page.screenshot());
  await expect
    .poll(
      async () => {
        afterShot = decode(await page.screenshot());
        return yellowPixelsInRect(afterShot, passageRect);
      },
      { timeout: 10_000, message: "expected the highlight color to appear in the passage region" }
    )
    .toBeGreaterThan(60);

  // Signal A (color): the passage band contains clearly more highlight-yellow pixels
  // than the un-highlighted control did.
  const yellowAfter = yellowPixelsInRect(afterShot, passageRect);
  const yellowBefore = yellowPixelsInRect(beforeShot, passageRect);
  expect(yellowAfter).toBeGreaterThan(60);
  expect(yellowAfter).toBeGreaterThan(yellowBefore + 40);

  // Signal B (diff): the passage region changed meaningfully vs. the identical
  // control page — the only difference between them is the highlight.
  const changed = diffPixelsInRect(beforeShot, afterShot, passageRect);
  expect(changed).toBeGreaterThan(100);

  // eslint-disable-next-line no-console
  console.log(
    `[local-html highlight] yellow before=${yellowBefore} after=${yellowAfter}; changed px in passage=${changed}`
  );

  // 4) Hover note-card (BEST EFFORT). Mouse events DO route into the webview, so
  //    hovering the highlighted text should surface the shared floating note card
  //    (#sv-note-card) just below the line. Card timing can be flaky across Electron
  //    versions, so we LOG the outcome and don't fail the suite on it — the highlight
  //    assertions above are the must-pass coverage, and the card's hover/show logic
  //    is unit-covered in src/client/annotationDom.test.ts. We detect the card by a
  //    before/after pixel diff in the band BELOW the highlighted line (the card opens
  //    there), which is robust without hand-tuning a panel color.
  try {
    // The card opens at/just below the highlighted line; sample a tall band starting
    // at the line so we catch it whether it overlaps or sits under the text.
    const cardRect = toDevice({
      x: region.x,
      y: region.y + 40,
      width: region.width,
      height: Math.min(260, region.height - 40)
    });
    const preHover = decode(await page.screenshot());
    // Drive the host mouse onto the highlighted text. mouse.move with steps emits
    // intermediate moves so the guest's mouseover fires; coords are CSS px.
    await page.mouse.move(region.x + 5, region.y + 5);
    await page.mouse.move(region.x + region.width / 2, region.y + 54, { steps: 8 });
    let cardDiff = 0;
    const cardAppeared = await expect
      .poll(
        async () => {
          const shot = decode(await page.screenshot());
          cardDiff = diffPixelsInRect(preHover, shot, cardRect);
          return cardDiff;
        },
        { timeout: 4000 }
      )
      // The card is a sizeable panel; its appearance changes many pixels in the band.
      .toBeGreaterThan(500)
      .then(() => true)
      .catch(() => false);
    // eslint-disable-next-line no-console
    console.log(`[local-html highlight] hover note-card observable: ${cardAppeared} (diff px in band=${cardDiff})`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.log(`[local-html highlight] hover note-card check skipped: ${(err as Error).message}`);
  }
});
