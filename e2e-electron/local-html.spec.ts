import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

// Drives the REAL Electron app's LOCAL HTML path: ingest a local .html file → it
// renders in a persistent <webview> (LocalHtmlReader). The fix under test is that
// this webview now carries the SAME selection-capture guest preload as the live-web
// webview, so selecting text in a local page produces a source chip (a web_text_quote
// draft keyed by the file's /api/local url).
//
// NOTE (documented limitation): Playwright cannot reliably synthesize a real text
// selection INSIDE an Electron <webview> guest (a separate WebContents the host
// page can't script). So this e2e asserts the capture WIRING is present (the guest
// preload is attached to the local webview) rather than performing the selection.
// The selection→AnchorDraft logic itself is covered by the vitest unit tests in
// src/client/selection/webviewSelection.test.ts and src/client/focus/FocusContext.test.ts.

const VAULT = path.resolve(".e2e-electron-vault-local");

let app: ElectronApplication;
let page: Page;
let tmpDir = "";
let htmlPath = "";

test.beforeAll(async () => {
  await rm(VAULT, { recursive: true, force: true });
  tmpDir = await mkdtemp(path.join(tmpdir(), "sv-localhtml-"));
  htmlPath = path.join(tmpDir, "lesson.html");
  await writeFile(
    htmlPath,
    "<!doctype html><html><head><title>Lesson</title></head><body><h1>Lesson</h1>" +
      "<p id='para'>The render thread submits draw commands every frame.</p></body></html>",
    "utf8"
  );

  app = await electron.launch({
    args: ["dist-electron/main.cjs"],
    env: { ...process.env, STUDY_VAULT_ROOT: VAULT }
  });
  page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
});

test.afterAll(async () => {
  await app?.close();
  await rm(VAULT, { recursive: true, force: true });
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
});

test("local HTML: renders in a <webview> with the selection-capture guest preload attached", async () => {
  await expect(page.locator(".brand-block h1")).toHaveText("Sources");

  // Ingest the local .html file through the in-process API the desktop UI uses.
  const sourceId = await page.evaluate(async (filePath) => {
    const res = await fetch("/api/sources/local-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath })
    });
    const body = await res.json();
    return body.source.id as string;
  }, htmlPath);

  // Refresh the library and open the source.
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.locator(".source-item-open").filter({ hasText: sourceId }).click();

  // The LocalHtmlReader mounts a single persistent <webview> in its host element.
  const webview = page.locator(".local-webview-host webview.local-webview");
  await expect(webview).toHaveCount(1);

  // The fix: the local webview now carries the selection-capture guest preload (the
  // same one the live-web webview uses). Without it, selecting text did nothing.
  await expect(webview).toHaveAttribute("preload", /webview-preload\.cjs$/);

  // Best-effort: try to drive a real selection inside the guest by scripting the
  // <webview> (executeJavaScript runs in the guest, where the preload listens). If
  // the guest reports the selection, the source chip fills with our local-file
  // anchor. This may be flaky across Electron versions; we don't fail the suite on
  // it (the wiring above + the unit tests are the authoritative coverage).
  const selectionDrove = await page
    .evaluate(async () => {
      const view = document.querySelector(".local-webview-host webview.local-webview") as
        | (HTMLElement & { executeJavaScript: (code: string) => Promise<unknown> })
        | null;
      if (!view) return false;
      try {
        await view.executeJavaScript(
          "(function(){var p=document.getElementById('para');var r=document.createRange();" +
            "r.selectNodeContents(p);var s=getSelection();s.removeAllRanges();s.addRange(r);" +
            "document.dispatchEvent(new Event('mouseup'));return true;})()"
        );
        return true;
      } catch {
        return false;
      }
    })
    .catch(() => false);

  if (selectionDrove) {
    // If selection could be driven, the chip MAY reflect the local-HTML quote. We
    // log the outcome but do not fail on it — see the limitation note above.
    const chipAppeared = await page
      .locator(".chat-source")
      .filter({ hasText: "render thread" })
      .waitFor({ timeout: 4000 })
      .then(() => true)
      .catch(() => false);
    // eslint-disable-next-line no-console
    console.log(`[local-html] guest selection → chip observable: ${chipAppeared}`);
  }
});
