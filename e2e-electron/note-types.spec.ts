import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { makeGradientPng } from "../e2e/fixtures/image";
import { openLibraryMenu } from "../e2e/helpers";
// Canonical zh/en dict — the 文件 picker button's aria-label (self-updating selector).
import { libraryMessages } from "../src/client/workspace/libraryMessages";
import { closeApp, launchApp, type LaunchedApp } from "./harness";

// DESKTOP-ONLY native-dialog seam (E2E-ELECTRON-001). The original spec drove the
// composer's `image` note type + "Choose file…" media pick — that UI died with the
// Growte IA rebuild (the composer is AI-only; see the skip below). The seam it
// really proved — renderer → window.studyVault.openFile() → main-process
// `dialog:openFile` IPC → dialog.showOpenDialog (STUBBED via app.evaluate, no human
// click) → the picked path flows back and is imported — lives on in TODAY'S UX as
// the Library `+` → 文件… action, so that is what we drive end to end now.

let handle: LaunchedApp;
let page: Page;
let tmpDir = "";

test.beforeAll(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "sv-note-types-"));
  handle = await launchApp("note-types");
  page = handle.page;
});

test.afterAll(async () => {
  await closeApp(handle);
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
});

test("Library + → 文件… : native open dialog (stubbed) → local HTML imported and opens in its webview", async () => {
  // A real page on disk for the stubbed dialog to "return".
  const htmlPath = path.join(tmpDir, "picked-lesson.html");
  await writeFile(
    htmlPath,
    "<!doctype html><html><head><title>Picked Lesson</title></head><body>" +
      "<p id='para'>The picked lesson paragraph about render threads.</p></body></html>",
    "utf8"
  );

  // STUB the native open-file dialog (the function the `dialog:openFile` IPC handler
  // calls in electron/main.ts) — the same technique Playwright uses for native dialogs.
  await handle.app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
  }, htmlPath);

  // Drive today's UI: the ONE Library `+` add menu → the 本地文件/文件夹… block
  // (LIB layout: the old standalone core.import-file entry became the
  // core.import-local block hosting the 文件 + 文件夹 native pickers, enabled on
  // desktop only — its aria-label is libraryMessages.importFile).
  await openLibraryMenu(page);
  const pick = page
    .locator('[data-add-action="core.import-local"]')
    .getByRole("button", { name: libraryMessages.importFile.zh, exact: true });
  await expect(pick).toBeEnabled();
  await pick.click();

  // The picked file round-tripped renderer → IPC → dialog stub → import: the local
  // HTML source opens in the persistent <webview> with the guest preload attached.
  const webview = page.locator(".local-webview-host webview.local-webview");
  await expect(webview).toHaveCount(1, { timeout: 15_000 });
  await expect(webview).toHaveAttribute("preload", /webview-preload\.cjs$/);

  // And it landed in the vault as a real source (the same local-file ingest seam).
  const imported = await page.evaluate(async () => {
    const res = await fetch("/api/sources");
    const sources = (await res.json()).sources as Array<{ title: string; metadata?: { originalPath?: string } }>;
    return sources.some((s) => (s.metadata?.originalPath ?? "").includes("picked-lesson.html"));
  });
  expect(imported, "expected the picked file to be ingested as a local-file source").toBe(true);
});

// SKIP (E2E-ELECTRON-001): the P4 media-note PICK flow (composer → `image` note type →
// media editor → "Choose file…" → asset import → Save Note renders <img>) has no UI
// today — the Growte IA rebuild made the right-panel composer AI-ONLY (`anchor.ask-ai`;
// WorkspaceContext.composerCommandId), so `.note-type-select` / `.media-pick` are no
// longer mounted anywhere. Un-skip when the pending manual note-creation UX product
// decision lands (the same decision the web suite's loop/viewer-flows skips wait on);
// the dialog IPC seam itself stays covered by the live test above, and the asset
// import/render path by the web e2e note-types.spec.ts RENDER coverage.
test.skip("image note (desktop pick): Choose file → native dialog → asset imported → note renders <img>", async () => {
  const pngPath = path.join(tmpDir, "picked.png");
  await writeFile(pngPath, makeGradientPng(120, 90));
  await handle.app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
  }, pngPath);
  // Former flow: composer Note mode → .note-type-select "image" → .media-pick →
  // .media-chosen shows asset_ → Save Note → .note-list card renders .sv-media-img
  // with src=/api/assets/asset_… and naturalWidth > 0.
  await page.locator(".note-type-select").selectOption("image");
  await page.locator(".composer-note-editor .media-pick").click();
  await expect(page.locator(".composer-note-editor .media-chosen")).toContainText("asset_");
});
