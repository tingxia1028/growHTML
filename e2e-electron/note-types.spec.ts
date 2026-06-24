import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { makeGradientPng } from "../e2e/fixtures/image";

// P4 MEDIA NOTE PICK path — desktop-only (it goes through the native file dialog), so
// it can only run in the real Electron app. We drive the full flow:
//
//   1. choose the `image` note type in the composer  → its media editor renders
//   2. click "Choose file…" → the renderer calls window.studyVault.openFile() which
//      invokes the main process's `dialog:openFile` IPC. We STUB dialog.showOpenDialog
//      (via app.evaluate) to return a known temp PNG, the same technique Playwright
//      uses for native dialogs — so no human interaction is needed.
//   3. the renderer imports the picked file (POST /api/assets/local-file → copied into
//      the vault) and stores the returned assetId in the note content.
//   4. Save Note → the note list renders <img src="/api/assets/<id>"> and the image
//      actually decodes (naturalWidth > 0), proving the asset bytes round-trip.
//
// This is the desktop counterpart to e2e/note-types.spec.ts (which covers the web
// RENDER path + the structured flashcard/quiz composers). The existing 7 electron e2e
// keep their original selectors — this only adds to the composer/note-list.

const VAULT = path.resolve(".e2e-electron-vault-note-types");

let app: ElectronApplication;
let page: Page;
let tmpDir = "";

test.beforeAll(async () => {
  await rm(VAULT, { recursive: true, force: true });
  tmpDir = await mkdtemp(path.join(tmpdir(), "sv-note-types-"));
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

test("image note (desktop pick): Choose file → native dialog → asset imported → note renders <img>", async () => {
  // A real PNG on disk for the stubbed dialog to "return".
  const pngPath = path.join(tmpDir, "picked.png");
  await writeFile(pngPath, makeGradientPng(120, 90));

  // Seed + open a source so the note has a home (and the study panel is populated).
  const title = `Desktop Image ${Date.now()}`;
  const sourceId = await page.evaluate(async (t) => {
    const res = await fetch("/api/sources/html", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: t, content: "<article><p>Body with a figure.</p></article>" })
    });
    return (await res.json()).source.id as string;
  }, title);
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.locator(".source-item-open").filter({ hasText: sourceId }).click();
  await expect(page.locator(".reader-header h2")).toHaveText(title);

  // STUB the native open-file dialog to return our PNG (no human click needed). This
  // is the function the `dialog:openFile` IPC handler calls in electron/main.ts.
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
  }, pngPath);

  // STEP 1 — choose the image note type → the media editor renders with an enabled
  // "Choose file…" button (desktop has window.studyVault.openFile).
  await page.locator(".composer-mode .mode-tab", { hasText: "Note" }).click();
  await page.locator(".note-type-select").selectOption("image");
  const pick = page.locator(".composer-note-editor .media-pick");
  await expect(pick).toBeEnabled();

  // STEP 2+3 — click it → native dialog (stubbed) → importAsset → assetId stored. The
  // editor then shows the chosen asset id.
  await pick.click();
  await expect(page.locator(".composer-note-editor .media-chosen")).toContainText("asset_", { timeout: 15_000 });

  // STEP 4 — Save Note → the note list renders the image note pointing at the asset.
  await page.getByRole("button", { name: "Save Note" }).click();
  const card = page.locator(".note-list .record-card", { hasText: "image" }).first();
  await expect(card).toBeVisible();
  const img = card.locator(".sv-media-img");
  await expect(img).toHaveAttribute("src", /\/api\/assets\/asset_/);
  // The image actually decodes the seeded bytes (proves the asset was copied + served).
  await expect.poll(async () => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
});
