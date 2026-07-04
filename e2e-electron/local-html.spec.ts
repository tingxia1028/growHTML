import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  closeApp,
  launchApp,
  openSourceByTitle,
  seedLocalFileSource,
  selectInGuest,
  type LaunchedApp
} from "./harness";

// Drives the REAL Electron app's LOCAL HTML path: ingest a local .html file → it
// renders in a persistent <webview> (LocalHtmlReader). The fix under test is that
// this webview carries the SAME selection-capture guest preload as the live-web
// webview, so selecting text in a local page reaches the host as an AnchorDraft
// (surfacing in the right sidebar's Anchor tab — the old `.chat-source` chip died
// with the Growte IA rebuild).
//
// NOTE (documented limitation): Playwright cannot reliably synthesize a real text
// selection INSIDE an Electron <webview> guest from the OUTSIDE. We drive it via
// webview.executeJavaScript (best effort, logged) — the wiring assertion (preload
// attached) is the hard gate; the full select→focus→note→highlight flow is the
// e2e-electron/viewer-flows.spec.ts job.

let handle: LaunchedApp;
let page: Page;
let tmpDir = "";
let htmlPath = "";

test.beforeAll(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "sv-localhtml-"));
  htmlPath = path.join(tmpDir, "lesson.html");
  await writeFile(
    htmlPath,
    "<!doctype html><html><head><title>Lesson</title></head><body><h1>Lesson</h1>" +
      "<p id='para'>The render thread submits draw commands every frame.</p></body></html>",
    "utf8"
  );
  handle = await launchApp("local-html");
  page = handle.page;
});

test.afterAll(async () => {
  await closeApp(handle);
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
});

test("local HTML: renders in a <webview> with the selection-capture guest preload attached", async () => {
  // Ingest the local .html file through the in-process API the desktop UI uses,
  // then open it from the Library (refresh icon — the top-level Refresh is gone).
  const seeded = await seedLocalFileSource(page, htmlPath);
  await openSourceByTitle(page, seeded.title);

  // The LocalHtmlReader mounts a single persistent <webview> in its host element.
  const webview = page.locator(".local-webview-host webview.local-webview");
  await expect(webview).toHaveCount(1);

  // The fix: the local webview carries the selection-capture guest preload (the
  // same one the live-web webview uses). Without it, selecting text did nothing.
  await expect(webview).toHaveAttribute("preload", /webview-preload\.cjs$/);

  // Best-effort: drive a real selection inside the guest. If the guest reports it,
  // the host's Anchor tab shows the quote. Logged, not failed on — the wiring above
  // plus viewer-flows.spec.ts are the authoritative coverage.
  const selectionDrove = await selectInGuest(page, ".local-webview-host webview.local-webview");
  if (selectionDrove) {
    const excerptAppeared = await page
      .locator(".anchor-excerpt-quote")
      .filter({ hasText: "render thread" })
      .waitFor({ timeout: 4000 })
      .then(() => true)
      .catch(() => false);
    // eslint-disable-next-line no-console
    console.log(`[local-html] guest selection → Anchor excerpt observable: ${excerptAppeared}`);
  }
});
